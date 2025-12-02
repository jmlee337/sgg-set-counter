import { appendFile, readFile } from 'fs/promises';
import path from 'path';

type SetsRatio = {
  total: number;
  withCharactersAndStages: number;
  withStockCounts: number;
  withColors: number;
};

function getEmptySetsRatio(): SetsRatio {
  return {
    total: 0,
    withCharactersAndStages: 0,
    withStockCounts: 0,
    withColors: 0,
  };
}

async function wrappedFetch(
  input: URL | RequestInfo,
  init?: RequestInit | undefined,
  nextDelayMs: number = 1000,
) {
  try {
    const response = await fetch(input, init);
    if (response.ok) {
      return response.json();
    } else if (response.status >= 500) {
      console.log(`${response.status}: ${input}, retrying in ${nextDelayMs}`);
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const nextResponse = await wrappedFetch(
              input,
              init,
              nextDelayMs * 2,
            );
            resolve(nextResponse);
          } catch (e: unknown) {
            reject(e);
          }
        }, nextDelayMs);
      });
    } else {
      console.log(`\n${response.status}: ${input}`);
      throw new Error(response.statusText);
    }
  } catch (e: any) {
    console.log('');
    throw e;
  }
}

const progress = ['-', '\\', '|', '/'];
async function getTournament(slug: string): Promise<SetsRatio> {
  let iProgress = 0;
  const setsRatio = getEmptySetsRatio();
  const tournamentResponse = await wrappedFetch(
    `https://api.start.gg/tournament/${slug}?expand[]=event`,
  );
  iProgress++;
  process.stdout.write(progress[iProgress % progress.length]);

  if (Array.isArray(tournamentResponse.entities.event)) {
    const eligibleEvents = (tournamentResponse.entities.event as any[]).filter(
      (event) =>
        Number.isInteger(event.id) &&
        event.videogameId === 1 &&
        !event.isOnline,
    );
    for (const event of eligibleEvents) {
      const eventResponse = await wrappedFetch(
        `https://api.start.gg/event/${event.id}?expand[]=groups`,
      );
      iProgress++;
      process.stdout.write(`\b${progress[iProgress % progress.length]}`);

      if (Array.isArray(eventResponse.entities?.groups)) {
        const eligibleGroups = (eventResponse.entities.groups as any[]).filter(
          (group) => Number.isInteger(group.id),
        );
        for (const group of eligibleGroups) {
          const groupResponse = await wrappedFetch(
            `https://api.start.gg/phase_group/${group.id}?expand[]=sets`,
          );
          iProgress++;
          process.stdout.write(`\b${progress[iProgress % progress.length]}`);

          if (Array.isArray(groupResponse.entities?.sets)) {
            const eligibleSets: any[] = groupResponse.entities.sets.filter(
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
            const withCharactersAndStages = charactersAndStagesSets.length;

            const stockCountsSets = charactersAndStagesSets.filter((set) =>
              (set.games as any[]).every(
                (game) => game.entrant1P1Stocks || game.entrant2P1Stocks,
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

            setsRatio.total += total;
            setsRatio.withCharactersAndStages += withCharactersAndStages;
            setsRatio.withStockCounts += withStockCounts;
            setsRatio.withColors += withColors;
          }
        }
      }
    }
  }

  process.stdout.write('\b');
  return setsRatio;
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

function progressOneMonth(year: number, monthI: number) {
  monthI += 1;
  if (monthI >= 12) {
    year += 1;
    monthI = 0;
  }
  const afterS = Date.UTC(year, monthI) / 1000;
  const beforeS = Date.UTC(year, monthI + 1) / 1000;

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
    const setsRatio = getEmptySetsRatio();
    const slugs = await getTournamentSlugs(key, afterS, beforeS);
    console.log(`${year}/${monthI + 1}: ${slugs.length} tournaments`);
    for (let i = 0; i < slugs.length; i++) {
      const { total, withCharactersAndStages, withStockCounts, withColors } =
        await getTournament(slugs[i]);
      setsRatio.total += total;
      setsRatio.withCharactersAndStages += withCharactersAndStages;
      setsRatio.withStockCounts += withStockCounts;
      setsRatio.withColors += withColors;
      process.stdout.write('.');
      if ((i + 1) % 50 === 0) {
        process.stdout.write(`[${i + 1}]\n`);
      } else if (
        Math.floor((i + 1) / 50) === Math.floor(slugs.length / 50) &&
        (i + 1) % 10 === 0
      ) {
        process.stdout.write(`[${(i + 1) % 100}]`);
      }
    }
    console.log('\n');

    await appendFile(
      path.join(process.cwd(), 'results.csv'),
      `${year},${monthI + 1},${slugs.length},${setsRatio.total},${setsRatio.withCharactersAndStages},${setsRatio.withStockCounts},${setsRatio.withColors}\n`,
    );

    ({ year, monthI, afterS, beforeS } = progressOneMonth(year, monthI));
  }
}

if (process.argv.length < 3) {
  console.log('node build/src/main.js [START.GG API KEY]');
} else {
  let results = '';
  const resultsPath = path.join(process.cwd(), 'results.csv');
  try {
    results = await readFile(resultsPath, { encoding: 'utf8' });
  } catch {
    console.log(`could not read ${resultsPath}`);
  }

  if (results) {
    const lines = results.split('\n').filter((substr) => substr.length > 0);
    if (lines.length > 1) {
      const lastLine = lines[lines.length - 1];
      const [lastYear, lastMonth] = lastLine
        .split(',')
        .map((substr) => Number.parseInt(substr, 10));
      const { year, monthI } = progressOneMonth(lastYear, lastMonth - 1);
      everyMonth(process.argv[2], year, monthI);
    } else {
      everyMonth(process.argv[2]);
    }
  }
}
