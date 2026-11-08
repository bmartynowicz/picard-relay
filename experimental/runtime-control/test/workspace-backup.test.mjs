import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {workspaceFixture} from '../../../test/fixtures/workspace-fixture.mjs';
import {backupLedger} from '../../../scripts/backup-ledger.mjs';
test('consistent backup and isolated restore retain result, approval and review without replay',async t=>{
 const f=await workspaceFixture();t.after(()=>f.close());const d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);await f.dispatcher.runOnce();const result=(await f.request('/workspace/requests/'+d.payload.eventId)).body;
 await f.request('/workspace/reviews/'+d.payload.eventId,{body:{expectedRevision:0,decision:'accepted',note:'Backup fixture review.',resultSha256:result.result.sha256}});
 await f.request('/workspace/grades/'+d.payload.eventId,{body:{expectedRevision:0,score:4,note:'Backup fixture grade.',resultSha256:result.result.sha256}});
 const outputDirectory=path.join(f.dir,'backup'),manifest=await backupLedger({database:f.dbPath,outputDirectory});assert.equal(manifest.integrity,'ok');assert.equal(manifest.workspaceRecords,4);assert.equal(manifest.jobCounts.find(x=>x.state==='completed').count,1);
 const restored=new DatabaseSync(path.join(outputDirectory,'ledger.sqlite'),{readOnly:true});try{const row=restored.prepare('SELECT * FROM relay_jobs WHERE event_id=?').get(d.payload.eventId);assert.equal(row.state,'completed');assert.equal(JSON.parse(row.result_json).body,f.output);assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM relay_nonces WHERE nonce GLOB '*owner-console:*'").get().n,1);const grade=restored.prepare("SELECT nonce FROM relay_nonces WHERE nonce GLOB '*:grade:*'").get().nonce;assert.equal(JSON.parse(Buffer.from(grade.slice(grade.lastIndexOf(':')+1),'base64url')).score,4);}finally{restored.close();}
 await assert.rejects(()=>backupLedger({database:f.dbPath,outputDirectory}));assert.equal((await f.dispatcher.runOnce()).status,'idle');assert.equal(f.calls,1);assert.equal(fs.existsSync(path.join(outputDirectory,'manifest.json')),true);
});
