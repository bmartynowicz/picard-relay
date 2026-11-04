import { validWorkload, identity, integer, object } from './policy.mjs';

export function normalizeJob(value) {
  if (!validWorkload(value) || !['word-count', 'sha256', 'project-checks'].includes(value.operation)
    || !identity(value.id) || !object(value.input) || typeof value.input.text !== 'string'
    || Buffer.byteLength(value.input.text, 'utf8') > 12_000
    || !integer(value.timeoutMs, 1) || value.timeoutMs > 30_000) throw Error('invalid_job');
  if (Object.keys(value).some(key => !['id', 'operation', 'workload', 'arch', 'needs', 'input', 'timeoutMs'].includes(key))
    || Object.keys(value.input).some(key => key !== 'text')
    || Object.keys(value.needs).some(key => !['cpuMs', 'ramMb', 'diskMb', 'gpus'].includes(key))) throw Error('unknown_job_field');
  if (value.operation === 'project-checks' && (value.workload !== 'project-ci' || !/^[0-9a-f]{40}$/.test(value.input.text)))
    throw Error('invalid_project_ci_job');
  const { cpuMs, ramMb, diskMb, gpus } = value.needs;
  return { id: value.id, operation: value.operation, workload: value.workload, arch: value.arch,
    needs: { cpuMs, ramMb, diskMb, gpus }, input: { text: value.input.text }, timeoutMs: value.timeoutMs };
}
