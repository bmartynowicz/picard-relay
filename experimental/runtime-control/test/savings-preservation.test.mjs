import assert from'node:assert/strict';
import{mkdtempSync,rmSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{DatabaseSync}from'node:sqlite';import vm from'node:vm';
import{createRelayStore}from'../src/relay-store.mjs';
import{CONSOLE_HTML,CONSOLE_MAX_BYTES}from'../src/oracle-service.mjs';import{admissionConsoleHtml}from'../src/admission-ui.mjs';
const dir=mkdtempSync(join(tmpdir(),'savings-costs-')),path=join(dir,'db.sqlite'),id=n=>n.toString(16).padStart(64,'0');
try{
 const s=createRelayStore({dbPath:path}),u=s.openCodexUsage('owner');
 for(const[variant,n,tools]of[['baseline',1,[]],['assisted',2,['picard']]])assert.equal(u.record({v:1,id:id(n),model:'gpt-6.1-sol',effort:'low',recordedAt:n,inputTokens:10000,cachedInputTokens:0,outputTokens:100,tools,comparisonId:'test-costs',variant}),'saved');
 for(const variant of['baseline','assisted'])assert.equal(u.record({v:1,kind:'workflow',comparisonId:'test-costs',variant,preparationIds:[],picardRefs:variant==='assisted'?[id(3)]:[]}),'saved');
 const db=new DatabaseSync(path),usage={v:1,provider:'groq',model:'openai/gpt-oss-20b',inputTokens:100,outputTokens:30,totalTokens:130};
 db.prepare('INSERT INTO relay_jobs(event_id,owner,task,message_id,grant_id,grant_expires,payload_hash,payload_json,state,result_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id(3),'owner','task','message','grant',10000,'hash','{}','completed',JSON.stringify({providerUsage:usage}),1,2);
 db.exec('CREATE TABLE relay_codex_cost_breakdowns(id TEXT PRIMARY KEY,owner TEXT,comparison_id TEXT,record TEXT)');
 const cost={modelCredits:.525,setupCredits:1,coordinationCredits:2,fullCredits:3.525};db.prepare('INSERT INTO relay_codex_cost_breakdowns VALUES(?,?,?,?)').run(id(20),'owner','test-costs',JSON.stringify({sides:{baseline:cost,assisted:{...cost,coordinationCredits:3,fullCredits:4.525}}}));
 function quality(side,pass,n){const root=side==='baseline'?id(1):id(2);assert.equal(u.record({v:1,kind:'quality',id:id(n),comparisonId:'test-costs',rootId:root,initialReviewId:root,taskFingerprint:id(8),evidenceSha256:id(9),firstPassPassed:pass,finalQualified:pass,repairIds:[],recheckIds:[],providerRef:side==='baseline'?null:id(3),providerModel:side==='baseline'?null:usage.model}),'saved');}
 assert.equal(u.overview().rolling.sampleCount,0);assert.equal(u.overview().rolling.excluded.quality,1);
 quality('baseline',true,10);quality('assisted',false,11);let failed=u.overview();assert.equal(failed.rolling.sampleCount,0);assert.equal(failed.rolling.savedCredits,null);assert.equal(failed.runs.find(x=>x.comparison)?.comparison.savingsEligible,false);
 quality('assisted',true,12);let passed=u.overview();assert.equal(passed.rolling.sampleCount,1);assert.equal(passed.rolling.baselineCredits,3.525);assert.equal(passed.rolling.assistedCredits,4.525);assert.ok(passed.rolling.savedCredits<0);assert.equal(passed.runs.find(x=>x.comparison).comparison.baseline.costs.modelCredits,.525);
 quality('baseline',false,13);assert.equal(u.overview().rolling.sampleCount,0);
 assert.equal(s.openCodexUsage('other-owner').overview().runs.length,0);
 const source=readFileSync(new URL('../src/oracle-service.mjs',import.meta.url),'utf8'),start=source.indexOf('function renderCodexSavings(usage){'),end=source.indexOf('\n`;',start);assert.ok(start>0&&end>start);
 class E{constructor(tag){this.tag=tag;this.textContent='';this.children=[];}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}}
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new E('div'));return nodes.get(id);};
 const context={document:{createElement:tag=>new E(tag)},$:get,lastCodexUsage:'',input:failed};vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nrenderCodexSavings(input);',context);
 const text=node=>[node.textContent,...node.children.map(text)].join('\n'),rendered=text(get('codex-savings-comparisons'));
 for(const label of['Task-model work:','Setup:','Coordination and reporting:','Full recorded total:','Savings excluded:'])assert.ok(rendered.includes(label),label);
 assert.ok(!rendered.includes('Whole-workflow Codex estimate:'));assert.ok(!rendered.includes('fewer estimated Standard credits'));
 const workspace=admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true,workspaceEnabled:true});
 const publicWorkspace=admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true,workspaceEnabled:true,publicTestEnabled:true});
 const originalPreview=workspace.replace('</style>','.preview-banner{position:relative;z-index:3;padding:9px 24px;border-bottom:1px solid #303b3f;color:#dec387;font:13px system-ui}</style>').replace('<body>','<body><div class="preview-banner">Local preview · synthetic answers and metrics · no external AI calls</div>');
 assert.ok(Buffer.byteLength(CONSOLE_HTML)<=CONSOLE_MAX_BYTES,'console size limit');
 assert.ok(Buffer.byteLength(publicWorkspace)<=CONSOLE_MAX_BYTES,'complete admission console size limit');
 assert.ok(Buffer.byteLength(originalPreview)<=CONSOLE_MAX_BYTES,'original synthetic workspace preview size limit');
 db.close();s.close();console.log(JSON.stringify({passed:true,checks:['missing quality excluded','failed quality excluded','both pass eligible','full totals used','cost categories rendered','failed-row savings suppressed','owner isolation','console size','original preview size'],consoleBytes:Buffer.byteLength(CONSOLE_HTML),workspaceBytes:Buffer.byteLength(workspace),publicWorkspaceBytes:Buffer.byteLength(publicWorkspace),originalPreviewBytes:Buffer.byteLength(originalPreview),cap:CONSOLE_MAX_BYTES}));
}finally{assert.ok(dir.startsWith(join(tmpdir(),'savings-costs-')));try{rmSync(dir,{recursive:true,force:true});}catch{}}
