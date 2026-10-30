import {readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const policy=JSON.parse(await readFile('experimental/updater/policy.example.json'));
if(process.env.GITHUB_REPOSITORY!=='bmartynowicz/picard-relay'||process.env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??''))throw Error('release_context_invalid');
const run=Number(process.env.GITHUB_RUN_NUMBER),attempt=Number(process.env.GITHUB_RUN_ATTEMPT);if(!Number.isSafeInteger(run)||run<1||!Number.isSafeInteger(attempt)||attempt<1||attempt>999)throw Error('release_sequence_invalid');
const files=[],specs=[];let total=0;
for(const path of policy.allowedFiles){if(!/^src\/[a-z][a-z0-9-]*\.mjs$/.test(path))throw Error('release_path_invalid');const local='experimental/runtime-control/'+path,s=await lstat(local);if(!s.isFile()||s.isSymbolicLink()||s.size>262144)throw Error('release_file_invalid');const bytes=await readFile(local);total+=bytes.length;files.push({path,base64:bytes.toString('base64')});specs.push({path,sha256:hash(bytes),bytes:bytes.length});}
if(total>1048576||new Set(policy.allowedFiles).size!==11)throw Error('release_scope_invalid');
const bundle=Buffer.from(JSON.stringify({files}));
const manifest={format:1,product:'picard-relay',channel:'stable',version:`0.1.${run}`,sequence:run*1000+attempt,expiresAt:Date.now()+7*86400000,nodeMajor:24,stateSchema:1,migration:'none',sourceCommit:process.env.GITHUB_SHA,bundleSha256:hash(bundle),files:specs};
await mkdir('release-output',{recursive:true});await writeFile('release-output/manifest.json',JSON.stringify(manifest));await writeFile('release-output/bundle.json',bundle);
console.log(`Prepared ${files.length} source files, ${total} bytes; no deployment.`);
