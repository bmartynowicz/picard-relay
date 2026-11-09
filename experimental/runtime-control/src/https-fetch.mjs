// Native TLS transport for --jitless; never uses Undici/WebAssembly or retries.
import https from 'node:https';
import http from 'node:http';
import {Readable} from 'node:stream';
import {TransportObservationError} from './adapters.mjs';
const ENDPOINT='https://api.groq.com/openai/v1/chat/completions';
function requestOnce(url,options,transport,fixtureCa){
 return new Promise((resolve,reject)=>{
  if(options?.method!=='POST'||options.redirect!=='error'||typeof options.body!=='string'||Buffer.byteLength(options.body)>20000){reject(new TransportObservationError('transport_scope_rejected'));return;}
  const signal=AbortSignal.any([AbortSignal.timeout(30000),...(options.signal?[options.signal]:[])]);
  if(signal.aborted){reject(new Error('transport_aborted'));return;}
  const req=transport.request(url,{method:'POST',headers:options.headers,signal,agent:false,rejectUnauthorized:true,...(fixtureCa?{ca:fixtureCa}:{}),maxHeaderSize:16384},res=>{
   if(res.statusCode>=300&&res.statusCode<400){res.destroy();reject(new TransportObservationError('transport_redirect_rejected',res.statusCode));return;}
   // Readable.toWeb provides getReader()/cancel(); no Response or native fetch needed.
   resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,body:Readable.toWeb(res)});
  });
  req.once('error',reject);
  req.setTimeout(30000,()=>req.destroy(new TransportObservationError('transport_timeout')));
  req.end(options.body);
 });
}
export function groqHttpsFetch(url,options){
 if(typeof url!=='string'||url!==ENDPOINT)return Promise.reject(new TransportObservationError('transport_endpoint_rejected'));
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

const recognitionLabels = { kills: 'picard:kill', captures: 'picard:capture' };
const recognitionRepository = 'bmartynowicz/picard-relay';
const recognitionPageSize = 100;
const recognitionMaxBytes = 512 * 1024;

export function recognitionIssuePages(login) {
  if (typeof login !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login)) {
    throw Error('Supply one GitHub username.');
  }
  return Object.entries(recognitionLabels).map(([kind, label]) => {
    const query = new URLSearchParams({
      creator: login, labels: label, state: 'all', per_page: String(recognitionPageSize),
    });
    return { kind, label, path: 'repos/' + recognitionRepository + '/issues?' + query };
  });
}

export function verifyContributorCredits(login, pages) {
  const credits = { kills: [], captures: [] };
  for (const { kind, label } of recognitionIssuePages(login)) {
    const rows = pages[kind];
    if (!Array.isArray(rows) || rows.length >= recognitionPageSize) {
      throw Error('The award list was incomplete. Review it on GitHub.');
    }
    const numbers = new Set();
    for (const row of rows) {
      if (!Number.isSafeInteger(row?.number) || row.number < 1
        || typeof row.login !== 'string' || row.login.toLowerCase() !== login.toLowerCase()
        || !Array.isArray(row.labels) || !row.labels.includes(label)
        || typeof row.pull !== 'boolean') {
        throw Error('GitHub returned a record outside the requested award scope.');
      }
      if (row.labels.includes(recognitionLabels.kills) && row.labels.includes(recognitionLabels.captures)) {
        throw Error('Conflicting recognition labels on #' + row.number + '.');
      }
      if (row.pull && (kind !== 'kills' || typeof row.mergedAt !== 'string'
        || !Number.isFinite(Date.parse(row.mergedAt)))) continue;
      numbers.add(row.number);
    }
    credits[kind] = [...numbers].sort((a, b) => a - b);
  }
  if (credits.captures.some(number => credits.kills.includes(number))) {
    throw Error('An award changed category during the check. Review it on GitHub.');
  }
  return credits;
}

function readRecognitionIssuePage(path, signal) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.github.com/' + path, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'picard-relay-recognition' },
      signal, agent: false, rejectUnauthorized: true, maxHeaderSize: 8192,
    }, async response => {
      try {
        if (response.statusCode !== 200 || /rel="next"/i.test(response.headers.link ?? '')) {
          throw Error('recognition_page_unavailable');
        }
        let bytes = 0;
        const chunks = [];
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > recognitionMaxBytes) throw Error('recognition_page_oversized');
          chunks.push(chunk);
        }
        const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!Array.isArray(rows) || rows.length >= recognitionPageSize) throw Error('recognition_page_incomplete');
        resolve(rows.map(row => ({
          number: row?.number,
          login: row?.user?.login,
          labels: Array.isArray(row?.labels) ? row.labels.map(label => label?.name) : null,
          pull: row != null && Object.hasOwn(row, 'pull_request'),
          mergedAt: row?.pull_request?.merged_at,
        })));
      } catch (error) {
        response.destroy();
        reject(error);
      }
    });
    req.once('error', reject);
  });
}

export async function fetchContributorCredits(login, { signal } = {}) {
  const pages = recognitionIssuePages(login);
  const timeout = AbortSignal.timeout(5000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const results = await Promise.all(pages.map(async ({ kind, path }) =>
    [kind, await readRecognitionIssuePage(path, deadline)]));
  return verifyContributorCredits(login, Object.fromEntries(results));
}
