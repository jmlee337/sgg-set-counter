type Ratio = {
  numerator: number;
  denominator: number;
};

async function wrappedFetch(url: string, nextDelayMs: number = 1000) {
  const response = await fetch(url);
  if (response.ok) {
    return response.json();
  } else if (response.status >= 500) {
    console.log(`${response.status}: ${url}, retrying in ${nextDelayMs}`);
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const nextResponse = await wrappedFetch(url, nextDelayMs * 2);
          resolve(nextResponse);
        } catch (e: unknown) {
          reject(e);
        }
      }, nextDelayMs);
    });
  } else {
    console.log(`${response.status}: ${url}`);
    throw new Error(response.statusText);
  }
}

async function getTournament(slug: string) {
  const tournamentResponse = await wrappedFetch(
    `https://api.start.gg/tournament/${slug}?expand[]=event`,
  );
  if (Array.isArray(tournamentResponse.entities?.event)) {
    return (
      await Promise.all(
        (tournamentResponse.entities.event as any[])
          .filter(
            (event) => Number.isInteger(event.id) && event.videogameId === 1,
          )
          .map(async (event): Promise<Ratio> => {
            const eventResponse = await wrappedFetch(
              `https://api.start.gg/event/${event.id}?expand[]=groups`,
            );
            if (Array.isArray(eventResponse.entities?.groups)) {
              return (
                await Promise.all(
                  (eventResponse.entities.groups as any[])
                    .filter((group) => Number.isInteger(group.id))
                    .map(async (group): Promise<Ratio> => {
                      const groupResponse = await wrappedFetch(
                        `https://api.start.gg/phase_group/${group.id}?expand[]=sets`,
                      );
                      if (Array.isArray(groupResponse.entities?.sets)) {
                        const playedSets = groupResponse.entities.sets.filter(
                          (set) =>
                            set.state === 3 &&
                            Number.isInteger(set.entrant1Id) &&
                            Number.isInteger(set.entrant2Id) &&
                            set.entrant1Score !== -1 &&
                            set.entrant2Score !== -1,
                        );
                        const denominator = playedSets.length;
                        const dataSets = playedSets.filter(
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
                            (set.games as any[]).every(
                              (game) =>
                                Number.isInteger(game.stageId) &&
                                game.stageId >= 1 &&
                                game.stageId <= 29,
                            ),
                        );
                        const numerator = dataSets.length;
                        return { numerator, denominator };
                      }
                      return { numerator: 0, denominator: 0 };
                    }),
                )
              ).reduce((previous, current) => ({
                numerator: previous.numerator + current.numerator,
                denominator: previous.denominator + current.denominator,
              }));
            }
            return { numerator: 0, denominator: 0 };
          }),
      )
    ).reduce((previous, current) => ({
      numerator: previous.numerator + current.numerator,
      denominator: previous.denominator + current.denominator,
    }));
  }
  return { numerator: 0, denominator: 0 };
}

// March 2015 has the first start.gg Melee tournament
let year = 2015;
let monthI = 2;
let afterS = Date.UTC(year, monthI) / 1000;
let beforeS = Date.UTC(year, monthI + 1) / 1000;

function setInitialMonth(initYear: number, initMonthNum: number) {
  year = initYear;
  monthI = initMonthNum - 1;
  afterS = Date.UTC(year, monthI) / 1000;
  beforeS = Date.UTC(year, monthI + 1) / 1000;
}

function progressOneMonth() {
  monthI += 1;
  if (monthI >= 12) {
    year += 1;
    monthI = 0;
  }
  afterS = Date.UTC(year, monthI) / 1000;
  beforeS = Date.UTC(year, monthI + 1) / 1000;
}

function everyMonth() {
  const currentYear = new Date().getUTCFullYear();
  const currentMonthI = new Date().getUTCMonth();
  while (year < currentYear || monthI < currentMonthI) {
    console.log(`${year}-${monthI + 1}: ${afterS} - ${beforeS}`);
    progressOneMonth();
  }
}

console.log(await getTournament('unranked'));
everyMonth();
