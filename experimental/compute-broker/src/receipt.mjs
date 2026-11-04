// Reviewed replacement for Picard's proposal; preserve only validated JSON data.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && !types.isProxy(value) && [null, Object.prototype].includes(Object.getPrototypeOf(value));
const keysAre = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function jsonClone(value, maximumDepth = 12) {
  const seen = new Set(); let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 4096 || depth > maximumDepth) throw Error('invalid_json');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isSafeInteger(item)) return item;
    if (typeof item !== 'object' || types.isProxy(item) || seen.has(item)) throw Error('invalid_json');
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype : !plain(item)) throw Error('invalid_json');
    const keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== 'string') || keys.length > 4096) throw Error('invalid_json');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (array && (!Number.isSafeInteger(item.length) || item.length > 4096 || keys.length !== item.length + 1)) throw Error('invalid_json');
    const dataKeys = array ? keys.filter(key => key !== 'length') : keys;
    if (dataKeys.some(key => !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable
      || (array && !/^(0|[1-9][0-9]*)$/.test(key)))) throw Error('invalid_json');
    seen.add(item); const result = array ? [] : Object.create(null);
    for (const key of dataKeys) Object.defineProperty(result, key,
      { value: visit(descriptors[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
    seen.delete(item); return result;
  }
  return visit(value, 0);
}
export function validateReceipt(value, expected) {
  try {
    const r = jsonClone(value), e = jsonClone(expected);
    if (!keysAre(r, ['schemaVersion', 'jobId', 'jobSha256', 'workerSha256', 'state', 'result', 'reason', 'logs', 'artifacts'])
      || !keysAre(e, ['jobId', 'jobSha256', 'workerSha256']) || r.schemaVersion !== 1
      || typeof e.jobId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(e.jobId)
      || !hash(e.jobSha256) || !hash(e.workerSha256)
      || ['jobId', 'jobSha256', 'workerSha256'].some(key => r[key] !== e[key])
      || !['accepted', 'completed', 'failed', 'uncertain'].includes(r.state)
      || typeof r.reason !== 'string' || !/^[a-z0-9_]{0,80}$/.test(r.reason)
      || (['failed', 'uncertain'].includes(r.state) && !r.reason)
      || !Array.isArray(r.logs) || r.logs.length > 8
      || r.logs.some(line => typeof line !== 'string' || Buffer.byteLength(line) > 256)
      || !Array.isArray(r.artifacts) || r.artifacts.length > 1
      || Buffer.byteLength(JSON.stringify(r)) > 16_384) return false;
    if (['accepted', 'uncertain'].includes(r.state)) {
      if (r.result !== null || r.artifacts.length !== 0) return false;
    } else if (r.state === 'completed' ? !plain(r.result) : r.result !== null && !plain(r.result)) return false;
    jsonClone(r.result, 8);
    for (const artifact of r.artifacts) {
      if (!keysAre(artifact, ['name', 'mediaType', 'byteLength', 'sha256', 'text'])
        || artifact.name !== 'result.json' || artifact.mediaType !== 'application/json'
        || typeof artifact.text !== 'string' || Buffer.byteLength(artifact.text) > 4096
        || artifact.byteLength !== Buffer.byteLength(artifact.text) || !hash(artifact.sha256)
        || artifact.sha256 !== createHash('sha256').update(artifact.text).digest('hex')
        || !isDeepStrictEqual(jsonClone(JSON.parse(artifact.text), 8), r.result)) return false;
    }
    return true;
  } catch { return false; }
}
