#!/usr/bin/env node
import {randomUUID} from 'node:crypto';
import {open, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {canonical, digest} from '../experimental/runtime-control/src/protocol.mjs';
import {createOwnerSessionCache,validCachedSession} from './owner-session-cache.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha256 = /^[a-f0-9]{64}$/;
const pending = ['queued', 'claimed', 'invoking'];
const stopped = ['failed', 'blocked', 'cancelled', 'uncertain', 'expired'];
const states = [...pending, ...stopped, 'completed', 'draft'];
const fields = ['taskId', 'title', 'requestText', 'context', 'purpose'];
const cookieName = '__Host-PicardSession';
const maxDraftBytes = 24576;
const maxResponseBytes = 1024 * 1024;
const usage = `Usage:
  node tools/workspace-request.mjs prepare --input brief.json --out request.json
  node tools/workspace-request.mjs submit --origin HTTPS_ORIGIN --file request.json --approve [--wait-ms 30000]
  node tools/workspace-request.mjs result --origin HTTPS_ORIGIN --ref REQUEST_ID_OR_REF [--wait-ms 30000]

  node tools/workspace-request.mjs login --origin HTTPS_ORIGIN
  node tools/workspace-request.mjs login --origin HTTPS_ORIGIN --fresh
  node tools/workspace-request.mjs forget-session --origin HTTPS_ORIGIN

Windows securely remembers the owner session with current-user DPAPI until
the server expires or revokes it (at most 8 hours). The password is never saved.
Live commands reuse a valid saved session before prompting without echo.
Use login --fresh for a new password check before owner-only tool management.
It replaces the active owner session only after successful sign-in.
For workflow accounting, append --comparison ID --usage-settings PRIVATE_SETTINGS.json
to submit/result. This links the saved request, including later Picard fixes,
without another provider invocation. Keep these metadata files private.
To pipe a password from an
approved credential source, use --password-stdin. A login replaces the active
owner session. Keep the original request file to recover the same request.`;

class WorkspaceError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function requireThat(condition, code = 'usage', details) {
  if (!condition) throw new WorkspaceError(code, details);
}

export function checkedDraft(draft) {
  const keys = ['requestId', ...fields].sort();
  requireThat(draft && typeof draft === 'object'
    && Object.keys(draft).sort().join(',') === keys.join(',')
    && keys.every(key => typeof draft[key] === 'string')
    && uuid.test(draft.requestId) && draft.taskId.length <= 200
    && draft.title.trim() && draft.title.length <= 200
    && draft.requestText.trim() && draft.requestText.length <= 4000
    && draft.context.length <= 4000
    && ['public-source-review', 'sanitized-source-proposal'].includes(draft.purpose)
    && Buffer.byteLength(JSON.stringify({
      request: draft.requestText,
      context: {title: draft.title, nextAction: '', latestFinding: draft.context},
    })) <= 12000
    && Buffer.byteLength(JSON.stringify(draft)) <= maxDraftBytes, 'invalid_request_file');
  return draft;
}

async function readJson(path) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    requireThat(info.isFile() && info.size <= maxDraftBytes, 'invalid_request_file');
    const bytes = await file.readFile();
    requireThat(bytes.length <= maxDraftBytes, 'invalid_request_file');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } finally {
    await file.close();
  }
}

function exactHttpsOrigin(value) {
  requireThat(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'tls_verification_required');
  let url;
  try { url = new URL(value); } catch { throw new WorkspaceError('invalid_origin'); }
  requireThat(url.protocol === 'https:' && (value === url.origin || value === url.origin + '/'), 'invalid_origin');
  return url.origin;
}

