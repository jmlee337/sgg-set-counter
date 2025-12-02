type SetsRatio = {
  total: number;
  withCharactersAndStages: number;
  withStockCounts: number;
  withColors: number;
};

async function wrappedFetch(
  input: URL | RequestInfo,
  init?: RequestInit | undefined,
  nextDelayMs: number = 1000,
) {
  const response = await fetch(input, init);
  if (response.ok) {
    return response.json();
  } else if (response.status >= 500) {
    console.log(`${response.status}: ${input}, retrying in ${nextDelayMs}`);
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const nextResponse = await wrappedFetch(input, init, nextDelayMs * 2);
          resolve(nextResponse);
        } catch (e: unknown) {
          reject(e);
        }
      }, nextDelayMs);
    });
  } else {
    console.log(`${response.status}: ${input}`);
    throw new Error(response.statusText);
  }
}

async function getTournament(slug: string): Promise<SetsRatio> {
  const tournamentResponse = await wrappedFetch(
    `https://api.start.gg/tournament/${slug}?expand[]=event`,
  );
  if (
    Array.isArray(tournamentResponse.entities?.event) &&
    tournamentResponse.entities.event.length > 0
  ) {
    return (
      await Promise.all(
        (tournamentResponse.entities.event as any[])
          .filter(
            (event) =>
              Number.isInteger(event.id) &&
              event.videogameId === 1 &&
              !event.isOnline,
          )
          .map(async (event): Promise<SetsRatio> => {
            const eventResponse = await wrappedFetch(
              `https://api.start.gg/event/${event.id}?expand[]=groups`,
            );
            if (
              Array.isArray(eventResponse.entities?.groups) &&
              eventResponse.entities.groups.length > 0
            ) {
              return (
                await Promise.all(
                  (eventResponse.entities.groups as any[])
                    .filter((group) => Number.isInteger(group.id))
                    .map(async (group): Promise<SetsRatio> => {
                      const groupResponse = await wrappedFetch(
                        `https://api.start.gg/phase_group/${group.id}?expand[]=sets`,
                      );
                      if (Array.isArray(groupResponse.entities?.sets)) {
                        const eligibleSets: any[] =
                          groupResponse.entities.sets.filter(
                            (set) =>
                              set.state === 3 &&
                              Number.isInteger(set.entrant1Id) &&
                              Number.isInteger(set.entrant2Id) &&
                              set.entrant1Score !== -1 &&
                              set.entrant2Score !== -1 &&
                              !set.unreachable,
                          );
                        const total = eligibleSets.length;

                        const charactersAndStagesSets = eligibleSets.filter(
                          (set) =>
                            Array.isArray(set.entrant1CharacterIds) &&
                            (set.entrant1CharacterIds as any[]).length > 0 &&
                            (set.entrant1CharacterIds as any[]).every(
                              (characterId) =>
                                Number.isInteger(characterId) &&
                                characterId >= 1 &&
                                characterId <= 26,
                            ) &&
                            Array.isArray(set.entrant2CharacterIds) &&
                            (set.entrant2CharacterIds as any[]).length > 0 &&
                            (set.entrant2CharacterIds as any[]).every(
                              (characterId) =>
                                Number.isInteger(characterId) &&
                                characterId >= 1 &&
                                characterId <= 26,
                            ) &&
                            Array.isArray(set.games) &&
                            set.games.length > 0 &&
                            (set.games as any[]).every(
                              (game) =>
                                Number.isInteger(game.stageId) &&
                                game.stageId >= 1 &&
                                game.stageId <= 29,
                            ),
                        );
                        const withCharactersAndStages =
                          charactersAndStagesSets.length;

                        const stockCountsSets = charactersAndStagesSets.filter(
                          (set) =>
                            (set.games as any[]).every(
                              (game) =>
                                game.entrant1P1Stocks || game.entrant2P1Stocks,
                            ),
                        );
                        const withStockCounts = stockCountsSets.length;

                        const colorsSets = stockCountsSets.filter((set) =>
                          (set.games as any[]).every(
                            (game) =>
                              game.entrant1P1Stocks &&
                              game.entrant1P1Stocks >= 100 &&
                              game.entrant2P1Stocks &&
                              game.entrant2P1Stocks >= 100,
                          ),
                        );
                        const withColors = colorsSets.length;

                        return {
                          total,
                          withCharactersAndStages,
                          withStockCounts,
                          withColors,
                        };
                      }
                      return {
                        total: 0,
                        withCharactersAndStages: 0,
                        withStockCounts: 0,
                        withColors: 0,
                      };
                    }),
                )
              ).reduce((previous, current) => ({
                total: previous.total + current.total,
                withCharactersAndStages:
                  previous.withCharactersAndStages +
                  current.withCharactersAndStages,
                withStockCounts:
                  previous.withStockCounts + current.withStockCounts,
                withColors: previous.withColors + current.withColors,
              }));
            }
            return {
              total: 0,
              withCharactersAndStages: 0,
              withStockCounts: 0,
              withColors: 0,
            };
          }),
      )
    ).reduce((previous, current) => ({
      total: previous.total + current.total,
      withCharactersAndStages:
        previous.withCharactersAndStages + current.withCharactersAndStages,
      withStockCounts: previous.withStockCounts + current.withStockCounts,
      withColors: previous.withColors + current.withColors,
    }));
  }
  return {
    total: 0,
    withCharactersAndStages: 0,
    withStockCounts: 0,
    withColors: 0,
  };
}

