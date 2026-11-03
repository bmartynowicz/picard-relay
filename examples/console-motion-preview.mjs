// Local synthetic presentation fixture. No provider adapter, durable database,
// enrollment, credentials or production listener is created.
import {createServer} from 'node:http';
import {CONSOLE_HTML,createConsoleHandler,consoleSnapshot} from '../experimental/runtime-control/src/oracle-service.mjs';

let completed=13;
const controls=`<aside class="motion-preview" aria-label="Preview controls"><strong>Motion preview</strong><p>Synthetic counts · local only · no AI calls</p><button type="button" data-preview="next">Apply sample change</button><button type="button" data-preview="carry">Show 99 → 100</button><button type="button" data-preview="decrease">Show 100 → 99</button><button type="button" data-preview="reset">Reset sample</button><p role="status" id="preview-message">Use a sample change to see the counters roll.</p></aside>`;
const previewScript=`<script>
for(const button of document.querySelectorAll('[data-preview]'))button.addEventListener('click',async()=>{
 for(const control of document.querySelectorAll('[data-preview]'))control.disabled=true;
 try{const response=await fetch('/preview/change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.preview})});if(!response.ok)throw Error('preview');const result=await response.json();document.querySelector('#preview-message').textContent=result.message;document.querySelector('#refresh').click();}
 catch{document.querySelector('#preview-message').textContent='Preview unavailable. Restart the local fixture.';}
 finally{for(const control of document.querySelectorAll('[data-preview]'))control.disabled=false;}
});
</script>`;
// Carry/decrease first establish a static start value, then the next click
// makes the actual transition through the normal status renderer.
let nextTarget=null;
const html=CONSOLE_HTML.replace('</style>',`.motion-preview{padding:18px 24px;border-bottom:1px solid var(--line);background:var(--side)}.motion-preview strong{color:var(--accent)}.motion-preview p{font-size:13px;color:var(--muted);margin:5px 0 12px}.motion-preview button{margin:0 8px 8px 0;font-size:13px}</style>`).replace('<body>','<body>'+controls).replace('</body>',previewScript+'</body>');
// The production handler's HTTPS-origin contract stays unchanged. Its loopback
// fixture uses the same virtual proxy origin as the existing local previews.
const handler=createConsoleHandler({enabled:true,html,origins:['https://127.0.0.1:4390'],auth:{readPublicState:()=>({enrolled:true}),authenticate:()=>true},getSnapshot:()=>consoleSnapshot({serviceReady:true,resultRecoveryReady:true,providerReady:true,acceptingNewWork:true,draining:false,blockingCode:'ready'},[{state:'completed',count:completed},{state:'failed',count:1},{state:'uncertain',count:3}],new Date(),'owner'),getRecentJobs:()=>({rows:[],nextCursor:null})});
createServer(async(req,res)=>{
 if(req.url==='/preview/change'&&req.method==='POST'){
  if(req.headers.origin!=='http://127.0.0.1:4390'){res.writeHead(403);res.end();return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>128){res.writeHead(413);res.end();return;}}
  try{
   const {action}=JSON.parse(body);let message;
   if(action==='next'){completed=nextTarget??Math.min(completed+1,10000);nextTarget=null;message='Sample completed count is now '+completed+'.';}
   else if(action==='carry'){completed=99;nextTarget=100;message='Sample is 99. Apply sample change to roll to 100.';}
   else if(action==='decrease'){completed=100;nextTarget=99;message='Sample is 100. Apply sample change to roll down to 99.';}
   else if(action==='reset'){completed=13;nextTarget=null;message='Sample reset to 13.';}
   else throw Error('action');
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message}));
  }catch{res.writeHead(400);res.end();}return;
 }
 if(req.method!=='GET'){res.writeHead(403);res.end();return;}
 if(!await handler(req,res)){res.writeHead(404);res.end();}
}).listen(4390,'127.0.0.1',()=>console.log('Synthetic counter preview: http://127.0.0.1:4390'));
