// Offline synthetic UI qualification. This never starts a server or connects to
// Picard, a Board, an account or a provider. Password/session behavior is mocked.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {CONSOLE_HTML} from '../experimental/runtime-control/src/oracle-service.mjs';
const hash=createHash('sha256').update(CONSOLE_HTML).digest('hex');
const bootstrap=`<script>
(()=>{
let authenticated=true,unavailable=false,denied=0,completed=37,stale=false;
const preference={matches:false,listeners:[],addEventListener(name,fn){if(name==='change')this.listeners.push(fn)}};
window.matchMedia=()=>preference;
window.addEventListener('message',event=>{if(event.source!==parent)return;const action=event.data?.fixtureAction;if(action==='401'||action==='403')denied=Number(action);if(action==='unavailable')unavailable=true;if(action==='increment')completed++;if(action==='stale')stale=true;if(action==='reduced'){preference.matches=true;for(const fn of preference.listeners)fn();}});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(path,options={})=>{
 if(path==='/auth/state')return json({enrolled:true});
 if(path==='/auth/logout'){authenticated=false;return json({ok:true})}
 if(path==='/auth/login'){authenticated=true;denied=0;return json({ok:true})}
 if(!authenticated||denied)return json({error:'auth_failed'},denied||401);
 if(unavailable)return json({error:'fixture_unavailable'},503);
 const at=Date.now()-(stale?120000:0),observedAt=new Date(at).toISOString();
 if(path==='/status')return json({v:1,observedAt,service:{ready:true,providerReady:false,resultRecoveryReady:true,acceptingNewWork:false,draining:false},jobs:{queued:2,invoking:0,completed,uncertain:1},release:{hash:'a'.repeat(64),version:null},updater:{state:'unknown'}});
 if(path==='/jobs')return json({v:1,observedAt,nextCursor:'fixture-next',rows:[{ref:'a'.repeat(64),state:'uncertain',reasonCode:'outcome_uncertain',resultAvailable:false},{ref:'b'.repeat(64),state:'blocked',reasonCode:'provider_quota',resultAvailable:false},{ref:'c'.repeat(64),state:'completed',reasonCode:'completed',resultAvailable:true}].map((row,index)=>({...row,createdAt:at-(index+1)*60000,updatedAt:at-index*60000}))});
 if(path.startsWith('/jobs?cursor='))return json({v:1,observedAt,nextCursor:null,rows:[{ref:'d'.repeat(64),state:'invoking',reasonCode:'invoking',resultAvailable:false,createdAt:at-600000,updatedAt:at-200000}]});
 throw Error('Unexpected synthetic request; no network fallback');
};
})();
<\/script>`;
const exact=CONSOLE_HTML.replace('<script>',bootstrap+'\n<script>');
const encoded=JSON.stringify(exact).replace(/</g,'\\u003c');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Picard console · synthetic preview</title><style>*{box-sizing:border-box}body{margin:0;background:#090e10;color:#e9ede9;font:13px system-ui}header{padding:15px 20px;background:#1a2225;border-bottom:1px solid #3c474a}h1{font-size:16px;margin:0 0 6px}p{margin:5px 0 12px;color:#b0babc;font-size:11px}button,select{font:12px system-ui;padding:8px;margin:3px 4px 3px 0;background:#263136;color:#ecede9;border:1px solid #536064;border-radius:4px}iframe{display:block;border:0;width:100%;height:1050px;margin:auto;background:#101416}label{font-size:12px}#frame-wrap{overflow:auto}code{font-size:10px;overflow-wrap:anywhere}</style><header><h1>Picard console — synthetic preview</h1><p>Fake metadata only. No Picard connection, owner session, credentials, provider calls or real work.</p><label for="width">Viewport </label><select id="width"><option value="1440">Desktop · 1440 px</option><option value="960">Laptop · 960 px</option><option value="375">Phone · 375 px</option><option value="320">Small phone · 320 px</option></select><button id="reset">Reset fixture</button><button data-action="401">Simulate 401</button><button data-action="403">Simulate 403</button><button data-action="unavailable">Simulate unavailable</button><button data-action="increment">Increment count</button><button data-action="stale">Stale observation</button><button data-action="reduced">Synthetic reduced motion</button><p>After a response change, use Refresh inside the console. Synthetic motion is not a native OS media test. Exact source HTML SHA256: <code>${hash}</code></p></header><div id="frame-wrap"><iframe id="fixture" title="Synthetic authenticated Picard console" sandbox="allow-scripts allow-same-origin"></iframe></div><script>
const frame=document.getElementById('fixture'),source=${encoded};function reset(){frame.srcdoc=source}document.getElementById('reset').addEventListener('click',reset);document.getElementById('width').addEventListener('change',event=>frame.style.width=event.target.value+'px');for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>frame.contentWindow.postMessage({fixtureAction:button.dataset.action},location.origin));reset();
</script></html>`;
const output=resolve(process.argv[2]??'console-preview.html');writeFileSync(output,html);
console.log(JSON.stringify({path:output,synthetic:true,sourceHtmlSha256:hash,previewSha256:createHash('sha256').update(html).digest('hex'),bytes:Buffer.byteLength(html)}));
