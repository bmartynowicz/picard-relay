// Public-project observation only: no token, POST, dispatch, rerun or artifact download.
export const PROJECT = 'bmartynowicz/picard-relay';
export const CI_WORKFLOW = '.github/workflows/compute-broker-tests.yml';
const API = `https://api.github.com/repos/${PROJECT}`;
export const commitIdentity = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const boundedText = value => typeof value === 'string' ? value.slice(0, 200) : null;
const positiveId = value => Number.isSafeInteger(value) && value > 0;

export async function observeProjectCi(commitSha, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!commitIdentity(commitSha)) throw Error('invalid_commit_sha');
  async function get(path) {
    const response = await fetchImpl(`${API}${path}`, { method: 'GET', redirect: 'error',
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'picard-compute-preview' },
      signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) { await response.body?.cancel(); throw Error('project_ci_unavailable'); }
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length; if (bytes > 131_072) throw Error('project_ci_response_too_large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const repository = await get('');
  if (repository.full_name !== PROJECT || repository.private !== false || repository.archived !== false)
    throw Error('public_project_required');
  const runs = await get(`/actions/runs?head_sha=${commitSha}&event=pull_request&per_page=3`);
  if (!Array.isArray(runs.workflow_runs)) throw Error('invalid_project_ci_response');
  const run = runs.workflow_runs.filter(value => value.head_sha === commitSha && value.event === 'pull_request'
    && value.path === CI_WORKFLOW && positiveId(value.id)).sort((a, b) => b.id - a.id)[0];
  const base = { provider: 'github-actions', repository: PROJECT, public: true, commitSha,
    workflow: CI_WORKFLOW, observedAt: now(), readOnly: true, dispatchEnabled: false,
    note: 'Observed project CI; not a compute enrollment, quota measurement or independent billing guarantee.' };
  if (!run) return { ...base, found: false };
  const jobs = await get(`/actions/runs/${run.id}/jobs?per_page=10`);
  if (!Array.isArray(jobs.jobs)) throw Error('invalid_project_ci_response');
  return { ...base, found: true, run: { id: run.id, attempt: run.run_attempt,
    status: boundedText(run.status), conclusion: boundedText(run.conclusion),
    url: `https://github.com/${PROJECT}/actions/runs/${run.id}` },
  jobsTruncated: jobs.total_count > 10,
  jobs: jobs.jobs.filter(value => positiveId(value.id) && value.run_id === run.id).slice(0, 10).map(value => ({
    id: value.id, name: boundedText(value.name), status: boundedText(value.status), conclusion: boundedText(value.conclusion),
    steps: Array.isArray(value.steps) ? value.steps.slice(0, 20).map(step => ({
      number: step.number, name: boundedText(step.name), status: boundedText(step.status), conclusion: boundedText(step.conclusion),
    })) : [],
    stepsTruncated: Array.isArray(value.steps) && value.steps.length > 20,
  })) };
}