async function responseJson(response) {
  requireThat(response.body, 'invalid_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireThat(size <= maxResponseBytes, 'invalid_response');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function openWorkspace(origin, password, {fetchImpl = fetch,sessionCookie=null,onSession=null} = {}) {
  origin = exactHttpsOrigin(origin);
  let cookie;
  async function request(path, body, timeout = 10000) {
    const headers = {Accept: 'application/json', Origin: origin};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetchImpl(origin + path, {
        method: body === undefined ? 'GET' : 'POST', headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(timeout),
      });
      const data = await responseJson(response);
      if (!response.ok) {
        const code = typeof data?.error === 'string' && /^[a-z_]{1,64}$/.test(data.error)
          ? data.error : 'request_rejected';
        throw new WorkspaceError(code, {httpStatus: response.status});
      }
      requireThat(data && typeof data === 'object' && !Array.isArray(data), 'invalid_response');
      return {data, headers: response.headers};
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError('response_unconfirmed');
    }
  }
  if(sessionCookie!==null){
    requireThat(/^__Host-PicardSession=[A-Za-z0-9_-]{43}$/.test(sessionCookie),'invalid_cached_session');
    cookie=sessionCookie;await request('/workspace/config');
    return async (...args)=>(await request(...args)).data;
  }
  const login = await request('/auth/login', {password});
  password = undefined;
  const sessions = login.headers.getSetCookie().filter(value => value.startsWith(cookieName + '='));
  const match = /^__Host-PicardSession=[A-Za-z0-9_-]{43};/.exec(sessions[0] ?? '');
  requireThat(login.data.ok === true && sessions.length === 1 && match, 'invalid_login_response');
  cookie = match[0].slice(0, -1);
  if(onSession){
    const seconds=Number(/(?:^|;)\s*Max-Age=(\d+)(?:;|$)/i.exec(sessions[0])?.[1]??28800);
    await onSession({v:1,origin,cookie,expiresAt:Date.now()+Math.min(28800,seconds)*1000});
  }
  return async (...args) => (await request(...args)).data;
}

export async function connectWorkspace(origin,{fetchImpl=fetch,cache=createOwnerSessionCache(),passwordPrompt=()=>ownerPassword(false,origin),onNotice=message=>process.stderr.write(message+'\n'),fresh=false}={}){
  origin=exactHttpsOrigin(origin);
  requireThat(typeof fresh==='boolean','usage');
  const saved=fresh?null:await cache.read(origin);
  if(validCachedSession(saved,origin)){
    try{
      const request=await openWorkspace(origin,undefined,{fetchImpl,sessionCookie:saved.cookie});
      onNotice('Using the saved Picard CLI session.');return request;
    }catch(error){
      if(error.details?.httpStatus!==401)throw error;
      await cache.clear(origin);
    }
  }else if(saved)await cache.clear(origin);
  return openWorkspace(origin,await passwordPrompt(),{fetchImpl,onSession:async value=>{
    try{if(await cache.write(value))onNotice('Picard CLI session remembered securely; password not saved.');}
    catch{onNotice('Signed in, but secure session storage was unavailable; no session was saved.');}
  }});
}

function draftRef(response, requestId) {
  const ref = response.draft?.payload?.eventId;
  requireThat(response.draft?.payload?.requestId === requestId && sha256.test(ref ?? ''), 'invalid_draft_response', {requestId});
  return ref;
}

export async function verifyDraft(response, brief, ref) {
  const {draftSha256, ...draft} = response.draft;
  const {payload, approval} = draft;
  const expectedContext = {title: brief.title, nextAction: '', latestFinding: brief.context};
  requireThat(draft.source === 'authenticated-owner-console' && payload.eventId === ref
    && payload.assistantId === 'groq:openai/gpt-oss-20b'
    && payload.taskId === (brief.taskId || 'console:' + brief.requestId)
    && payload.request?.text === brief.requestText && payload.request.answerTo === null
    && canonical(payload.context) === canonical(expectedContext)
    && approval?.purpose === brief.purpose && approval.maxCompletionTokens === 4096
    && sha256.test(draftSha256 ?? '') && await digest(canonical(draft)) === draftSha256,
  'draft_does_not_match', {requestId: brief.requestId, ref});
  return draftSha256;
}

async function readResult(request, ref, timeout) {
  const result = await request('/workspace/requests/' + ref, undefined, timeout);
  const identity = result.ref ?? result.draft?.payload?.eventId;
  requireThat(identity === ref && states.includes(result.state), 'invalid_result_response', {ref});
  return {...result, ref};
}

