import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { recognitionIssuePages, verifyContributorCredits } from '../experimental/runtime-control/src/https-fetch.mjs';

function readPage(_login, _label, path) {
  return JSON.parse(execFileSync('gh', [
    'api', '--hostname', 'github.com', path,
    '--jq', '[.[] | {number, login: .user.login, labels: [.labels[].name], pull: has("pull_request"), mergedAt: .pull_request.merged_at}]',
  ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 512 * 1024 }));
}

export function contributorCredits(login, read = readPage) {
  const pages = recognitionIssuePages(login).map(({ kind, label, path }) => [kind, read(login, label, path)]);
  return verifyContributorCredits(login, Object.fromEntries(pages));
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
