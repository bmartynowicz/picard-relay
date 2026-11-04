// SQLite-consistent snapshot into a NEW private directory. Never restores over
// a running ledger, copies credentials, or resets invocation evidence.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function backupLedger({database,outputDirectory}={}){
 if(!path.isAbsolute(database??'')||!path.isAbsolute(outputDirectory??'')||fs.realpathSync(database)!==database||fs.existsSync(outputDirectory))throw Error('Use an existing absolute database path and a new absolute backup directory.');
 const source=fs.lstatSync(database),parent=path.dirname(outputDirectory);
 if(!source.isFile()||source.nlink!==1||fs.realpathSync(parent)!==parent)throw Error('Unsafe backup path.');
 fs.mkdirSync(outputDirectory,{mode:0o700});const target=path.join(outputDirectory,'ledger.sqlite');
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  const pages=await backup(db,target);fs.chmodSync(target,0o600);
  const copy=new DatabaseSync(target,{readOnly:true});let checks,counts,workspaceRecords;
  try{checks=copy.prepare('PRAGMA integrity_check').all();counts=copy.prepare('SELECT state,COUNT(*) AS count FROM relay_jobs GROUP BY state ORDER BY state').all();workspaceRecords=copy.prepare("SELECT COUNT(*) AS count FROM relay_nonces WHERE nonce GLOB 'picard-admission:v1:workspace:*'").get().count;}finally{copy.close();}
  if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw Error('Backup integrity check failed. Preserve the incomplete directory for inspection.');
  const manifest={schemaVersion:1,kind:'PICARD_LEDGER_BACKUP',createdAt:new Date().toISOString(),node:process.version,pages,bytes:fs.statSync(target).size,sha256:createHash('sha256').update(fs.readFileSync(target)).digest('hex'),integrity:'ok',jobCounts:counts,workspaceRecords,includes:['jobs','saved results','approval records','drafts','local reviews','revocations'],excludes:['invocation markers and cost latches','owner-auth state','credentials','host configuration','update state'],restore:'Offline operator procedure only. Keep the matching marker, auth and configuration snapshot; never overwrite active state.'};
  fs.writeFileSync(path.join(outputDirectory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return manifest;
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--database'||args[2]!=='--output'){console.error('Usage: node scripts/backup-ledger.mjs --database /absolute/ledger.sqlite --output /absolute/new-backup-directory');process.exitCode=2;}
 else try{console.log(JSON.stringify(await backupLedger({database:args[1],outputDirectory:args[3]})));}catch(e){console.error(e.message);process.exitCode=1;}
}
