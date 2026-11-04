import { selectResource, validWorkload, identity, integer, object } from './policy.mjs';

export function normalizeJob(value) {
  if (!validWorkload(value) || !['word-count', 'sha256'].includes(value.operation) || !identity(value.id) || !object(value.input)
    || typeof value.input.text !== 'string' || Buffer.byteLength(value.input.text, 'utf8') > 12_000
    || !integer(value.timeoutMs, 1) || value.timeoutMs > 30_000) throw Error('invalid_job');
  if (Object.keys(value).some(key => !['id', 'operation', 'workload', 'arch', 'needs', 'input', 'timeoutMs'].includes(key))
    || Object.keys(value.input).some(key => key !== 'text')
    || Object.keys(value.needs).some(key => !['cpuMs', 'ramMb', 'diskMb', 'gpus'].includes(key))) throw Error('unknown_job_field');
  const { cpuMs, ramMb, diskMb, gpus } = value.needs;
  return { id: value.id, operation: value.operation, workload: value.workload, arch: value.arch,
    needs: { cpuMs, ramMb, diskMb, gpus }, input: { text: value.input.text }, timeoutMs: value.timeoutMs };
}

export function createBroker({ store, resources = () => [], adapters = new Map(), fixtureMode = false, now = Date.now }) {
  const active = new Map();
  function plan(value) {
    const job = normalizeJob(value);
    const registry = resources();
    // Validate raw numeric types before subtracting allocations: arithmetic must not coerce strings.
    const raw = selectResource(registry, job, now());
    if (raw.decisions.some(decision => decision.id === null)) return raw;
    const allowed = new Set(raw.decisions.filter(decision => decision.eligible).map(decision => decision.id));
    const effective = store.effective(registry).map(resource => ({ ...resource,
      enabled: resource.enabled === true && allowed.has(resource.id)
        && fixtureMode === true && adapters.get(resource.id)?.kind === 'local-fixture' }));
    const selected = selectResource(effective, job, now());
    return { ...selected, fixtureMode, liveCloudExecutionEnabled: false,
      note: 'Operator evidence is not an independent live billing guarantee. Fixture adapters cannot enable cloud execution.' };
  }
  function submit(value) {
    const job = normalizeJob(value);
    return store.transaction(() => {
      const replay = store.replay(job);
      if (replay) return replay;
      const selection = plan(job);
      return store.insert(job, selection.resourceId,
        selection.resourceId ? '' : JSON.stringify(selection.decisions), now());
    });
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
    if (!eligible || !reservationsFit || !fixtureMode || adapter?.kind !== 'local-fixture') {
      if (!store.begin(id, now())) return store.find(id);
      return store.finish(id, 'failed', null, 'eligibility_changed_before_invocation', now());
    }
    if (!store.begin(id, now())) return store.find(id);
    const controller = new AbortController();
    let timer;
    const execution = (async () => {
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => adapter.execute(job, { signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(Error('invocation_timeout'));
          }, job.timeoutMs); }),
        ]);
        const json = JSON.stringify(result);
        if (!json || Buffer.byteLength(json) > 16_384) throw Error('invalid_or_oversized_result');
        return store.finish(id, 'completed', JSON.parse(json), '', now());
      } catch {
        // Unknown adapter outcomes cannot release quota or silently fail over.
        return store.finish(id, 'uncertain', null, 'invocation_outcome_uncertain', now());
      } finally { clearTimeout(timer); active.delete(id); }
    })();
    active.set(id, execution);
    return execution;
  }
  return {
    discover: () => ({ fixtureMode, liveCloudExecutionEnabled: false,
      resources: store.effective(resources()), note: 'No live execution provider is enrolled.' }),
    plan, submit, run,
    get: id => { if (!identity(id)) throw Error('invalid_job_id'); return store.find(id); },
    list: store.list,
    recover: () => { if (active.size) throw Error('active_invocation'); return store.recover(now()); },
  };
}
