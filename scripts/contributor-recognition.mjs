import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repository = 'bmartynowicz/picard-relay';
const labels = { kills: 'picard:kill', captures: 'picard:capture' };
const pageSize = 100;

function readPage(login, label) {
  const query = new URLSearchParams({
    creator: login, labels: label, state: 'all', per_page: String(pageSize),
  });
  return JSON.parse(execFileSync('gh', [
    'api', 'repos/' + repository + '/issues?' + query,
    '--jq', '[.[] | {number, login: .user.login, labels: [.labels[].name], pull: has("pull_request"), mergedAt: .pull_request.merged_at}]',
  ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 512 * 1024 }));
}

export function contributorCredits(login, read = readPage) {
  if (typeof login !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login)) {
    throw Error('Supply one GitHub username.');
  }
  const credits = { kills: [], captures: [] };
  for (const [kind, label] of Object.entries(labels)) {
    const rows = read(login, label);
    if (!Array.isArray(rows) || rows.length >= pageSize) {
      throw Error('The award list was incomplete. Review it on GitHub.');
    }
    const numbers = new Set();
    for (const row of rows) {
      if (!Number.isSafeInteger(row?.number) || row.number < 1
        || typeof row.login !== 'string' || row.login.toLowerCase() !== login.toLowerCase()
        || !Array.isArray(row.labels) || !row.labels.includes(label)
        || typeof row.pull !== 'boolean') {
        throw Error('GitHub returned a record outside the requested award scope.');
      }
      if (row.labels.includes(labels.kills) && row.labels.includes(labels.captures)) {
        throw Error('Conflicting recognition labels on #' + row.number + '.');
      }
      if (row.pull && (kind !== 'kills' || !Number.isFinite(Date.parse(row.mergedAt)))) continue;
      numbers.add(row.number);
    }
    credits[kind] = [...numbers].sort((a, b) => a - b);
  }
  if (credits.captures.some(number => credits.kills.includes(number))) {
    throw Error('An award changed category during the check. Review it on GitHub.');
  }
  return credits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/contributor-recognition.mjs <github-username>');
    console.log(JSON.stringify(contributorCredits(process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