async function fetchGql(key: string, query: string, variables: any) {
  const json = await wrappedFetch('https://api.start.gg/gql/alpha', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors[0].message as string);
  }

  return json.data;
}

const TOURNAMENTS_QUERY = `
  query tournamentsQuery($afterS: Timestamp, $beforeS: Timestamp, $pageNum: Int) {
    tournaments(
      query: {page: $pageNum, perPage: 512, filter: {afterDate: $afterS, beforeDate: $beforeS, videogameIds: [1]}}
    ) {
      pageInfo {
        totalPages
      }
      nodes {
        hasOfflineEvents
        slug
      }
    }
  }
`;
async function getTournamentSlugs(
  key: string,
  afterS: number,
  beforeS: number,
) {
  const slugs: string[] = [];
  let pageNum = 1;
  while (true) {
    const data = await fetchGql(key, TOURNAMENTS_QUERY, {
      afterS,
      beforeS,
      pageNum,
    });
    const { nodes } = data.tournaments;
    if (Array.isArray(nodes)) {
      slugs.push(
        ...nodes
          .filter((node) => node.hasOfflineEvents)
          .map((node) => node.slug.slice(11)),
      );
    }
    pageNum++;
    if (pageNum < data.tournaments.pageInfo.totalPages) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 1000);
      });
    } else {
      break;
    }
  }

  return slugs;
}

function progressOneMonth(
  year: number,
  monthI: number,
  afterS: number,
  beforeS: number,
) {
  monthI += 1;
  if (monthI >= 12) {
    year += 1;
    monthI = 0;
  }
  afterS = Date.UTC(year, monthI) / 1000;
  beforeS = Date.UTC(year, monthI + 1) / 1000;

  return {
    year,
    monthI,
    afterS,
    beforeS,
  };
}

// April 2015 has the first real start.gg Melee tournaments
async function everyMonth(
  key: string,
  year: number = 2015,
  monthI: number = 3,
) {
  let afterS = Date.UTC(year, monthI) / 1000;
  let beforeS = Date.UTC(year, monthI + 1) / 1000;

  const currentYear = new Date().getUTCFullYear();
  const currentMonthI = new Date().getUTCMonth();
  while (year < currentYear || monthI < currentMonthI) {
    const slugs = await getTournamentSlugs(key, afterS, beforeS);
    const setsRatio: SetsRatio = {
      total: 0,
      withCharactersAndStages: 0,
      withStockCounts: 0,
      withColors: 0,
    };
    let i = 0;
    while (true) {
      const slug = slugs[i];
      const { total, withCharactersAndStages, withStockCounts, withColors } =
        await getTournament(slug);
      setsRatio.total += total;
      setsRatio.withCharactersAndStages += withCharactersAndStages;
      setsRatio.withStockCounts += withStockCounts;
      setsRatio.withColors += withColors;

      i++;
      if (i < slugs.length) {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 1000);
        });
      } else {
        break;
      }
    }
    console.log(
      `${year}-${monthI + 1},${slugs.length},${setsRatio.total},${setsRatio.withCharactersAndStages},${setsRatio.withStockCounts},${setsRatio.withColors}`,
    );

    ({ year, monthI, afterS, beforeS } = progressOneMonth(
      year,
      monthI,
      afterS,
      beforeS,
    ));
  }
}

if (process.argv.length < 3) {
  console.log('node build/src/main.js [START.GG API KEY]');
} else {
  everyMonth(process.argv[2]);
}
