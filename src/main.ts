import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

type Stats = {
  entrants: number;
  sets: number;
  withCharactersAndStages: number;
  withStockCounts: number;
  withColors: number;
};

function getEmptyStats(): Stats {
  return {
    entrants: 0,
    sets: 0,
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
      console.log(`\n${response.status}: ${input}, retrying in ${nextDelayMs}`);
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

const excludedSlugs = new Set<string>([]);
const excludedOwnerIds = new Set([906371, 1031337]);
const progress = ['-', '\\', '|', '/'];
async function getTournament(
  slug: string,
  uniquePlayerIds: Set<number>,
  monthPath: string,
): Promise<Stats> {
  const stats = getEmptyStats();
  if (excludedSlugs.has(slug)) {
    return stats;
  }

  const tournamentResponse = await wrappedFetch(
    `https://api.start.gg/tournament/${slug}?expand[]=event&expand[]=phase`,
  );
  if (excludedOwnerIds.has(tournamentResponse.entities.tournament.ownerId)) {
    return stats;
  }

  let iProgress = 0;
  process.stdout.write(progress[iProgress % progress.length]);

  const localPlayerIds = new Set<number>();
  if (Array.isArray(tournamentResponse.entities.event)) {
    const eligibleEvents = (tournamentResponse.entities.event as any[]).filter(
      (event) =>
        Number.isInteger(event.id) &&
        event.videogameId === 1 &&
        (event.state === 2 || event.state === 3) &&
        !event.isOnline,
    );
    if (eligibleEvents.length > 10) {
      console.log(
        `\n${slug} ${tournamentResponse.entities.tournament.ownerId}`,
      );
    }
    for (const event of eligibleEvents) {
      const eventResponse = await wrappedFetch(
        `https://api.start.gg/event/${event.id}?expand[]=groups`,
      );
      iProgress++;
      process.stdout.write(`\b${progress[iProgress % progress.length]}`);

      if (Array.isArray(eventResponse.entities?.groups)) {
        const eligibleGroups = (eventResponse.entities.groups as any[]).filter(
          (group) =>
            Number.isInteger(group.id) &&
            (group.state === 2 || group.state === 3),
        );
        if (eligibleGroups.length > 200) {
          console.log(
            `\n${slug} ${tournamentResponse.entities.tournament.ownerId}`,
          );
        }
        for (const group of eligibleGroups) {
          const groupResponse = await wrappedFetch(
            `https://api.start.gg/phase_group/${group.id}?expand[]=sets&expand[]=entrants`,
          );
          iProgress++;
          process.stdout.write(`\b${progress[iProgress % progress.length]}`);

          if (
            Array.isArray(groupResponse.entities?.entrants) &&
            Array.isArray(groupResponse.entities?.sets)
          ) {
            const entrantIdToPlayerIds = new Map<number, number[]>(
              (groupResponse.entities.entrants as any[]).map((entrant) => [
                entrant.id,
                Object.values(entrant.mutations.players).map(
                  (player: any) => player.id,
                ),
              ]),
            );
            const eligibleSets = (groupResponse.entities.sets as any[]).filter(
              (set) =>
                set.state === 3 &&
                Number.isInteger(set.entrant1Id) &&
                Number.isInteger(set.entrant2Id) &&
                set.entrant1Score !== -1 &&
                set.entrant2Score !== -1 &&
                !set.unreachable,
            );
            eligibleSets.forEach((set) => {
              const playerIdPred = (playerId: number) => {
                localPlayerIds.add(playerId);
                uniquePlayerIds.add(playerId);
              };
              entrantIdToPlayerIds.get(set.entrant1Id)?.forEach(playerIdPred);
              entrantIdToPlayerIds.get(set.entrant2Id)?.forEach(playerIdPred);
            });
            const sets = eligibleSets.length;

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

            stats.sets += sets;
            stats.withCharactersAndStages += withCharactersAndStages;
            stats.withStockCounts += withStockCounts;
            stats.withColors += withColors;

            if (sets > 0) {
              await mkdir(path.join(monthPath, slug), {
                recursive: true,
              });
              await writeFile(
                path.join(monthPath, slug, `${group.id}.json`),
                JSON.stringify(groupResponse),
              );
            }
          }
        }
      }
    }
  }
  if (stats.sets > 0) {
    await writeFile(
      path.join(monthPath, slug, `${slug}.json`),
      JSON.stringify(tournamentResponse),
    );
  }

  process.stdout.write('\b');
  stats.entrants = localPlayerIds.size;
  return stats;
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
        state
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
          .filter(
            (node) =>
              node.hasOfflineEvents && (node.state === 2 || node.state === 3),
          )
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

async function everyMonth(
  key: string,
  // Modern Melee history begins February 2019
  year: number = 2019,
  monthI: number = 1,
) {
  let afterS = Date.UTC(year, monthI) / 1000;
  let beforeS = Date.UTC(year, monthI + 1) / 1000;

  const currentYear = new Date().getUTCFullYear();
  const currentMonthI = new Date().getUTCMonth();
  while (year < currentYear || monthI < currentMonthI) {
    process.stdout.write(`${year}/${monthI + 1}: `);
    const slugs = await getTournamentSlugs(key, afterS, beforeS);
    console.log(`${slugs.length} tournaments to fetch`);

    let numTournaments = 0;
    const stats = getEmptyStats();
    const playerIds = new Set<number>();
    for (let i = 0; i < slugs.length; i++) {
      const {
        entrants,
        sets,
        withCharactersAndStages,
        withStockCounts,
        withColors,
      } = await getTournament(
        slugs[i],
        playerIds,
        path.join(process.cwd(), 'tournaments', `${year}-${monthI + 1}`),
      );
      if (sets > 0) {
        numTournaments++;
      }
      stats.entrants += entrants;
      stats.sets += sets;
      stats.withCharactersAndStages += withCharactersAndStages;
      stats.withStockCounts += withStockCounts;
      stats.withColors += withColors;
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
      `${year},${monthI + 1},${numTournaments},${stats.entrants},${playerIds.size},${stats.sets},${stats.withCharactersAndStages},${stats.withStockCounts},${stats.withColors}\n`,
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
