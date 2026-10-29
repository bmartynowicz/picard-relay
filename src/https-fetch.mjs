// Native TLS transport for --jitless; never uses Undici/WebAssembly or retries.
import https from 'node:https';
import http from 'node:http';
import {Readable} from 'node:stream';
const ENDPOINT='https://api.groq.com/openai/v1/chat/completions';
function requestOnce(url,options,transport,fixtureCa){
 return new Promise((resolve,reject)=>{
  if(options?.method!=='POST'||options.redirect!=='error'||typeof options.body!=='string'||Buffer.byteLength(options.body)>20000){reject(new Error('transport_scope_rejected'));return;}
  const signal=AbortSignal.any([AbortSignal.timeout(30000),...(options.signal?[options.signal]:[])]);
  if(signal.aborted){reject(new Error('transport_aborted'));return;}
  const req=transport.request(url,{method:'POST',headers:options.headers,signal,agent:false,rejectUnauthorized:true,...(fixtureCa?{ca:fixtureCa}:{}),maxHeaderSize:16384},res=>{
   if(res.statusCode>=300&&res.statusCode<400){res.destroy();reject(new Error('transport_redirect_rejected'));return;}
   // Readable.toWeb provides getReader()/cancel(); no Response or native fetch needed.
   resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,body:Readable.toWeb(res)});
  });
  req.once('error',reject);
  req.setTimeout(30000,()=>req.destroy(new Error('transport_timeout')));
  req.end(options.body);
 });
}
export function groqHttpsFetch(url,options){
 if(typeof url!=='string'||url!==ENDPOINT)return Promise.reject(new Error('transport_endpoint_rejected'));
 return requestOnce(new URL(ENDPOINT),options,https);
}
// Explicit local-only socket fixture seam: cannot address any remote host or HTTPS endpoint.
export function loopbackHttpFixtureFetch(url,options){
 let parsed;try{parsed=new URL(url);}catch{return Promise.reject(new Error('fixture_endpoint_rejected'));}
 if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.username||parsed.password||!parsed.port)return Promise.reject(new Error('fixture_endpoint_rejected'));
 return requestOnce(parsed,options,http);
}

export function loopbackTlsFixtureFetch(url,options,fixtureCa){
 let parsed;try{parsed=new URL(url);}catch{return Promise.reject(new Error('fixture_endpoint_rejected'));}
 if(parsed.protocol!=='https:'||parsed.hostname!=='127.0.0.1'||parsed.username||parsed.password||!parsed.port||typeof fixtureCa!=='string'||!fixtureCa.includes('BEGIN CERTIFICATE'))return Promise.reject(new Error('fixture_endpoint_rejected'));
 return requestOnce(parsed,options,https,fixtureCa);
}
