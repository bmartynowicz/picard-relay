import https from 'node:https';
import {validate,validateArtifact} from './updater.mjs';
const LIMIT=3*1024*1024;
export function releaseUrl(source) {
 if(typeof source!=='string') throw new Error('source_rejected');
 const u=new URL(source);
 if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.port||u.username||u.password||u.search||u.hash||!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/main\/releases\/stable.json$/.test(u.pathname)) throw new Error('source_rejected');
 return u;
}
// Native HTTPS works with the relay's SELinux-compatible --jitless Node runtime.
// No credential headers, provider calls, redirects, fallback, or retries.
export function readHttps(url) {
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{agent:false,rejectUnauthorized:true,maxHeaderSize:8192,signal:AbortSignal.timeout(15000)},res=>{
   if(res.statusCode!==200){res.destroy();reject(new Error('release_http_status'));return;}
   let size=0;const parts=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>LIMIT){reject(new Error('release_too_large'));res.destroy();return;}parts.push(chunk);});
   res.once('error',reject);res.once('end',()=>resolve(Buffer.concat(parts)));
  });
  req.once('error',()=>reject(new Error('release_transport_failed')));
 });
}
export function decodeEnvelope(bytes,policy,now) {
 if(!Buffer.isBuffer(bytes)||bytes.length>LIMIT) throw new Error('release_too_large');
 const e=JSON.parse(bytes.toString('utf8'));
 const decode=s=>{if(typeof s!=='string'||!s.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw new Error('invalid_encoding');return Buffer.from(s,'base64');};
 const sigstore=policy.signatureMode==='sigstore';
 if(sigstore&&e.format!==2)throw new Error('sigstore_envelope_required');
 const packet={manifestBytes:decode(e.manifest),signature:decode(sigstore?e.sigstoreBundle:e.signature),bundleBytes:decode(e.bundle)};
 if(sigstore){if(packet.signature.length>65536)throw new Error('sigstore_size_limit');validateArtifact(packet.manifestBytes,packet.bundleBytes,policy,now);}
 else validate(packet.manifestBytes,packet.signature,packet.bundleBytes,policy,now);
 // Sigstore signature verification occurs under the updater lock before any staging.
 return packet;
}
export async function pullSignedRelease(policy) {
 if(policy.enabled!==true) throw new Error('updates_disabled');
 // Source and trusted publisher public key are administrator-controlled, never remote-supplied.
 return decodeEnvelope(await readHttps(releaseUrl(policy.source)),policy,Date.now());
}