async function waitForResult(request, initial, waitMs) {
  let result = initial;
  const end = performance.now() + waitMs;
  while (pending.includes(result.state)) {
    const pause = Math.min(1000, Math.floor(end - performance.now()) - 1);
    if (pause < 1) break;
    await delay(pause);
    const remaining = Math.floor(end - performance.now());
    if (remaining < 1) break;
    try { result = await readResult(request, result.ref, Math.min(remaining, 10000)); }
    catch (error) {
      if (error.code !== 'response_unconfirmed') throw error;
      return {...result, readback: 'unconfirmed'};
    }
  }
  return result;
}

export async function submitWorkspace(request, brief, waitMs = 0) {
  checkedDraft(brief);
  const {requestId} = brief;
  let saved;
  try { saved = await request('/workspace/drafts', brief); }
  catch (error) {
    if (!['response_unconfirmed', 'invalid_response'].includes(error.code)) throw error;
    try { saved = await request('/workspace/drafts/' + requestId); }
    catch { throw new WorkspaceError('draft_unconfirmed', {requestId}); }
  }
  const ref = draftRef(saved, requestId);
  const draftSha256 = await verifyDraft(saved, brief, ref);
  if (saved.registered) return waitForResult(request, await readResult(request, ref), waitMs);

  const proof = await request('/workspace/approvals', {requestId});
  requireThat(proof.ref === ref, 'invalid_approval_response', {requestId, ref});
  if (proof.existing === true) return waitForResult(request, await readResult(request, ref), waitMs);
  requireThat(proof.draftSha256 === draftSha256 && /^[A-Za-z0-9_-]{16,128}$/.test(proof.nonce ?? ''),
    'invalid_approval_response', {requestId, ref});
  let receipt;
  try {
    receipt = await request('/workspace/requests', {requestId, nonce: proof.nonce, draftSha256, approve: true});
    requireThat(receipt.ref === ref && states.includes(receipt.state), 'invalid_response');
  } catch (error) {
    // The commit may have succeeded even when its response is unavailable.
    // Recover the original job with a GET and never repeat the submission here.
    if (!['response_unconfirmed', 'invalid_response'].includes(error.code)
        && !(error.details?.httpStatus >= 500)) throw error;
    try { receipt = await readResult(request, ref); } catch { /* Report the known identity below. */ }
    requireThat(receipt && !['draft', 'expired'].includes(receipt.state), 'submission_unconfirmed', {requestId, ref});
  }
  if (receipt.state === 'completed' && !receipt.result) receipt = await readResult(request, ref);
  return waitForResult(request, {...receipt, requestId, ref}, waitMs);
}

export async function workspaceResult(request, ref, waitMs = 0) {
  if (uuid.test(ref)) ref = draftRef(await request('/workspace/drafts/' + ref), ref);
  requireThat(sha256.test(ref), 'invalid_request_reference');
  return waitForResult(request, await readResult(request, ref), waitMs);
}

async function ownerPassword(fromStdin, origin) {
  process.stderr.write('Signing in to ' + origin + ' replaces its active owner session.\n');
  if (fromStdin) {
    requireThat(!process.stdin.isTTY, 'password_stdin_requires_pipe');
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      requireThat(size <= 1024, 'invalid_password_input');
      chunks.push(chunk);
    }
    return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)).replace(/\r?\n$/, '');
  }
  requireThat(process.stdin.isTTY, 'password_requires_terminal_or_stdin');
  const silent = new Writable({write(_data, _encoding, done) { done(); }});
  const terminal = createInterface({input: process.stdin, output: silent, terminal: true, historySize: 0});
  const cancellation = new AbortController();
  terminal.once('close', () => cancellation.abort());
  terminal.once('SIGINT', () => terminal.close());
  process.stderr.write('Picard owner password: ');
  try { return await terminal.question('', {signal: cancellation.signal}); }
  finally {
    terminal.close();
    process.stderr.write('\n');
  }
}

