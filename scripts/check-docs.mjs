import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=async path=>readFile(resolve(root,path),'utf8');
const map=JSON.parse(await read('docs/project-map.json'));
const work=JSON.parse(await read('docs/work-register.json'));
const policy=JSON.parse(await read('experimental/updater/policy.example.json'));
const errors=[];
async function exists(path,from){
 const target=resolve(root,path),local=relative(root,target);
 if(local.startsWith('..')||local.startsWith('/')){errors.push(`${from}: path escapes repository: ${path}`);return;}
 try{if(!(await stat(target)).isFile())errors.push(`${from}: not a file: ${path}`);}catch{errors.push(`${from}: missing file: ${path}`);}
}
if(map.schemaVersion!==1||work.schemaVersion!==1)errors.push('Unsupported documentation schema version');
if(map.runtime.moduleCount!==policy.allowedFiles.length)errors.push('Runtime module count differs from actual release allowlist');
const documents=['README.md','AGENTS.md','llms.txt','docs/README.md',...map.guides,'docs/self-hosted-console.md','experimental/README.md','experimental/runtime-control/README.md','experimental/updater/README.md'];
for(const path of new Set(documents)){
 await exists(path,'documentation index');const text=await read(path);
 for(const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
  const href=match[1];if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('#'))continue;
  const part=decodeURIComponent(href.split('#')[0]);if(part)await exists(relative(root,resolve(root,dirname(path),part)),path);
 }
}
for(const component of map.components)await exists(component.path,'project map');
for(const picture of map.illustrations??[]){await exists(picture.path,'illustration');await exists(picture.textEquivalent,'illustration text equivalent');const svg=await read(picture.path);if(!svg.includes('<title')||!svg.includes('<desc'))errors.push('Illustration lacks accessible title/description: '+picture.path);}
for(const path of [map.documentationIndex,map.aiEntry,map.contributorInstructions,map.runtime.allowlist,map.release.workflow,map.release.envelope,map.workRegister])await exists(path,'project map');
const ids=new Set();for(const item of work.items){
 if(ids.has(item.id))errors.push('Duplicate work ID: '+item.id);ids.add(item.id);
 if(!['bug','feature'].includes(item.kind)||!Object.hasOwn(work.statusGuide,item.status))errors.push('Invalid work state: '+item.id);
 for(const path of [...(item.sourceFiles??[]),...(item.tests??[])])await exists(path,item.id);
}
const register=await read('docs/WORK-REGISTER.md');for(const id of ids)if(!register.includes(id))errors.push('Work summary is missing '+id);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`Documentation checks passed: ${new Set(documents).size} entry/guides, ${ids.size} work records, ${policy.allowedFiles.length} runtime modules. No network or provider calls.`);
