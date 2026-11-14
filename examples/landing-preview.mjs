// Local concept preview. Explicit static allowlist; no provider or runtime access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const files=new Map([
 ['/',[new URL('./landing/index.html',import.meta.url),'text/html; charset=utf-8']],
 ['/landing.css',[new URL('./landing/landing.css',import.meta.url),'text/css; charset=utf-8']],
 ['/landing.js',[new URL('./landing/landing.js',import.meta.url),'text/javascript; charset=utf-8']],
 ['/setup-flow.mjs',[new URL('./landing/setup-flow.mjs',import.meta.url),'text/javascript; charset=utf-8']],
 ['/learning-guide.mjs',[new URL('./landing/learning-guide.mjs',import.meta.url),'text/javascript; charset=utf-8']],
 ['/public-test.mjs',[new URL('./landing/public-test.mjs',import.meta.url),'text/javascript; charset=utf-8']],
 ['/console.css',[new URL('./landing/console.css',import.meta.url),'text/css; charset=utf-8']],
 ['/mark.svg',[new URL('./landing/mark.svg',import.meta.url),'image/svg+xml']],
]);
const parts=JSON.parse(await readFile(new URL('./landing/console-parts.json',import.meta.url),'utf8'));
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server=createServer(async(req,res)=>{
 res.setHeader('content-security-policy',csp);res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('cache-control','no-store');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'allow':'GET, HEAD'});res.end();return;}
 const match=files.get(req.url);if(!match){res.writeHead(404);res.end('Not found');return;}
 try{let bytes=await readFile(fileURLToPath(match[0]));if(req.url==='/')bytes=Buffer.from(bytes.toString().replace('<!-- PICARD_MARK -->',parts.mark).replace('<!-- PICARD_SCENE -->',parts.scene));res.writeHead(200,{'content-type':match[1],'content-length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);}
 catch{res.writeHead(500);res.end('Preview asset unavailable');}
});
const port=Number(process.env.PICARD_LANDING_PORT??0);
if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('landing_port');
server.listen(port,'127.0.0.1',()=>console.log('Picard Relay local setup cockpit: http://127.0.0.1:'+server.address().port+'\nNo connected relay, installation or external AI calls. Stop with Ctrl+C.'));