async function main(args = process.argv.slice(2)) {
  if (!args.length || ['--help', 'help'].includes(args[0])) {
    console.log(usage);
    return;
  }
  const [command, ...flags] = args;
  const live = {origin: {type: 'string'}, 'wait-ms': {type: 'string'}, 'password-stdin': {type: 'boolean'},comparison:{type:'string'},'usage-settings':{type:'string'}};
  const options = {
    prepare: {input: {type: 'string'}, out: {type: 'string'}},
    submit: {...live, file: {type: 'string'}, approve: {type: 'boolean'}},
    result: {...live, ref: {type: 'string'}},
    login: {...live, fresh:{type:'boolean'}},
    'forget-session': {origin:{type:'string'}},
  };
  requireThat(Object.hasOwn(options, command));
  const {values, tokens} = parseArgs({args: flags, options: options[command], tokens: true});
  requireThat(new Set(tokens.map(token => token.name)).size === tokens.length);
  if (command === 'prepare') {
    requireThat(values.input && values.out);
    const brief = await readJson(values.input);
    requireThat(brief && !Object.hasOwn(brief, 'requestId'), 'invalid_request_file');
    const draft = checkedDraft({requestId: randomUUID(), ...brief});
    await writeFile(values.out, JSON.stringify(draft, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({state: 'prepared_locally', requestId: draft.requestId}));
    return;
  }
  if(command==='forget-session'){
    const origin=exactHttpsOrigin(values.origin);await createOwnerSessionCache().clear(origin);
    console.log(JSON.stringify({state:'forgotten_locally',origin}));return;
  }
  if(command==='login'){
    const origin=exactHttpsOrigin(values.origin);
    await connectWorkspace(origin,{fresh:values.fresh===true,passwordPrompt:()=>ownerPassword(values['password-stdin'],origin)});
    console.log(JSON.stringify({state:'signed_in',origin}));return;
  }
  requireThat(values.origin && (command === 'submit'
    ? values.file && values.approve === true
    : uuid.test(values.ref ?? '') || sha256.test(values.ref ?? '')));
  const origin = exactHttpsOrigin(values.origin);
  requireThat(values['wait-ms'] === undefined || /^\d{1,5}$/.test(values['wait-ms']));
  const waitMs = Number(values['wait-ms'] ?? 0);
  requireThat(waitMs <= 60000);
  const draft = command === 'submit' ? checkedDraft(await readJson(values.file)) : null;
  requireThat((values.comparison===undefined)===(values['usage-settings']===undefined)
    &&(values.comparison===undefined||/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(values.comparison)));
  const usageSettings=values['usage-settings']?JSON.parse(readFileSync(values['usage-settings'],'utf8').replace(/^\uFEFF/,'')):null;
  let knownRef=null;
  function recordCall(ref){
    if(!usageSettings||!sha256.test(ref??''))return;
    const saved=spawnSync(process.execPath,[fileURLToPath(new URL('./codex-usage-notify.mjs',import.meta.url)),
      '--endpoint',usageSettings.endpoint,'--token-file',usageSettings.tokenFile,'--picard-call',
      JSON.stringify({v:1,kind:'picard-call',comparisonId:values.comparison,ref})],{timeout:15000,windowsHide:true,stdio:'pipe'});
    if(saved.status!==0){process.stderr.write('Saved Picard request; workflow usage delivery is pending. Do not repeat the request.\n');process.exitCode=1;}
  }
  const request = await connectWorkspace(origin,{passwordPrompt:()=>ownerPassword(values['password-stdin'],origin)});
  try {
    const result = draft ? await submitWorkspace(request, draft, waitMs) : await workspaceResult(request, values.ref, waitMs);
    knownRef=result.ref;recordCall(knownRef);
    console.log(JSON.stringify({...result, consoleUrl: origin + '/#requests/' + result.ref}));
    if (stopped.includes(result.state)) process.exitCode = 2;
  } catch (error) {
    recordCall(knownRef??error.details?.ref);
    if (error instanceof WorkspaceError && draft) error.details = {requestId: draft.requestId, ...error.details};
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = error instanceof WorkspaceError ? error.code
      : error.code?.startsWith('ERR_PARSE_ARGS') ? 'usage'
      : error.code === 'EEXIST' ? 'request_file_already_exists' : 'workspace_client_failed';
    if (code === 'usage') process.stderr.write(usage + '\n');
    console.error(JSON.stringify({error: code, ...(error instanceof WorkspaceError ? error.details : {})}));
    process.exitCode = 1;
  });
}
