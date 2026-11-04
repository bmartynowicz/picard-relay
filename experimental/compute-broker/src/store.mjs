import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, openSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';

export function createStore(filename) {
  if (filename !== ':memory:') {
    const parent = lstatSync(dirname(filename));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error('private_state_directory_required');
    if (process.platform !== 'win32' && ((parent.mode & 0o077) !== 0 || parent.uid !== process.getuid()))
      throw Error('private_state_directory_required');
    try { closeSync(openSync(filename, 'wx', 0o600)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const file = lstatSync(filename);
    if (!file.isFile() || file.isSymbolicLink()) throw Error('private_state_file_required');
    if (process.platform !== 'win32' && ((file.mode & 0o077) !== 0 || file.uid !== process.getuid()))
      throw Error('private_state_file_required');
  }
  const db = new DatabaseSync(filename);
  const application = db.prepare('PRAGMA application_id').get().application_id;
  if ((application !== 0 && application !== 0x50434342)
    || (application === 0 && db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n !== 0)) {
    db.close(); throw Error('unrelated_database');
  }
  db.exec('PRAGMA application_id=1346585410');
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, input_json TEXT NOT NULL,
      state TEXT NOT NULL, resource_id TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, result_json TEXT, reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS allocations (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id), resource_id TEXT NOT NULL,
      cpu_ms INTEGER NOT NULL, ram_mb INTEGER NOT NULL, disk_mb INTEGER NOT NULL,
      gpus INTEGER NOT NULL, state TEXT NOT NULL
    );`);
  const getRow = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const project = row => row ? {
    id: row.id, state: row.state, resourceId: row.resource_id,
    createdAt: row.created_at, updatedAt: row.updated_at, reason: row.reason,
    result: row.result_json === null ? null : JSON.parse(row.result_json),
  } : null;
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return {
    transaction,
    find: id => project(getRow(id)),
    readInput: id => { const row = getRow(id); return row ? JSON.parse(row.input_json) : null; },
    list: () => db.prepare('SELECT * FROM jobs ORDER BY created_at DESC,id LIMIT 100').all().map(project),
    replay(job) {
      const row = getRow(job.id);
      if (!row) return null;
      const hash = createHash('sha256').update(JSON.stringify(job)).digest('hex');
      if (row.input_hash !== hash) throw Error('job_identity_conflict');
      return project(row);
    },
    effective(resources) {
      return resources.map(resource => {
        const usage = db.prepare(`SELECT COALESCE(SUM(cpu_ms),0) AS cpu,
          COALESCE(SUM(CASE WHEN state!='spent' THEN ram_mb ELSE 0 END),0) AS ram,
          COALESCE(SUM(CASE WHEN state!='spent' THEN disk_mb ELSE 0 END),0) AS disk,
          COALESCE(SUM(CASE WHEN state!='spent' THEN gpus ELSE 0 END),0) AS gpus,
          COALESCE(SUM(CASE WHEN state!='spent' THEN 1 ELSE 0 END),0) AS slots
          FROM allocations WHERE resource_id=?`).get(resource.id);
        if (!resource.capacity) return resource;
        const c = resource.capacity;
        return { ...resource, capacity: { cpuMs: c.cpuMs - usage.cpu, ramMb: c.ramMb - usage.ram,
          diskMb: c.diskMb - usage.disk, gpus: c.gpus - usage.gpus, slots: c.slots - usage.slots } };
      });
    },
    insert(job, resourceId, reason, now) {
      const json = JSON.stringify(job);
      db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)').run(job.id,
        createHash('sha256').update(json).digest('hex'), json,
        resourceId ? 'reserved' : 'blocked', resourceId, now, now, null, reason);
      if (resourceId) db.prepare('INSERT INTO allocations VALUES (?,?,?,?,?,?,?)').run(
        job.id, resourceId, job.needs.cpuMs, job.needs.ramMb, job.needs.diskMb, job.needs.gpus, 'active');
      return project(getRow(job.id));
    },
    begin(id, now) {
      return db.prepare("UPDATE jobs SET state='invoking',updated_at=?,reason='' WHERE id=? AND state='reserved'")
        .run(now, id).changes === 1;
    },
    finish(id, state, result, reason, now) {
      transaction(() => {
        const changed = db.prepare("UPDATE jobs SET state=?,result_json=?,reason=?,updated_at=? WHERE id=? AND state='invoking'")
          .run(state, result === null ? null : JSON.stringify(result), reason, now, id).changes;
        if (changed !== 1) throw Error('invalid_job_transition');
        db.prepare('UPDATE allocations SET state=? WHERE job_id=?')
          .run(state === 'uncertain' ? 'uncertain' : 'spent', id);
      });
      return project(getRow(id));
    },
    // Explicit crash reconciliation; never invoke a recovered job again.
    recover(now) {
      return transaction(() => {
        const result = db.prepare("UPDATE jobs SET state='uncertain',reason='interrupted_invocation',updated_at=? WHERE state='invoking'").run(now);
        db.exec("UPDATE allocations SET state='uncertain' WHERE job_id IN (SELECT id FROM jobs WHERE state='uncertain')");
        return result.changes;
      });
    },
    close: () => db.close(),
  };
}
