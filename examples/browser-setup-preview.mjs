// Loopback-only visual fixture. No files, cloud access, real auth, or model calls.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createBrowserSetupHandler} from '../scripts/serve-browser-setup.mjs';
import {initialBrowserState,digest} from '../scripts/browser-setup-core.mjs';
import {BROWSER_SETUP_HTML} from '../scripts/browser-setup-ui.mjs';
const claim='A'.repeat(43),config={v:1,hostname:'picard.localhost',claimSha256:digest(claim)},identity=initialBrowserState(config).identity,token=randomBytes(32).toString('base64url');
let enrolled=false,state='waiting';
const session=()=>({token,expiresAt:Date.now()+3600000});
const auth={readPublicState:async()=>({enrolled}),setup:async()=>{enrolled=true;return session();},login:async()=>session(),authenticate:async t=>t===token,logout:async()=>true};
const html=BROWSER_SETUP_HTML.replace('<body>','<body><aside class="preview-note">Local preview · synthetic setup · use made-up credentials only</aside>').replace('</style>','.preview-note{padding:8px 20px;text-align:center;font-size:12px;color:#dec387;background:#111a22}</style>');
const handler=createBrowserSetupHandler({auth,config,identity,html,readStatus:()=>({state}),enqueue:async()=>{state='connecting';setTimeout(()=>state='ready',2200);}});
const server=createServer(async(req,res)=>{
 if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
 if(req.url==='/status'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({service:{ready:state==='ready'}}));return;}
 if(req.url==='/'&&state==='ready'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end('<title>Setup complete · preview</title><body style="background:#080e18;color:#dec387;font:20px system-ui;padding:12vh 8vw"><h1>Welcome aboard.</h1><p>Synthetic setup complete. A real relay now opens its cockpit.</p><a style="color:inherit" href="http://127.0.0.1:4402/">Back to the setup cockpit</a>');return;}
 // Development adapter only: production handler still receives its real HTTPS
 // host and Origin. Never export this adapter in the host publication allowlist.
 req.headers.host=config.hostname;if(req.headers.origin)req.headers.origin='https://'+config.hostname;
 try{if(!await handler(req,res))res.writeHead(404).end();}catch{res.writeHead(503).end();}
});
server.listen(Number(process.env.PICARD_FIRST_RUN_PREVIEW_PORT??4403),'127.0.0.1',()=>console.log('Synthetic first-run preview: http://127.0.0.1:'+server.address().port+'/#claim='+claim));
