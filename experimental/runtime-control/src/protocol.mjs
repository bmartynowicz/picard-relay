// Shared wire protocol: explicit application secret, never Sites identity headers.
// Same module runs in the Board Worker and Oracle Node service.
const encoder=new TextEncoder();
export class ProtocolError extends Error{constructor(code){super(code);this.code=code;}}
export async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const canonical=value=>JSON.stringify(normalize(value));
function normalize(value){return Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])])):value;}
export async function payloadHash(payload){const{payloadHash:ignored,...rest}=payload;void ignored;return digest(canonical(rest));}
export async function validateWork(p){
 const text=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n;
 const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
 if(!exact(p,['v','eventId','ownerId','taskId','requestId','grantId','assistantId','grantExpiresAt','payloadHash','request','context'])||p.v!==1||!text(p.ownerId,200)||!text(p.taskId,200)||!text(p.requestId,200)||!text(p.grantId,200)||!text(p.assistantId,200)||!Number.isSafeInteger(p.grantExpiresAt)||!text(p.eventId,64)||!/^[a-f0-9]{64}$/.test(p.eventId)||!exact(p.request,['text','createdAt','answerTo'])||!text(p.request.text,4000)||!Number.isFinite(Date.parse(p.request.createdAt))||!(p.request.answerTo===null||text(p.request.answerTo,200))||!exact(p.context,['title','nextAction','latestFinding'])||!text(p.context.title,200)||typeof p.context.nextAction!=='string'||p.context.nextAction.length>1500||typeof p.context.latestFinding!=='string'||p.context.latestFinding.length>4000||p.payloadHash!==await payloadHash(p))throw new ProtocolError('invalid_work');
 if(typeof p.request.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.request.createdAt)||new Date(p.request.createdAt).toISOString()!==p.request.createdAt||p.eventId!==await digest(canonical([p.ownerId,p.taskId,p.requestId])))throw new ProtocolError('invalid_work');
 return p;
}
async function mac(secret,text){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let d=0;for(let i=0;i<64;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export function validConfig(c){return !!c&&/^[A-Za-z0-9_.:-]{1,100}$/.test(c.keyId)&&typeof c.secret==='string'&&encoder.encode(c.secret).length>=32&&!/PLACEHOLDER|REPLACE_ME|example/i.test(c.secret);}
export async function boundedBody(message,max=24576){const reader=message.body?.getReader();if(!reader)return '';let n=0,chunks=[];try{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.byteLength;if(n>max)throw new ProtocolError('body_too_large');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(n);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
export async function signRequest(url,payload,c,now=Date.now()){
 if(!validConfig(c))throw new ProtocolError('bridge_configuration_unavailable');
 const body=JSON.stringify(payload);if(encoder.encode(body).length>24576)throw new ProtocolError('body_too_large');
 const nonce=crypto.randomUUID(),stamp=String(now),signature=await mac(c.secret,`board-bridge-v1\n${c.keyId}\n${stamp}\n${nonce}\n${await digest(body)}`);
 return {nonce,request:new Request(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-bridge-key':c.keyId,'x-bridge-time':stamp,'x-bridge-nonce':nonce,'x-bridge-signature':signature},body})};
}
export async function verifyRequest(request,c,consumeNonce,now=Date.now()){
 if(!validConfig(c))throw new ProtocolError('bridge_configuration_unavailable');
 if(request.method!=='POST'||request.headers.get('content-type')!=='application/json')throw new ProtocolError('invalid_request');
 const key=request.headers.get('x-bridge-key'),stamp=request.headers.get('x-bridge-time'),nonce=request.headers.get('x-bridge-nonce');
 if(key!==c.keyId||!stamp||!/^\d{13}$/.test(stamp)||Math.abs(now-Number(stamp))>60000||!nonce||!/^[a-f0-9-]{36}$/.test(nonce))throw new ProtocolError('authentication_denied');
 const body=await boundedBody(request),expected=await mac(c.secret,`board-bridge-v1\n${key}\n${stamp}\n${nonce}\n${await digest(body)}`);
 if(!equal(expected,request.headers.get('x-bridge-signature')))throw new ProtocolError('authentication_denied');
 if(!await consumeNonce(nonce,now+120000))throw new ProtocolError('replayed_request');
 let payload;try{payload=JSON.parse(body);}catch{throw new ProtocolError('invalid_json');}
 return {payload,nonce};
}
export async function signedResponse(payload,status,nonce,c){const body=JSON.stringify(payload);return new Response(body,{status,headers:{'content-type':'application/json','cache-control':'no-store','x-bridge-response':await mac(c.secret,`board-bridge-response-v1\n${nonce}\n${status}\n${await digest(body)}`)},});}
export async function verifyResponse(response,nonce,c){const body=await boundedBody(response);if(!equal(response.headers.get('x-bridge-response'),await mac(c.secret,`board-bridge-response-v1\n${nonce}\n${response.status}\n${await digest(body)}`)))throw new ProtocolError('response_authentication_denied');try{return JSON.parse(body);}catch{throw new ProtocolError('invalid_json');}}
