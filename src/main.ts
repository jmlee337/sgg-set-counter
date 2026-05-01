import { appendFile, readFile } from 'fs/promises';
import path from 'path';

type Stats = {
  entrants: number;
  rulesetId: number;
};

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
    console.log(`\n${e instanceof Error ? e.message : e}`);
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
  }
}

const excludedSlugs = new Set<string>([]);
const excludedOwnerIds = new Set([906371, 1031337]);
async function getTournament(slug: string): Promise<Stats[]> {
  const statsArr: Stats[] = [];
  if (excludedSlugs.has(slug)) {
    return statsArr;
  }

  const tournamentResponse = await wrappedFetch(
    `https://api.start.gg/tournament/${slug}?expand[]=event&expand[]=entrants`,
  );
  if (excludedOwnerIds.has(tournamentResponse.entities.tournament.ownerId)) {
    return statsArr;
  }

  if (
    Array.isArray(tournamentResponse.entities.entrants) &&
    Array.isArray(tournamentResponse.entities.event)
  ) {
    const eligibleEvents = (tournamentResponse.entities.event as any[]).filter(
      (event) =>
        Number.isInteger(event.id) &&
        event.videogameId === 1 &&
        (event.state === 2 || event.state === 3) &&
        event.isOnline &&
        Number.isInteger(event.rulesetId),
    );
    if (eligibleEvents.length > 10) {
      console.log(
        `\n${slug} ${tournamentResponse.entities.tournament.ownerId}`,
      );
    }
    for (const event of eligibleEvents) {
      statsArr.push({
        entrants: (tournamentResponse.entities.entrants as any[]).filter(
          (entrant) => entrant.eventId === event.id,
        ).length,
        rulesetId: event.rulesetId,
      });
    }
  }

  return statsArr;
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
      query: {
        page: $pageNum,
        perPage: 512,
        filter: {
          afterDate: $afterS,
          beforeDate: $beforeS,
          videogameIds: [1],
          hasOnlineEvents: true
        }
      }
    ) {
      pageInfo {
        totalPages
      }
      nodes {
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
          .filter((node) => node.state === 2 || node.state === 3)
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
  // unfrozen stadium was introduced aug 2025, so start a couple months before
  year: number = 2025,
  monthI: number = 5,
) {
  let afterS = Date.UTC(year, monthI) / 1000;
  let beforeS = Date.UTC(year, monthI + 1) / 1000;

  const currentYear = new Date().getUTCFullYear();
  const currentMonthI = new Date().getUTCMonth();
  while (year < currentYear || monthI < currentMonthI) {
    process.stdout.write(`${year}/${monthI + 1}: `);
    const slugs = await getTournamentSlugs(key, afterS, beforeS);
    console.log(`${slugs.length} tournaments to fetch`);

    const rulesetIdToEntrants = new Map<number, number>();
    for (let i = 0; i < slugs.length; i++) {
      (await getTournament(slugs[i])).forEach((stats) => {
        const entrants = rulesetIdToEntrants.get(stats.rulesetId) ?? 0;
        rulesetIdToEntrants.set(stats.rulesetId, entrants + stats.entrants);
      });
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
    console.log(rulesetIdToEntrants);
    console.log('\n');

    await appendFile(
      path.join(process.cwd(), 'results.csv'),
      `${year},${monthI + 1},${rulesetIdToEntrants.get(2) ?? 0},${(rulesetIdToEntrants.get(138) ?? 0) + (rulesetIdToEntrants.get(169) ?? 0)}\n`,
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
