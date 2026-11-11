import { selectResource, identity, integer } from './policy.mjs';
import { normalizeJob } from './job.mjs';
import { validateReceipt } from './receipt.mjs';
import { jobSha256, PreflightDenied } from './execution-protocol.mjs';
import { normalizeBatchJobs, createBatchRunner } from './batch.mjs';
export { normalizeJob } from './job.mjs';

export function createBroker({ store, resources = () => [], adapters = new Map(), fixtureMode = false,
  executionEnabled = false, authorize = () => false, now = Date.now }) {
  if (fixtureMode && executionEnabled) throw Error('exclusive_execution_modes');
  const active = new Map();
  const collecting = new Map();
  const live = adapter => executionEnabled === true && ['oracle-fixed-worker', 'github-public-ci'].includes(adapter?.kind);
  const allowed = (job, resourceId) => {
    const adapter = adapters.get(resourceId);
    return fixtureMode === true ? adapter?.kind === 'local-fixture' : live(adapter) && authorize(job, resourceId, now()) === true;
  };
  const contextMatches = (id, adapter) => JSON.stringify(store.context(id)) === JSON.stringify(adapter.context);
  function plan(value) {
    const job = normalizeJob(value);
    const registry = resources();
    // Validate raw numeric types before subtracting allocations: arithmetic must not coerce strings.
    const raw = selectResource(registry, job, now());
    if (raw.decisions.some(decision => decision.id === null)) return raw;
    const eligibleIds = new Set(raw.decisions.filter(decision => decision.eligible).map(decision => decision.id));
    const effective = store.effective(registry).map(resource => ({ ...resource,
      enabled: resource.enabled === true && eligibleIds.has(resource.id) && allowed(job, resource.id) }));
    const selected = selectResource(effective, job, now());
    return { ...selected, fixtureMode, liveCloudExecutionEnabled: executionEnabled,
      note: 'Operator cost evidence is not an independent billing guarantee. Live work also requires exact job authority and adapter preflight.' };
  }
  function persist(job) {
    const replay = store.replay(job);
    if (replay) return replay;
    const selection = plan(job);
    const row = store.insert(job, selection.resourceId,
      selection.resourceId ? '' : JSON.stringify(selection.decisions), now());
    if (selection.resourceId && live(adapters.get(selection.resourceId))) store.setContext(job.id, adapters.get(selection.resourceId).context);
    return row;
  }
  function submit(value) {
    const job = normalizeJob(value);
    return store.transaction(() => persist(job));
  }
  function submitBatch(value) {
    const jobs = normalizeBatchJobs(value);
    return store.transaction(() => jobs.map(persist));
  }
  async function run(id) {
    if (!identity(id)) throw Error('invalid_job_id');
    if (active.has(id)) return active.get(id);
    const row = store.find(id);
    if (!row) throw Error('job_not_found');
    if (row.state !== 'reserved') return row;
    const job = store.readInput(id);
    // Reservation is not permission to invoke with stale evidence or changed capacity.
    const registry = resources();
    const raw = selectResource(registry, job, now());
    const eligible = raw.decisions.find(decision => decision.id === row.resourceId)?.eligible === true;
    const remaining = store.effective(registry).find(resource => resource.id === row.resourceId)?.capacity;
    const reservationsFit = remaining && Object.values(remaining).every(value => integer(value));
    const adapter = adapters.get(row.resourceId);
    if (!eligible || !reservationsFit || !allowed(job, row.resourceId) || (live(adapter) && !contextMatches(id, adapter))) {
      if (!store.begin(id, now())) return store.find(id);
      return store.finish(id, 'failed', null, 'eligibility_changed_before_invocation', now());
    }
    if (!store.begin(id, now())) return store.find(id);
    const controller = new AbortController();
    let timer;
    const execution = (async () => {
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => adapter.execute(job, { signal: controller.signal,
            mayDispatch: () => allowed(job, row.resourceId) && contextMatches(id, adapter)
              && selectResource(resources(), job, now()).decisions.some(d => d.id === row.resourceId && d.eligible) })),
          new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(Error('invocation_timeout'));
          }, job.timeoutMs); }),
        ]);
        if (live(adapter)) {
          if (!validateReceipt(result, { jobId: id, jobSha256: jobSha256(job), workerSha256: adapter.context.workerSha256 })
            || (result.state === 'accepted' && adapter.kind !== 'github-public-ci')) throw Error('invalid_worker_receipt');
          return store.recordReceipt(id, result, now());
        }
        const json = JSON.stringify(result);
        if (!json || Buffer.byteLength(json) > 16_384) throw Error('invalid_or_oversized_result');
        return store.finish(id, 'completed', JSON.parse(json), '', now());
      } catch (failure) {
        if (failure instanceof PreflightDenied) return store.finish(id, 'failed', null, 'execution_preflight_denied', now());
        // Unknown adapter outcomes cannot release quota or silently fail over.
        return store.finish(id, 'uncertain', null, 'invocation_outcome_uncertain', now());
      } finally { clearTimeout(timer); active.delete(id); }
    })();
    active.set(id, execution);
    return execution;
  }
  async function collect(id) {
    if (!identity(id)) throw Error('invalid_job_id');
    if (collecting.has(id)) return collecting.get(id);
    const row = store.find(id);
    if (!row) throw Error('job_not_found');
    if (!['pending', 'uncertain', 'invoking'].includes(row.state) || active.has(id)) return row;
    const adapter = adapters.get(row.resourceId);
    if (!adapter?.lookup || !contextMatches(id, adapter)) throw Error('execution_context_unavailable');
    const job = store.readInput(id);
    const reading = (async () => {
      try {
        const receipt = await Promise.resolve().then(() => adapter.lookup(job));
        if (!validateReceipt(receipt, { jobId: id, jobSha256: jobSha256(job), workerSha256: adapter.context.workerSha256 }))
          throw Error('invalid_worker_receipt');
        return store.recordReceipt(id, receipt, now());
      } finally { collecting.delete(id); }
    })();
    collecting.set(id, reading); return reading;
  }
  return {
    discover: () => ({ fixtureMode, liveCloudExecutionEnabled: executionEnabled,
      resources: store.effective(resources()), note: 'Execution requires fresh zero-dollar eligibility, exact job authority and a configured adapter.' }),
    plan, submit, submitBatch, run, runBatch: createBatchRunner({ get: store.find, run }), collect,
    get: id => { if (!identity(id)) throw Error('invalid_job_id'); return store.find(id); },
    list: store.list,
    recover: () => { if (active.size) throw Error('active_invocation'); return store.recover(now()); },
  };
}
