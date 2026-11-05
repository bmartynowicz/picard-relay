// Compose the owner workspace only when server-side admission is enabled.
// No external library, resource, credential, HTML interpolation of private data.
export function admissionConsoleHtml(base,{activationEnabled=false,workspaceEnabled=false}={}){
 if(activationEnabled!==true)return base;
 if(workspaceEnabled===true)return workspaceConsoleHtml(base);
 const replace=(old,value)=>{if(base.split(old).length!==2)throw Error('admission_document_invalid');base=base.replace(old,value);};
 replace('<button id="nav-groq"','<button id="nav-requests" type="button" aria-controls="view-requests"><span class="nav-index" aria-hidden="true">03</span>Requests</button><button id="nav-groq"');
 replace('03</span>Groq','04</span>Groq');replace('04</span>System','05</span>System');
 replace('const views=[\'overview\',\'jobs\',\'groq\',\'system\'];',"const views=['overview','jobs','requests','groq','system'];");
 replace("if(focus)$('heading-'+view).focus?.();","if(focus)$('heading-'+view).focus?.();if(view==='requests'&&authenticated)void loadAdmissionCatalogue();");
 replace('<p id="detail-reason"></p>','<p id="detail-reason"></p><button id="job-open-result" type="button" hidden>Open saved result</button>');
 replace("function inspectJob(row){","function inspectJob(row){\n $('job-open-result').hidden=!(row?.state==='completed'&&row.resultAvailable);");
 replace('function clearPrivate(){','function clearPrivate(){\n clearAdmission();');
 replace('This console cannot submit or approve a request.','Use Requests to approve one exact enrolled input.');
 replace('</style>',String.raw`
.admission-workspace{display:grid;grid-template-columns:minmax(190px,1fr) minmax(0,2fr);gap:32px;align-items:start}.admission-choice{padding:18px 0;border-bottom:1px solid var(--line,#35413f)}.admission-review{border-left:1px solid var(--line,#35413f);padding-left:28px;min-width:0}.admission-review pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,monospace;max-height:420px;overflow:auto}.admission-review label{display:block;margin:18px 0 8px}.admission-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:24px 0}.admission-result{margin-top:32px;border-top:1px solid var(--line,#35413f);padding-top:24px}.admission-result pre{max-height:600px}.admission-workspace select{width:100%;max-width:100%;min-height:44px}.admission-approve{min-height:44px}.admission-review p{overflow-wrap:anywhere}@media(max-width:720px){.admission-workspace{grid-template-columns:1fr;gap:20px}.admission-review{border-left:0;padding-left:0}.admission-review pre{max-height:none;overflow:visible}.admission-result pre{max-height:none}}
.admission-prompt{margin:20px 0}.admission-prompt summary,.admission-result summary{cursor:pointer;padding:10px 0;color:var(--accent)}.admission-result pre{font-size:13px}.result-text{margin:20px 0;overflow-wrap:anywhere}.result-text p,.result-text pre,.result-text h3{margin:14px 0}.result-text pre{background:var(--side);padding:16px;white-space:pre-wrap}.result-table{overflow-x:auto;max-width:100%;margin:18px 0}.result-table table{border-collapse:collapse;min-width:100%;font-size:14px}.result-table th,.result-table td{border:1px solid var(--line);padding:10px;text-align:left;vertical-align:top}.result-table th{background:var(--side)}
.result-review{border-left:2px solid var(--accent);padding:14px 16px;background:#dec38707;margin:18px 0;font-size:14px;overflow-wrap:anywhere}.result-review h3{font-size:16px}.result-review p{margin-top:10px}.result-review a{color:var(--accent);text-decoration:underline}
</style>`);
 replace('<section id="view-groq"',String.raw`<section id="view-requests" aria-labelledby="heading-requests" hidden>
<div class="view-head"><div><h1 id="heading-requests" tabindex="-1">Requests</h1><p>Review approved console requests and their saved results.</p></div><button id="admission-refresh" type="button">Refresh requests</button></div>
<p id="admission-capability" class="blocking" role="status">Availability not checked.</p>
<p id="admission-notice" role="status" aria-live="polite">Not checked</p>
<div class="admission-workspace"><div class="admission-choice"><label for="admission-entry">Approved inputs</label><select id="admission-entry"><option value="">Choose an input</option></select><p class="muted">Groq only. Free-only enrollment, $0 budget, 512 output tokens, one call. No tools, retries or paid fallback.</p></div>
<div class="admission-review"><h2 id="admission-title">Choose an input to review</h2><p id="admission-identity" class="full-ref muted"></p><details class="admission-prompt" open><summary>Exact input</summary><pre id="admission-input"></pre></details><p id="admission-context" class="muted"></p><label for="admission-slot">Request slot</label><select id="admission-slot"><option value="">Choose a slot</option></select>
<div class="admission-actions"><button id="admission-approve" class="admission-approve" type="button" disabled>Approve and queue</button><button id="admission-check" type="button" disabled>Check saved result</button></div><p id="admission-state" role="status" aria-live="polite">No request selected.</p>
<div id="admission-result" class="admission-result" hidden><h2>Saved result</h2><aside id="admission-review-note" class="result-review" aria-labelledby="admission-review-heading" hidden><h3 id="admission-review-heading">Reviewed correction</h3><p class="muted">Axiom review · November 3, 2026</p><p>The original 5-of-10 example does not cover the exact boundary. Use ("Name", 10, 10) → "0 characters remaining." for that case.</p><p><a href="https://github.com/bmartynowicz/picard-relay/blob/fb0d442c1713a4aa2f287eb46dd9b1a1882ad167/examples/form-limit-regression-cases.json" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Reviewed regression cases</a></p><p>The original response below is preserved. These are reviewed examples; the broader Board form feature remains open.</p></aside><div id="admission-formatted" class="result-text"></div><details><summary>Original saved text</summary><pre id="admission-output"></pre></details><p class="muted">Text proposal only. Nothing here has been executed.</p></div></div></div></section>
<section id="view-groq"`);
 replace('motion();void boot();',ADMISSION_SCRIPT+'\nmotion();void boot();');
 return base;
}

// Bind the review to one immutable proposal, never to a task title or future call.

export function workspaceConsoleHtml(base){
 const replace=(from,to)=>{if(base.split(from).length!==2)throw Error('workspace_document_invalid');base=base.replace(from,to);};
 replace('<button id="nav-groq"','<button id="nav-requests" type="button" aria-controls="view-requests"><span class="nav-index" aria-hidden="true">03</span>Requests</button><button id="nav-groq"');
 replace('03</span>Groq','04</span>Groq');replace('04</span>System','05</span>System');
 replace("const views=['overview','jobs','groq','system'];","const views=['overview','jobs','requests','groq','system'];");
 replace("if(focus)$('heading-'+view).focus?.();","if(focus)$('heading-'+view).focus?.();if(view==='requests'&&authenticated)void loadWorkspace();else stopWorkspacePoll();updateNextActions();");
 replace('function clearPrivate(){','function clearPrivate(){\n clearWorkspace();');
 replace('function motion(){',"function motion(){ $('request-sheet').dataset.motion=paused||preference.matches?'off':'on';");
 replace('This console cannot submit or approve a request.','Create a request, review its limits, and approve one call.');
 replace('<p id="detail-reason"></p>','<p id="detail-reason"></p><button id="workspace-open-job" type="button" hidden>Open request</button>');
 replace('function inspectJob(row){',"function inspectJob(row){\n $('workspace-open-job').hidden=!row;");
 replace("request('/jobs'+","request('/workspace/history'+");
 replace('return {ref:row.ref,state:row.state,createdAt:time(row.createdAt)',"return {title:typeof row.title==='string'&&row.title.length<=200?row.title:'Untitled request',ref:row.ref,state:row.state,createdAt:time(row.createdAt)");
 replace("identity.textContent=row.ref.slice(0,12);","identity.textContent=row.title||row.ref.slice(0,12);");
 replace("ref.textContent=row.ref.slice(0,12);","ref.textContent=row.title||row.ref.slice(0,12);");
 replace('<section id="view-groq"',WORKSPACE_MARKUP+'\n<section id="view-groq"');
 replace('<button id="jobs-refresh"','<div class="view-actions"><button id="next-jobs" class="request-primary" type="button" hidden>New request</button><button id="jobs-refresh"');
 replace('Refresh jobs</button></div>','Refresh jobs</button></div></div>');
 for(const view of ['groq','system'])replace('<h1 id="heading-'+view+'" tabindex="-1">'+(view==='groq'?'Groq':'System')+'</h1></div></div>','<h1 id="heading-'+view+'" tabindex="-1">'+(view==='groq'?'Groq':'System')+'</h1></div><button id="next-'+view+'" class="request-primary" type="button" hidden>New request</button></div>');
 replace('<div class="signal">',TRAINING_MARKUP+'\n<div class="signal">');
 replace(' showGroq(data);'," showGroq(data);if(!workConfigAttempted)void workLoadConfig().catch(()=>{});else renderTraining();");
 replace('</style>',WORKSPACE_STYLE+'\n</style>');
 replace('motion();void boot();',WORKSPACE_SCRIPT()+'\nmotion();void boot();');
 return base;
}

const TRAINING_MARKUP=String.raw`<section class="training" aria-labelledby="training-heading"><div class="training-heading"><h2 id="training-heading">Your progress</h2><strong id="training-title">Checking progress</strong></div><p id="training-next" class="muted">Your existing work counts.</p><progress id="training-progress" max="3" value="0" aria-label="Training progress not checked" hidden></progress><ol class="training-steps" aria-label="Training milestones"><li id="training-setup">Setup</li><li id="training-result">First result</li><li id="training-review">Review</li></ol><button id="training-action" type="button" disabled>Check progress</button></section>`;

const WORKSPACE_STYLE=String.raw`
.view-actions{display:flex;gap:8px;flex-wrap:wrap}.view-actions button{font-size:13px}.training{padding:0 0 24px;margin:0 0 4px}.training-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px}.training-heading h2{font-size:16px;font-weight:550}.training-heading strong{color:var(--accent);font-size:14px}.training>p{margin-top:8px;max-width:65ch}.training progress{display:block;appearance:none;width:100%;height:3px;border:0;background:var(--line);accent-color:var(--accent);margin:16px 0}.training progress::-webkit-progress-bar{background:var(--line)}.training progress::-webkit-progress-value{background:var(--accent)}.training progress::-moz-progress-bar{background:var(--accent)}.training-steps{display:flex;gap:24px;flex-wrap:wrap;list-style:none;padding:0;margin:14px 0;color:var(--muted);font-size:12px}.training-steps li:before{content:"◇";margin-right:6px}.training-steps [data-earned="true"]{color:var(--accent)}.training-steps [data-earned="true"]:before{content:"◆"}.training #training-action{font-size:13px}.advanced-locked{font-size:12px;color:var(--muted);margin-top:18px}.request-tools,.request-actions,.result-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.request-tools{margin-bottom:24px}.request-tools .muted{margin-left:auto}.request-actions{margin-top:24px}.request-primary{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:600}.request-primary:hover:not(:disabled){background:#e8d2a6;color:var(--bg)}.request-grid{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:36px;align-items:start}.request-form{max-width:760px}.request-form label,.request-review-form label{display:block;margin:20px 0 7px;font-size:14px;font-weight:550}.request-form input,.request-form textarea,.request-form select,.request-review-form textarea{width:100%;max-width:100%;border:1px solid var(--line);border-radius:4px;background:var(--side);color:var(--text);padding:10px 12px;font:inherit;min-height:44px}.request-form textarea,.request-review-form textarea{resize:vertical;line-height:1.65}.request-form textarea:focus,.request-review-form textarea:focus{outline:2px solid var(--accent);outline-offset:3px}.request-form .field-note{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:12px;color:var(--muted)}.request-form details{margin-top:18px}.request-form summary{cursor:pointer;color:var(--muted);padding:8px 0}.request-aside{border-left:1px solid var(--line);padding-left:24px;font-size:13px;line-height:1.65}.request-aside h2{font-size:15px}.request-aside p{margin-top:12px;color:var(--muted)}.request-aside summary{cursor:pointer;color:var(--accent);padding:10px 0}.request-aside li{margin:8px 0}.request-aside strong{color:var(--text);font-weight:500}.request-status{min-height:24px;color:var(--muted);margin:12px 0 24px;font-size:13px;overflow-wrap:anywhere}.request-status[data-tone="warn"]{color:var(--warn)}.request-sheet{max-width:1040px;min-width:0;animation:request-reveal 160ms ease-out}.request-sheet h2{font-size:25px;overflow-wrap:anywhere}.request-steps{display:flex;list-style:none;padding:0;margin:0 0 28px;border-bottom:1px solid var(--line);gap:28px;color:var(--muted);font-size:13px}.request-steps li{padding:0 0 12px}.request-steps li[aria-current="step"]{color:var(--accent);border-bottom:2px solid var(--accent)}.request-state-line{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:16px}.request-state-label{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--accent)}.request-observed{font-size:12px;color:var(--muted)}.request-exact{margin:24px 0}.request-exact h3{margin-bottom:8px;color:var(--muted)}.request-exact pre,.request-original{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,Consolas,monospace;margin:0}.request-limit-list{display:flex;gap:12px 28px;flex-wrap:wrap;margin:24px 0;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px}.request-limit-list dt{color:var(--muted);margin-bottom:3px}.request-limit-list dd{margin:0}.request-caution{font-size:13px;color:var(--muted);max-width:76ch;line-height:1.7}.request-result{margin:32px 0}.request-output{font-size:15px;line-height:1.75;overflow-wrap:anywhere}.request-output p,.request-output h3{margin:14px 0}.request-output ul,.request-output ol{padding-left:24px}.request-output .code-output{margin:20px 0;background:var(--side)}.code-output header{padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted)}.code-output button{padding:5px 10px;font-size:12px}.code-output pre{margin:0;padding:18px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,Consolas,monospace}.request-table{max-width:100%;overflow:auto}.request-table table{border-collapse:collapse;width:100%;font-size:13px}.request-table td,.request-table th{border-bottom:1px solid var(--line);padding:10px;text-align:left;vertical-align:top}.request-provenance{margin:24px 0;font-size:12px;color:var(--muted);overflow-wrap:anywhere}.request-provenance summary,.request-result details summary{padding:10px 0;cursor:pointer;color:var(--muted)}.request-provenance dl{display:grid;grid-template-columns:140px minmax(0,1fr);gap:8px 16px}.request-provenance dd{margin:0;font-family:ui-monospace,Consolas,monospace}.request-review-form{border-top:1px solid var(--line);padding-top:24px;margin-top:32px}.request-review-form h3{font-size:18px}.request-review-form p{font-size:13px;color:var(--muted);margin:8px 0}.request-review-form textarea{max-width:760px}.request-review-history{font-size:13px;margin:20px 0;padding-left:20px;overflow-wrap:anywhere}.request-review-history li{margin:10px 0;white-space:pre-wrap}.request-review-summary{color:var(--accent)!important}.request-correction{border-left:2px solid var(--accent);padding:14px 18px;margin:20px 0;font-size:13px}.request-correction p{margin:8px 0}.commissioning{display:flex;align-items:center;gap:12px;margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.commission-seal{font-size:26px;color:var(--muted);width:34px;flex:none;text-align:center}.commissioning strong{font-size:14px}.commissioning p{margin-top:3px;font-size:12px}.commissioning[data-earned="true"] .commission-seal,.commissioning[data-earned="true"] strong{color:var(--accent)}.request-setup{border-top:1px solid var(--line);margin-top:28px;padding-top:20px}.request-setup ul{padding-left:18px}.request-setup a{color:var(--accent)}.request-empty-illustration{width:100%;height:auto;max-width:230px;margin:14px 0;color:var(--accent)}.request-sheet[data-motion="off"]{animation:none}@keyframes request-reveal{from{opacity:.6;transform:translateY(5px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.request-sheet{animation:none}}@media(max-width:1000px){.request-grid{grid-template-columns:minmax(0,1fr);gap:28px}.request-aside{border-left:0;border-top:1px solid var(--line);padding:24px 0 0;max-width:760px}.request-empty-illustration{display:none}}@media(max-width:520px){.request-steps{gap:15px;font-size:12px}.request-limit-list{gap:14px 20px}.request-tools .muted{margin-left:0;width:100%}.request-state-line{align-items:flex-start;flex-direction:column}.request-provenance dl{grid-template-columns:1fr;gap:3px}.request-provenance dd{margin-bottom:10px}.request-actions button{min-height:44px}.request-form .field-note{font-size:11px}}
`;

const WORKSPACE_MARKUP=String.raw`<section id="view-requests" aria-labelledby="heading-requests" hidden>
<div class="view-head"><div><h1 id="heading-requests" tabindex="-1">Requests</h1></div></div>
<div class="request-tools"><button id="request-new" type="button">New request</button><button id="request-refresh" type="button">Refresh</button><span id="request-provider" class="muted">Checking provider…</span></div>
<p id="request-notice" class="request-status" role="status" aria-live="polite"></p>
<div id="request-compose" class="request-grid">
<form id="request-form" class="request-form">
<label for="request-template">Start with</label><select id="request-template"><option value="custom">A blank request</option><option id="request-template-code" value="code" disabled>A code proposal · Lieutenant</option><option id="request-template-review" value="review" disabled>A review · Lieutenant</option><option value="explain">An explanation</option></select>
<label for="request-title">Task title</label><input id="request-title" maxlength="200" required autocomplete="off" placeholder="What are you working on?"><div class="field-note"><span></span><span id="request-title-count">0 / 200</span></div>
<label for="request-text">What should Picard do?</label><textarea id="request-text" rows="7" maxlength="4000" required placeholder="Describe the result you need and what a good answer should include."></textarea><div class="field-note"><span></span><span id="request-text-count">0 / 4,000</span></div>
<div id="request-advanced" hidden><details id="request-context-details"><summary>Add context or a task reference</summary><label for="request-context">Supporting context</label><textarea id="request-context" rows="4" maxlength="4000" placeholder="Constraints, relevant text, or a short source excerpt."></textarea><div class="field-note"><span>Only include information you intend to send to Groq.</span><span id="request-context-count">0 / 4,000</span></div><label for="request-task">Task reference (optional)</label><input id="request-task" maxlength="200" autocomplete="off" placeholder="An existing task-board task ID"><p class="field-note">Links this request to the task ID. Review decisions stay in Picard.</p><label for="request-purpose">Type of work</label><select id="request-purpose"><option value="sanitized-source-proposal">Draft or propose</option><option value="public-source-review">Review public material</option></select></details></div><p id="advanced-locked" class="advanced-locked">Review a saved answer to unlock context and task links.</p>
<div class="request-actions"><button id="request-prepare" class="request-primary" type="submit">Review request</button></div><p class="request-caution">Reviewing does not call Groq. Approve the exact input next.</p>
</form>
<aside class="request-aside"><h2>One call. Saved result.</h2><svg class="request-empty-illustration" viewBox="0 0 230 100" role="img" aria-label="An approved request travels to the provider, then becomes a saved result"><path d="M25 50H205" stroke="currentColor" opacity=".35" fill="none"/><g fill="var(--side)" stroke="currentColor"><rect x="6" y="29" width="42" height="42" rx="4"/><circle cx="115" cy="50" r="23"/><rect x="184" y="29" width="40" height="42" rx="4"/></g><g fill="none" stroke="currentColor" stroke-width="2"><path d="m18 49 6 6 12-13M106 43h18m-18 7h13m-13 7h18m72-15h16m-16 8h16m-16 8h10"/></g></svg><details class="request-limit-info"><summary>Limits</summary><p>Groq · openai/gpt-oss-20b<br>One call · up to 4,096 output tokens<br>No tools or automatic retries</p><p>Free-plan enrollment; live billing and quota are unknown.</p></details><div id="commissioning" class="commissioning" data-earned="false"><span class="commission-seal" aria-hidden="true">✦</span><div><strong id="commission-title">Cadet</strong><p id="commission-note">Finish setup to earn Ensign.</p></div></div><details class="request-setup"><summary>Setup status</summary><ul id="request-setup-list"></ul><a href="https://github.com/bmartynowicz/picard-relay/blob/main/docs/V1.md" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Workflow guide ↗</a></details></aside>
</div>
<article id="request-sheet" class="request-sheet" hidden aria-labelledby="request-sheet-title">
<ol class="request-steps" aria-label="Request progress"><li id="request-step-review">01 · Review</li><li id="request-step-run">02 · Run</li><li id="request-step-result">03 · Result</li></ol>
<div class="request-state-line"><span id="request-state" class="request-state-label"></span><span id="request-observed" class="request-observed"></span></div><h2 id="request-sheet-title" tabindex="-1"></h2><p id="request-next" class="request-status"></p>
<div id="request-exact" class="request-exact"><h3>Exact input</h3><pre id="request-exact-text"></pre><div id="request-exact-context-wrap" hidden><h3>Supporting context</h3><pre id="request-exact-context"></pre></div></div>
<dl id="request-limits" class="request-limit-list"></dl><p id="request-cost" class="request-caution"></p>
<div class="request-actions"><button id="request-approve" class="request-primary" type="button" hidden>Approve one call</button><button id="request-edit" type="button" hidden>Edit brief</button><button id="request-check" type="button">Check saved status</button></div>
<section id="request-result" class="request-result" hidden aria-label="Saved result"><div class="result-tools"><button id="request-copy" type="button">Copy answer</button><button id="request-download" type="button">Download answer</button><button id="request-handoff" type="button">Download handoff</button></div><aside id="request-correction" class="request-correction" hidden><strong>Reviewed correction · November 3, 2026</strong><p>The original 5-of-10 example misses the exact boundary. Use ("Name", 10, 10) → "0 characters remaining." for that case.</p><p>The original answer is preserved below.</p></aside><div id="request-output" class="request-output"></div><details><summary>Original saved text</summary><pre id="request-original" class="request-original" tabindex="0"></pre></details>
<div class="request-review-form"><h3>Your review</h3><p id="request-review-summary" class="request-review-summary">Not reviewed.</p><p>Your review will not run another call.</p><label for="request-review-note">Review note (optional)</label><textarea id="request-review-note" rows="3" maxlength="2000"></textarea><div class="request-actions"><button id="request-accept" type="button">Accept result</button><button id="request-changes" type="button">Request changes</button></div><details id="request-review-details" hidden><summary>Review history</summary><ol id="request-review-history" class="request-review-history"></ol></details></div></section>
<details class="request-provenance"><summary>Request details and provenance</summary><dl id="request-provenance"></dl></details>
</article>
</section>`;

const WORKSPACE_SCRIPT=()=>String.raw`
const workspaceCorrection=${JSON.stringify(REVIEWED_REGRESSION_RESULT)};
let workConfigAttempted=false,workConfigFlight=null,workGraduated=false,workProgress=null;
let workConfig=null,workDraft=null,workResult=null,workRef=null,workBusy=false,workGeneration=0,workTimer=null,workRead=null,workFresh=false,workDraftId=null,workSubmissionUnknown=false;
const workControllers=new Set(),workDownloads=new Set();
const workFields=['request-title','request-text','request-context','request-task'];
function stopWorkspacePoll(){clearTimeout(workTimer);workTimer=null;}
function workNotice(text,warn=false){$('request-notice').textContent=text;$('request-notice').dataset.tone=warn?'warn':'';}
// Ranks teach the interface; they never grant provider or execution authority.
function rememberProgress(c){
 const age=Date.now()-Date.parse(c?.observedAt),t=c?.training,s=c?.setup;
 if(!c||!Number.isFinite(age)||age< -5000||age>=60000||t?.v!==1||typeof t.hasSavedResult!=='boolean'||typeof t.hasReviewedResult!=='boolean'||t.hasReviewedResult&&!t.hasSavedResult||!s||['ownerAuthentication','durableStorage','providerEnrollment'].some(k=>typeof s[k]!=='boolean'))return;
 const p=c.progress,acceptedWork=p?.v===1&&Number.isSafeInteger(p.acceptedWork)&&p.acceptedWork>=0&&p.acceptedWork<=100&&typeof p.atLeast==='boolean'&&p.atLeast===(p.acceptedWork===100)?p.acceptedWork:null;
 workProgress={reviewed:workProgress?.reviewed===true||t.hasReviewedResult,saved:workProgress?.saved===true||t.hasSavedResult,setup:workProgress?.setup===true||s.ownerAuthentication&&s.durableStorage&&s.providerEnrollment||t.hasSavedResult,acceptedWork};
}
function trainingState(){
 if(!workProgress)return null;
 const current=workFresh&&workResult?.resultAvailable===true,reviewed=workProgress.reviewed||workGraduated||current&&workResult.review.revision>0,saved=workProgress.saved||reviewed||current,setup=workProgress.setup||saved;
 const n=workProgress.acceptedWork,rank=reviewed?(n>=100?'Admiral':n>=25?'Captain':n>=5?'Commander':'Lieutenant'):setup?'Ensign':'Cadet';
 return {rank,acceptedWork:n,setup,saved,reviewed,step:reviewed?3:saved?2:setup?1:0};
}
function workAdvanced(){return trainingState()?.reviewed===true;}
function clearTraining(){
 for(const view of ['jobs','groq','system']){$('next-'+view).hidden=true;$('next-'+view).disabled=true;}
 $('training-rank').textContent='';$('training-rank').hidden=true;delete $('logo-wrap').dataset.rank;
 $('training-title').textContent='Progress not checked';$('training-next').textContent='Refresh to check your progress.';$('training-progress').hidden=true;$('training-progress').value=0;$('training-progress').setAttribute('aria-label','Training progress not checked');$('training-action').disabled=true;
 for(const id of ['training-setup','training-result','training-review']){$(id).dataset.earned='false';$(id).setAttribute('aria-label','Milestone not checked');}
 $('commissioning').dataset.earned='false';$('commission-title').textContent='Cadet';$('commission-note').textContent='Check setup to earn your first rank.';$('request-advanced').hidden=true;$('advanced-locked').hidden=false;
}
function renderTraining(){
 const t=trainingState();if(!t){clearTraining();return;}
 const copy=t.reviewed?['Lieutenant earned','Advanced tools unlocked: code templates, context, task links and code/handoff exports.','Use advanced tools']:t.saved?['Ensign','Review a saved answer to earn Lieutenant and unlock advanced tools.','Review your first result']:t.setup?['Welcome aboard, Ensign','Setup complete. Complete and review your first request to unlock advanced tools.','Start your first request']:['Cadet','Finish setup to earn Ensign and unlock your first request.','Check setup'];
 if(t.reviewed){const n=t.acceptedWork,next=n<5?['Commander',5]:n<25?['Captain',25]:['Admiral',100];copy[0]=t.rank+(t.rank==='Lieutenant'?' earned':'');copy[1]=n===null?'Work milestones unavailable.':n>=100?'100+ accepted results. Admiral earned.':n+' accepted '+(n===1?'result':'results')+' · '+(next[1]-n)+' to '+next[0]+'.';}
 $('training-rank').textContent=t.rank;$('training-rank').hidden=false;$('logo-wrap').dataset.rank=t.rank.toLowerCase();$('training-title').textContent=copy[0];$('training-next').textContent=copy[1];$('training-action').textContent=nextActionState()?.label??copy[2];$('training-action').disabled=workBusy;
 $('training-progress').hidden=false;$('training-progress').value=t.step;$('training-progress').setAttribute('aria-label',t.rank+' · '+t.step+' of 3 training steps complete');
 for(const [id,label,earned]of [['training-setup','Setup',t.setup],['training-result','First result',t.saved],['training-review','Review',t.reviewed]]){$(id).dataset.earned=String(earned);$(id).setAttribute('aria-label',label+' · '+(earned?'complete':'next'));}
 $('commissioning').dataset.earned=String(t.setup);$('commission-title').textContent=t.rank;$('commission-note').textContent=t.reviewed?'Advanced tools unlocked.':t.setup?'First rank earned. Welcome aboard.':'Finish setup to earn Ensign.';$('request-advanced').hidden=!t.reviewed;$('advanced-locked').hidden=t.reviewed;updateNextActions();
}
function nextActionState(){
 const t=trainingState();
 if(workDraft)return {kind:'current',label:'Review draft'};
 if(workRef&&(!workResult?.resultAvailable||!workResult.review.latest))return {kind:'current',label:workResult?.resultAvailable?'Review result':'View request'};
 if(!workRef&&workFields.some(id=>$(id).value.trim()))return {kind:'continue',label:'Continue request'};
 if(!t)return null;
 return {kind:!t.setup?'setup':t.saved&&!t.reviewed?'review':'new',label:!t.setup?'Finish setup':t.saved&&!t.reviewed?'Review result':t.reviewed?'New request':'Create request'};
}
function updateNextActions(){const action=nextActionState();for(const view of ['jobs','groq','system']){const button=$('next-'+view);button.hidden=!action;button.disabled=workBusy||!action;if(action)button.textContent=action.label;}const hud=$('hud-next');hud.hidden=!action;hud.disabled=workBusy||!action;if(action)hud.textContent=action.label;}
function trainingAction(){
 if(workBusy)return;const action=nextActionState();if(!action)return;
 if(action.kind==='current'){workNavigate(workRef);showView('requests');return;}
 if(action.kind==='continue'){preferredRoute={view:'requests',ref:null};showView('requests');$('request-title').focus?.();return;}
 if(action.kind==='review'){const ref=workProgress?.reviewRef??jobRows.find(row=>row.state==='completed'&&row.resultAvailable)?.ref;if(ref){workNavigate(ref);showView('requests');}else{$('jobs-filter').value='completed';showView('jobs');paintJobs();}return;}
 showView('requests');if(action.kind==='setup'){$('request-setup-list').closest?.('details')?.setAttribute('open','');return;}newWorkspaceRequest();if(workAdvanced())$('request-context-details').open=true;
}
function clearWorkspace(){
 clearTraining();workConfigAttempted=false;workConfigFlight=null;workGraduated=false;workProgress=null;
 workGeneration++;stopWorkspacePoll();for(const c of workControllers)c.abort();workControllers.clear();workRead=null;for(const url of workDownloads)URL.revokeObjectURL(url);workDownloads.clear();workConfig=null;workDraft=null;workResult=null;workRef=null;workDraftId=null;workBusy=false;workFresh=false;workSubmissionUnknown=false;
 for(const id of [...workFields,'request-review-note'])$(id).value='';
 for(const id of ['request-exact-text','request-exact-context','request-original','request-sheet-title','request-next','request-state','request-observed','request-review-summary'])$(id).textContent='';
 for(const id of ['request-output','request-provenance','request-review-history','request-limits','request-setup-list'])$(id).replaceChildren();
 $('request-sheet').hidden=true;$('request-compose').hidden=false;$('request-result').hidden=true;$('request-correction').hidden=true;$('request-review-details').hidden=true;$('request-provider').textContent='Provider not checked.';workNotice('');workCounts();workButtons();
}
async function workRequest(path,body,controller=new AbortController()){
 const generation=workGeneration;workControllers.add(controller);const timer=setTimeout(()=>controller.abort(),8000);
 try{const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  if(response.status===401||response.status===403){showAuth('login','Please sign in to view your requests.');throw Error('auth');}
  const value=await response.json();if(controller.signal.aborted||generation!==workGeneration||!authenticated)throw Error('aborted');if(!response.ok){const e=Error('workspace');e.status=response.status;e.code=value?.error;throw e;}return value;
 }finally{clearTimeout(timer);workControllers.delete(controller);}
}
function workCounts(){for(const [id,max]of [['request-title',200],['request-text',4000],['request-context',4000]])$(id+'-count').textContent=$(id).value.length.toLocaleString()+' / '+max.toLocaleString();}
function workButtons(){
 const configCurrent=workConfig&&Date.now()-Date.parse(workConfig.observedAt)<60000&&Date.now()-Date.parse(workConfig.observedAt)>=-5000;
 if(workConfig&&!configCurrent)$('request-provider').textContent='Availability needs a fresh check. Select Refresh.';
 for(const id of ['request-prepare','request-edit','request-new','request-refresh','request-check','request-accept','request-changes'])$(id).disabled=workBusy;
 $('request-approve').disabled=workBusy||!workFresh||!configCurrent||workConfig?.ready!==true||!workDraft||workSubmissionUnknown||workDraft.approval.expiresAt<=Date.now();
 for(const id of ['request-accept','request-changes'])$(id).disabled=workBusy||!workFresh||!workResult?.resultAvailable;
 for(const id of ['request-copy','request-download','request-handoff'])$(id).disabled=!workResult?.resultAvailable;
 $('request-check').disabled=workBusy||!workRef;
 for(const id of [...workFields,'request-template','request-purpose','request-review-note'])$(id).disabled=workBusy;
 const t=trainingState(),advanced=t?.reviewed===true;$('request-prepare').disabled=workBusy||!t?.setup;$('training-action').disabled=workBusy||!t;
 for(const id of ['request-context','request-task','request-purpose','request-template-code','request-template-review'])$(id).disabled=workBusy||!advanced;
 for(const id of ['request-template-code','request-template-review','request-context-details','request-handoff'])$(id).hidden=!advanced;
 $('request-handoff').disabled=workBusy||!workResult?.resultAvailable||!advanced;updateNextActions();
}
function workPair(root,label,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);root.append(dt,dd);}
function workLoadConfig(){
 if(workConfigFlight)return workConfigFlight;workConfigAttempted=true;const generation=workGeneration;
 workConfigFlight=fetchWorkConfig().finally(()=>{if(generation===workGeneration)workConfigFlight=null;});return workConfigFlight;
}
async function fetchWorkConfig(){
 const generation=workGeneration;
 try{const c=await workRequest('/workspace/config');if(c?.v!==1||c.enabled!==true||typeof c.ready!=='boolean'||c.model!=='openai/gpt-oss-20b'||c.limits?.maxCalls!==1||c.limits.maxOutputTokens!==4096||!Number.isFinite(Date.parse(c.observedAt)))throw Error('config');workConfig=c;rememberProgress(c);renderTraining();
  $('request-provider').textContent='Groq · '+c.model+' · '+(c.ready?'Ready':availabilityReasons[c.blockingCode]||'Unavailable for new work');
  const root=$('request-setup-list');root.replaceChildren();for(const [label,ok]of [['Owner sign-in',c.setup?.ownerAuthentication],['Durable job storage',c.setup?.durableStorage],['Provider enrollment',c.setup?.providerEnrollment]]){const li=document.createElement('li');li.textContent=label+': '+(ok===true?'ready':'needs attention');root.append(li);}const li=document.createElement('li');li.textContent='Backups: managed by your host operator';root.append(li);
 }catch(e){if(generation!==workGeneration)throw e;workConfig=null;renderTraining();$('request-provider').textContent='Current provider availability unknown.';throw e;}finally{if(generation===workGeneration)workButtons();}
}
function workNavigate(ref,replace=false){workRef=ref;preferredRoute={view:'requests',ref};writeRoute(replace);}
function newWorkspaceRequest(){
 if(workBusy)return;stopWorkspacePoll();workRead?.abort();workRead=null;workDraft=null;workResult=null;workRef=null;workDraftId=null;workFresh=false;workSubmissionUnknown=false;
 for(const id of [...workFields,'request-review-note'])$(id).value='';$('request-template').value='custom';$('request-purpose').value='sanitized-source-proposal';$('request-context-details').open=false;
 $('request-sheet').hidden=true;$('request-compose').hidden=false;$('request-result').hidden=true;$('request-output').replaceChildren();$('request-original').textContent='';workNavigate(null);workNotice('');workCounts();workButtons();$('request-title').focus?.();
}
function workSchedule(){stopWorkspacePoll();if(!authenticated||activeView!=='requests'||document.visibilityState==='hidden')return;const active=['queued','claimed','invoking'].includes(workResult?.state);workTimer=setTimeout(async()=>{workButtons();if(!workBusy&&(!workConfig||Date.now()-Date.parse(workConfig.observedAt)>=15000)){try{await workLoadConfig();}catch{}}if(active&&!workBusy)await readWorkspaceRequest();else if(workDraft)renderWorkspaceDraft(workDraft);workSchedule();},active?2000:15000);}
function workSteps(step){for(const name of ['review','run','result'])$('request-step-'+name).setAttribute('aria-current',name===step?'step':'false');$('request-sheet').dataset.motion=paused||preference.matches?'off':'on';}
function workShowSheet(){ $('request-compose').hidden=true;$('request-sheet').hidden=false; }
function renderWorkspaceDraft(d){
 $('request-cost').hidden=false;
 const expired=d.approval.expiresAt<=Date.now();workShowSheet();workSteps('review');$('request-sheet-title').textContent=d.payload.context.title;$('request-state').textContent=expired?'Draft expired':'Ready for your approval';$('request-next').textContent=expired?'Edit the brief to prepare a new request. This draft cannot run.':'Check the exact text and limits. Approval queues this request once.';
 $('request-exact-text').textContent=d.payload.request.text;$('request-exact-context').textContent=d.payload.context.latestFinding;$('request-exact-context-wrap').hidden=!d.payload.context.latestFinding;$('request-result').hidden=true;$('request-approve').hidden=expired;$('request-edit').hidden=false;
 $('request-observed').textContent='Approval expires '+formatTime(d.approval.expiresAt);const root=$('request-limits');root.replaceChildren();for(const [k,v]of [['Provider','Groq · openai/gpt-oss-20b'],['Calls','1'],['Output ceiling','4,096 tokens'],['Execution','Text proposal only']])workPair(root,k,v);
 $('request-cost').textContent='Retained Free-plan enrollment. Live billing and remaining quota are unknown. No tools, automatic retries, model substitution or paid fallback.';
 const meta=$('request-provenance');meta.replaceChildren();for(const [k,v]of [['Request',d.payload.eventId],['Task reference',d.payload.taskId],['Input SHA-256',d.approval.inputSha256],['Draft SHA-256',d.draftSha256],['Created',formatTime(d.approval.issuedAt)]])workPair(meta,k,v);workButtons();
}
function projectWorkspace(value,ref){
 if(value?.v!==1||value.ref!==ref||!['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'].includes(value.state)||typeof value.resultAvailable!=='boolean'||typeof value.request?.title!=='string'||typeof value.request?.text!=='string'||typeof value.request?.context!=='string'||!Number.isFinite(Date.parse(value.observedAt))||typeof value.provenance?.model!=='string'||!Number.isSafeInteger(value.review?.revision)||!Array.isArray(value.review.history)||value.review.history.length>100)throw Error('result');
 if(value.resultAvailable&&(value.state!=='completed'||typeof value.result?.body!=='string'||value.result.body.length>16000||!/^[a-f0-9]{64}$/.test(value.result.sha256??'')))throw Error('result');return value;
}
const workNextActions={queued:'Queued. You can leave this page and return to the same request.',claimed:'The relay has claimed this request. Following its recorded progress.',invoking:'The provider call is in progress. Checking status will not send another call.',completed:'Ready for your review.',uncertain:'The provider outcome is uncertain. This request is spent and will not be retried. Preserve this record for operator review.',failed:'This request failed and is spent. Inspect the recorded reason before deciding on any new work.',blocked:'This request is blocked. Check the recorded reason and provider availability.',cancelled:'This request was cancelled. No replacement request has been created.'};
function renderWorkspaceResult(v){
 $('request-cost').hidden=true;
 if(workProgress&&workFresh&&v.resultAvailable){workProgress.saved=true;workProgress.setup=true;workProgress.reviewed=workProgress.reviewed||v.review.revision>0;if(!workProgress.reviewed)workProgress.reviewRef=v.ref;}
 renderTraining();
 workShowSheet();workSteps(v.state==='completed'?'result':'run');$('request-state').textContent=v.state==='completed'?'Completed · '+(v.review.latest?.decision==='accepted'?'accepted':v.review.latest?.decision==='changes_requested'?'changes requested':'awaiting your review'):v.state==='uncertain'?'Needs operator review':v.state;
 $('request-sheet-title').textContent=v.request.title;$('request-next').textContent=workNextActions[v.state]+(v.state==='failed'||v.state==='blocked'?' '+(reasons[v.reasonCode]||'Recorded reason unavailable.'):'');$('request-observed').textContent='Observed '+formatTime(Date.parse(v.observedAt));$('request-exact-text').textContent=v.request.text;$('request-exact-context').textContent=v.request.context;$('request-exact-context-wrap').hidden=!v.request.context;$('request-approve').hidden=true;$('request-edit').hidden=true;
 $('request-limits').replaceChildren();for(const [k,val]of [['Provider',v.provenance.model],['Calls','1'],['Output ceiling',v.provenance.maxOutputTokens+' tokens'],['Source',v.provenance.source]])workPair($('request-limits'),k,val);
 $('request-cost').textContent='Usage tokens and billed cost were not recorded. The configured ceiling is not measured usage. No automatic retry or paid fallback.';
 const meta=$('request-provenance');meta.replaceChildren();for(const [k,val]of [['Request',v.ref],['Task reference',v.request.taskId],['Input SHA-256',v.provenance.inputSha256],['Payload SHA-256',v.provenance.payloadSha256],['Approved',formatTime(v.provenance.approvedAt)],['Expiry',formatTime(v.provenance.expiresAt)],['Result SHA-256',v.result?.sha256??'No saved result'],['Usage and cost','Not measured. Configured limits are not measured usage. No automatic retry or paid fallback.']])workPair(meta,k,val);
 $('request-result').hidden=!v.resultAvailable;
 if(v.resultAvailable){$('request-original').textContent=v.result.body;renderWorkspaceText(v.result.body);$('request-correction').hidden=!(v.ref===workspaceCorrection.ref&&v.provenance.inputSha256===workspaceCorrection.inputSha256&&v.result.body===workspaceCorrection.body);renderWorkspaceReview(v.review);}else{$('request-output').replaceChildren();$('request-original').textContent='';$('request-correction').hidden=true;}
 workButtons();
}
function renderWorkspaceReview(review){
 $('request-review-summary').textContent=review.latest?(review.latest.decision==='accepted'?'Accepted':'Changes requested')+' · '+formatTime(review.latest.recordedAt):'Not reviewed.';
 $('request-review-details').hidden=review.history.length===0;const root=$('request-review-history');root.replaceChildren();for(const r of [...review.history].reverse()){const li=document.createElement('li');li.textContent=(r.decision==='accepted'?'Accepted':'Changes requested')+' · '+formatTime(r.recordedAt)+(r.note?'\n'+r.note:'');root.append(li);}
}
async function loadWorkspace(){
 if(!authenticated||workBusy)return;const generation=workGeneration;
 try{await workLoadConfig();if(generation!==workGeneration)return;const ref=preferredRoute.view==='requests'?preferredRoute.ref:null;if(ref){if(workRef!==ref){workRead?.abort();workRead=null;workDraft=null;workResult=null;workFresh=false;workRef=ref;}await readWorkspaceRequest();}else if(!workDraft&&!workResult){$('request-compose').hidden=false;$('request-sheet').hidden=true;workNotice('');}}
 catch{if(generation===workGeneration&&authenticated)workNotice('Availability could not be checked. Saved results can still be read with Check saved status.',true);if(workRef)await readWorkspaceRequest();}finally{workSchedule();}
}
async function prepareWorkspace(event){
 event.preventDefault();if(workBusy)return;const training=trainingState();if(!training?.setup){workNotice('Complete setup before preparing your first request.',true);return;}if(!workAdvanced()&&($('request-context').value||$('request-task').value||$('request-purpose').value==='public-source-review')){workNotice('Review a saved answer to unlock context and task links.',true);return;}if(!$('request-title').value.trim()||!$('request-text').value.trim()){workNotice('Enter a title and a request.',true);return;}
 workBusy=true;workButtons();const generation=workGeneration;workDraftId=workDraftId??crypto.randomUUID();
 const body={requestId:workDraftId,taskId:$('request-task').value,title:$('request-title').value,requestText:$('request-text').value,context:$('request-context').value,purpose:$('request-purpose').value};
 try{const value=await workRequest('/workspace/drafts',body);if(generation!==workGeneration)return;workDraft=value.draft;workResult=null;workFresh=true;workSubmissionUnknown=false;workNavigate(workDraft.payload.eventId);renderWorkspaceDraft(workDraft);workNotice('Draft saved. No provider call has been made.');$('request-sheet-title').focus?.();await workLoadConfig();}
 catch(e){if(generation===workGeneration&&authenticated)workNotice(e.code==='request_too_large'?'The combined input is too large. Shorten the request or context.':e.code==='draft_conflict'?'This draft ID already belongs to different input. Edit the brief and prepare a new draft.':'Draft saving was not confirmed. Review request again to recover the same draft; no provider call was made.',true);}
 finally{if(generation===workGeneration){workBusy=false;workButtons();workSchedule();}}
}
async function readWorkspaceRequest(){
 if(!authenticated||!workRef||workRead)return;const ref=workRef,generation=workGeneration,controller=new AbortController();workRead=controller;
 try{const v=await workRequest('/workspace/requests/'+ref,undefined,controller);if(generation!==workGeneration||ref!==workRef)return;const age=Date.now()-Date.parse(v.observedAt);workFresh=Number.isFinite(age)&&age>=-5000&&age<60000;workSubmissionUnknown=false;
  if(v.draft){if(v.draft.payload?.eventId!==ref)throw Error('draft');workDraft=v.draft;workResult=null;renderWorkspaceDraft(workDraft);}else{const next=projectWorkspace(v,ref);if(workResult?.ref===ref&&workResult.result?.sha256===next.result?.sha256&&workResult.review.revision>next.review.revision)next.review=workResult.review;workResult=next;workDraft=null;renderWorkspaceResult(workResult);}workNotice(workFresh?'Saved status checked. No request was resubmitted.':'The observation time is stale or ahead of this browser. Refresh and check the host clock before approving or reviewing.',!workFresh);
 }catch(e){if(generation===workGeneration&&ref===workRef&&authenticated){workFresh=false;workNotice(e.status===404?'No request is available at this link for this owner.':'Current request status is unknown. The last observation is preserved. Checking status never resubmits work.',true);}}
 finally{if(workRead===controller)workRead=null;workButtons();workSchedule();}
}
async function approveWorkspace(){
 if($('request-approve').disabled||!workDraft)return;const draft=workDraft,generation=workGeneration;workBusy=true;workButtons();
 try{await workLoadConfig();if(!workConfig?.ready)throw Error('unavailable');const proof=await workRequest('/workspace/approvals',{requestId:draft.payload.requestId});
  if(!proof.existing){if(proof.ref!==draft.payload.eventId||proof.draftSha256!==draft.draftSha256||!/^[A-Za-z0-9_-]{43}$/.test(proof.nonce??''))throw Error('approval');await workRequest('/workspace/requests',{requestId:draft.payload.requestId,nonce:proof.nonce,draftSha256:draft.draftSha256,approve:true});}
  if(generation===workGeneration){await readWorkspaceRequest();workNotice('Registered once. Following the saved request.');}
 }catch{if(generation===workGeneration&&authenticated){workSubmissionUnknown=true;workFresh=false;workNotice('Submission was not confirmed. Check saved status to recover this exact request. No retry or replacement was sent.',true);}}
 finally{if(generation===workGeneration){workBusy=false;workButtons();workSchedule();}}
}
function editWorkspace(){
 if(workBusy||!workDraft)return;stopWorkspacePoll();const d=workDraft;$('request-title').value=d.payload.context.title;$('request-text').value=d.payload.request.text;$('request-context').value=d.payload.context.latestFinding;$('request-task').value=d.payload.taskId.startsWith('console:')?'':d.payload.taskId;$('request-purpose').value=d.approval.purpose;workDraft=null;workResult=null;workDraftId=null;workFresh=false;workNavigate(null);$('request-sheet').hidden=true;$('request-compose').hidden=false;workNotice('Edit the brief, then prepare a new draft for review. The earlier draft remains unchanged.');workCounts();workButtons();$('request-text').focus?.();
}
function workDownload(name,text,type='text/plain;charset=utf-8'){
 const url=URL.createObjectURL(new Blob([text],{type}));workDownloads.add(url);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);workDownloads.delete(url);},1000);
}
function workInline(root,text){for(const part of text.split(/(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*)/g)){const code=part.startsWith('\x60')&&part.endsWith('\x60'),bold=part.startsWith('**')&&part.endsWith('**'),n=document.createElement(code?'code':bold?'strong':'span');n.textContent=code?part.slice(1,-1):bold?part.slice(2,-2):part;root.append(n);}}
function renderWorkspaceText(text){
 const root=$('request-output');root.replaceChildren();const lines=text.split(/\r?\n/);let i=0,block=0;const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
 while(i<lines.length){const line=lines[i++];if(!line.trim())continue;const fence=/^\s*\x60{3}([a-zA-Z0-9_-]*)/.exec(line);
  if(fence){const chunk=[];while(i<lines.length&&!/^\s*\x60{3}/.test(lines[i]))chunk.push(lines[i++]);if(i<lines.length)i++;const body=chunk.join('\n'),wrap=document.createElement('div'),header=document.createElement('header'),label=document.createElement('span'),button=document.createElement('button'),pre=document.createElement('pre'),code=document.createElement('code'),index=++block;wrap.className='code-output';label.textContent=fence[1]||'Code proposal';button.type='button';button.textContent='Download code';button.setAttribute('aria-label','Download code block '+index);const ext=({javascript:'js',js:'js',typescript:'ts',ts:'ts',python:'py',py:'py',json:'json',css:'css',html:'html',sql:'sql',bash:'sh',sh:'sh'})[fence[1].toLowerCase()]||'txt';button.hidden=!workAdvanced();button.disabled=!workAdvanced();button.addEventListener('click',()=>{if(workAdvanced())workDownload('picard-'+workRef.slice(0,12)+'-'+index+'.'+ext,body);});header.append(label,button);code.textContent=body;pre.append(code);wrap.append(header,pre);root.append(wrap);continue;}
  if(line.includes('|')&&i<lines.length&&cells(lines[i]).every(c=>/^:?-{3,}:?$/.test(c))){const wrap=document.createElement('div'),table=document.createElement('table');wrap.className='request-table';const row=(values,head)=>{const tr=document.createElement('tr');for(const value of values){const cell=document.createElement(head?'th':'td');if(head)cell.setAttribute('scope','col');workInline(cell,value);tr.append(cell);}table.append(tr);};row(cells(line),true);i++;while(i<lines.length&&lines[i].includes('|'))row(cells(lines[i++]),false);wrap.append(table);root.append(wrap);continue;}
  const heading=/^#{1,6}\s+(.+)$/.exec(line),bullet=/^\s*[-*]\s+(.+)$/.exec(line),n=document.createElement(heading?'h3':bullet?'p':'p');workInline(n,heading?heading[1]:bullet?'• '+bullet[1]:line);root.append(n);
 }
}
async function saveWorkspaceReview(decision){
 if(workBusy||!workFresh||!workResult?.resultAvailable)return;const result=workResult,generation=workGeneration,note=$('request-review-note').value;workBusy=true;workButtons();
 try{const v=await workRequest('/workspace/reviews/'+result.ref,{expectedRevision:result.review.revision,decision,note,resultSha256:result.result.sha256});if(generation!==workGeneration||workRef!==result.ref||workResult?.result?.sha256!==result.result.sha256)return;if(v.review.revision>=workResult.review.revision)workResult={...workResult,review:v.review};workGraduated=true;renderTraining();$('request-review-note').value='';renderWorkspaceResult(workResult);workNotice('Review saved. The original answer is unchanged.');}
 catch(e){if(generation===workGeneration&&authenticated)workNotice(e.code==='review_conflict'?'Another review was saved. Check saved status before reviewing again.':'Review saving was not confirmed. Check saved status to recover it; no provider call was made.',true);}
 finally{if(generation===workGeneration){workBusy=false;workButtons();}}
}
$('training-action').addEventListener('click',trainingAction);for(const view of ['jobs','groq','system'])$('next-'+view).addEventListener('click',trainingAction);
$('request-form').addEventListener('submit',prepareWorkspace);$('request-new').addEventListener('click',newWorkspaceRequest);$('request-edit').addEventListener('click',editWorkspace);$('request-approve').addEventListener('click',approveWorkspace);$('request-check').addEventListener('click',readWorkspaceRequest);$('request-refresh').addEventListener('click',loadWorkspace);
for(const id of workFields)$(id).addEventListener('input',()=>{workDraftId=null;workCounts();});
$('request-template').addEventListener('change',()=>{if(['code','review'].includes($('request-template').value)&&!workAdvanced()){$('request-template').value='custom';return;}const templates={code:'Propose a small implementation for the following requirement. Include the code, assumptions, and focused verification steps.\n\nRequirement:\n',review:'Review the following public material. Identify specific problems, explain their impact, and suggest corrections.\n\nMaterial:\n',explain:'Explain the following topic in plain language. Include one concrete example and the main limitations.\n\nTopic:\n'};const text=templates[$('request-template').value];if(text)$('request-text').value=text;$('request-purpose').value=$('request-template').value==='review'?'public-source-review':'sanitized-source-proposal';workDraftId=null;workCounts();});
$('workspace-open-job').addEventListener('click',()=>{if(selectedRef){workRef=selectedRef;preferredRoute={view:'requests',ref:selectedRef};writeRoute();showView('requests');}});
$('request-copy').addEventListener('click',async()=>{if(!workResult?.resultAvailable)return;try{await navigator.clipboard.writeText(workResult.result.body);workNotice('Answer copied.');}catch{workNotice('Copy is unavailable in this browser. Use Download answer or select Original saved text.',true);}});
$('request-download').addEventListener('click',()=>{if(workResult?.resultAvailable)workDownload('picard-'+workRef.slice(0,12)+'.md',workResult.result.body);});
$('request-handoff').addEventListener('click',()=>{if(workResult?.resultAvailable&&workAdvanced())workDownload('picard-'+workRef.slice(0,12)+'.json',JSON.stringify({schemaVersion:1,product:'Picard Relay',exportedAt:new Date().toISOString(),...workResult,limitations:['Generated proposal; not executed','Usage and billed cost unknown','Review is local to Picard; no Board acceptance implied']},null,2),'application/json;charset=utf-8');});
$('request-accept').addEventListener('click',()=>saveWorkspaceReview('accepted'));$('request-changes').addEventListener('click',()=>saveWorkspaceReview('changes_requested'));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stopWorkspacePoll();else if(authenticated&&activeView==='requests')void loadWorkspace();});
`;

export const REVIEWED_REGRESSION_RESULT=Object.freeze({"body":"[Groq / openai/gpt-oss-20b]\n**Regression‑test table**\n\n| Input (label, used, limit) | Expected output |\n|---|---|\n| (\"Name\", 5, 10) | \"5 characters remaining.\" |\n| (\"Title\", 11, 10) | \"Title: 1 characters over the limit.\" |\n| (\"\", 0, 10) | \"Check this field.\" |\n| (\"Description\", \"five\", 10) | \"Check this field.\" |\n\nAll outputs follow the specification: blank label, invalid number, boundary, and one over.","entryId":"board-form-limits","inputSha256":"4c6707ce9ec428b6ab064c3508493eb7648c3a89ab92ea15e20236bfd3313da5","ref":"4ad59fcf6c082664d8c175aafd974af48be313aa8d5e9aa6e8d0a85d1ae5d5f8"});

export const ADMISSION_SCRIPT=String.raw`
const reviewedRegressionResult=${JSON.stringify(REVIEWED_REGRESSION_RESULT)};
let admissionData=null,admissionEntry=null,admissionSlot=null,admissionBusy=false,admissionGeneration=0,admissionPoll=null,admissionPollUntil=0,admissionRead=null,admissionReadVersion=0;
const admissionControllers=new Set();
const admissionStates=['available','queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain','unknown'];
function clearAdmission(){
 admissionGeneration++;cancelAdmissionRead();admissionPollUntil=0;for(const c of admissionControllers)c.abort();admissionControllers.clear();admissionData=null;admissionEntry=null;admissionSlot=null;admissionBusy=false;
 for(const id of ['admission-input','admission-context','admission-output','admission-state','admission-identity','admission-capability'])$(id).textContent='';$('admission-formatted').replaceChildren();$('admission-title').textContent='Choose an input to review';$('admission-notice').textContent='Not checked';$('admission-result').hidden=true;$('admission-review-note').hidden=true;
 for(const id of ['admission-entry','admission-slot']){$(id).replaceChildren();$(id).value='';}for(const id of ['admission-approve','admission-check'])$(id).disabled=true;
}
function admissionMessage(text){if(authenticated)$('admission-notice').textContent=text;}
function admissionCanonical(value){return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])));}
async function admissionRequest(path,body,{controller=new AbortController()}={}){
 const generation=admissionGeneration;admissionControllers.add(controller);const timer=setTimeout(()=>controller.abort(),8000);
 try{const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:admissionCanonical(body)})});
  if(response.status===401||response.status===403){showAuth('login','Please sign in to view private requests.');throw Error('auth');}
  const value=await response.json();if(controller.signal.aborted||generation!==admissionGeneration||!authenticated)throw Error('aborted');if(!response.ok){const e=Error('request');e.status=response.status;throw e;}return value;
 }finally{clearTimeout(timer);admissionControllers.delete(controller);}
}
function admissionProject(data){
 if(!data||data.v!==1||!['enabled','synthetic-integration-only'].includes(data.mode)||typeof data.admissionReady!=='boolean'||!Array.isArray(data.entries)||data.entries.length>8||!/^[a-f0-9]{64}$/.test(data.catalogueSha256??''))throw Error('catalogue');
 const entries=[],ids=new Set(),refs=new Set();let total=0;
 for(const e of data.entries){if(!/^[a-z0-9-]{1,50}$/.test(e?.entryId??'')||ids.has(e.entryId)||typeof e.requestText!=='string'||!e.requestText||e.requestText.length>4000||!/^[a-f0-9]{64}$/.test(e.inputSha256??'')||!e.taskContext||['title','nextAction','latestFinding'].some(k=>typeof e.taskContext[k]!=='string')||!Array.isArray(e.slots))throw Error('catalogue');ids.add(e.entryId);
  const slots=[];for(const s of e.slots){if(++total>8||!/^[a-z0-9-]{1,50}$/.test(s?.slotId??'')||!/^[a-f0-9]{64}$/.test(s.ref??'')||refs.has(s.ref)||!admissionStates.includes(s.state))throw Error('catalogue');refs.add(s.ref);slots.push({slotId:s.slotId,ref:s.ref,state:s.state});}
  entries.push({entryId:e.entryId,requestText:e.requestText,inputSha256:e.inputSha256,taskContext:{title:e.taskContext.title,nextAction:e.taskContext.nextAction,latestFinding:e.taskContext.latestFinding},slots});
 }
 return {entries,admissionReady:data.admissionReady,mode:data.mode,blockingCode:Object.hasOwn(availabilityReasons,data.blockingCode)?data.blockingCode:'unknown',legacyReviewRequired:data.blockingCode==='legacy_review_required'};
}
function admissionCapability(){if(!authenticated)return;const d=admissionData,available=d?.entries.some(e=>e.slots.some(s=>s.state==='available'&&s.statusKnown!==false));$('admission-capability').hidden=!!d&&d.admissionReady&&!available;$('admission-capability').textContent=!d?'Availability not checked.':d.admissionReady?(available?'New requests available. Approval queues one call.':'Saved requests'):(availabilityReasons[d.blockingCode]||availabilityReasons.unknown);}
function admissionSelection(){if(!authenticated||!admissionSlot)return;preferredRoute={view:'requests',ref:admissionSlot.ref};writeRoute(true);}
function admissionOption(value,text){const node=document.createElement('option');node.value=value;node.textContent=text;return node;}
function admissionButtons(){const available=authenticated&&!admissionBusy&&!admissionRead&&admissionData?.admissionReady===true&&admissionSlot?.state==='available'&&admissionSlot.statusKnown!==false;$('admission-approve').disabled=!available;$('admission-check').disabled=!authenticated||admissionBusy||!!admissionRead||!admissionSlot;for(const id of ['admission-entry','admission-slot','admission-refresh'])$(id).disabled=admissionBusy;}
function cancelAdmissionRead(){admissionReadVersion++;if(admissionRead)admissionRead.controller.abort();admissionRead=null;clearTimeout(admissionPoll);admissionPoll=null;}
function selectAdmissionSlot(){
 cancelAdmissionRead();admissionSlot=admissionEntry?.slots.find(s=>s.slotId===$('admission-slot').value)??null;$('admission-result').hidden=true;$('admission-review-note').hidden=true;$('admission-output').textContent='';$('admission-formatted').replaceChildren();admissionSelection();$('admission-state').textContent=admissionSlot?(admissionSlot.statusKnown===false?'Current status unknown. Last observed: '+admissionSlot.state+'.':'State: '+admissionSlot.state):'No request selected.';admissionButtons();
}
function selectAdmissionEntry(){
 admissionEntry=admissionData?.entries.find(e=>e.entryId===$('admission-entry').value)??null;$('admission-title').textContent=admissionEntry?admissionLabel(admissionEntry):'Choose an input to review';$('admission-input').textContent=admissionEntry?.requestText??'';$('admission-identity').textContent=admissionEntry?'Input: '+admissionEntry.entryId+' · SHA-256 '+admissionEntry.inputSha256:'';$('admission-context').textContent=admissionEntry?[admissionEntry.taskContext.nextAction,admissionEntry.taskContext.latestFinding].filter(Boolean).join('\n'):'';
 $('admission-slot').replaceChildren(...(admissionEntry?.slots??[]).map(s=>admissionOption(s.slotId,s.slotId+' — '+s.state)));$('admission-slot').value=(admissionEntry?.slots.find(s=>s.ref===preferredRoute.ref)??admissionEntry?.slots[0])?.slotId??'';selectAdmissionSlot();
}
function admissionLabel(entry){const labels={'manual-form-limits':'Manual · validation function','board-form-limits':'Task board · regression cases'},label=Object.hasOwn(labels,entry.entryId)?labels[entry.entryId]:entry.entryId.replace(/-/g,' ');return label+' — '+entry.taskContext.title;}
async function openAdmissionResult(ref){preferredRoute={view:'requests',ref};writeRoute();showView('requests');}
$('job-open-result').addEventListener('click',()=>{const row=jobRows.find(r=>r.ref===selectedRef);if(row?.state==='completed'&&row.resultAvailable)void openAdmissionResult(row.ref);});
async function loadAdmissionCatalogue(){
 if(!authenticated||admissionBusy)return;cancelAdmissionRead();admissionBusy=true;admissionButtons();const generation=admissionGeneration;
  try{const data=admissionProject(await admissionRequest('/request-catalogue'));if(generation!==admissionGeneration)return;admissionData=data;$('admission-entry').replaceChildren(...data.entries.map(e=>admissionOption(e.entryId,admissionLabel(e))));const requestedRef=preferredRoute.view==='requests'?preferredRoute.ref:null,target=data.entries.find(e=>e.slots.some(s=>s.ref===requestedRef));$('admission-entry').value=target?.entryId??(requestedRef?'':data.entries[0]?.entryId??'');selectAdmissionEntry();admissionCapability();if(target&&admissionSlot)void readAdmissionResult();admissionMessage(requestedRef&&!target?'This result is not in the current enrolled catalogue. Select an input to inspect a different saved result.':data.legacyReviewRequired?'Historical job evidence needs review before new work. Saved results can still be checked.':!data.entries.length?'No approved requests are enrolled.':data.admissionReady?'Review the exact input before approving one call.':'New requests are unavailable. Saved results can still be checked.');}
 catch{if(generation===admissionGeneration&&authenticated){admissionMessage(admissionData?'Requests could not be checked. Showing the previous observation; current availability is unknown.':'Requests could not be checked.');if(admissionData)admissionData.admissionReady=false;$('admission-capability').hidden=false;$('admission-capability').textContent='Current availability unknown. Refresh requests before approving work.';}}
 finally{if(generation===admissionGeneration){admissionBusy=false;admissionButtons();}}
}
function readAdmissionResult({poll=false}={}){
 if(!authenticated||!admissionSlot)return Promise.resolve();if(admissionRead)return admissionRead.promise;
 clearTimeout(admissionPoll);admissionPoll=null;const generation=admissionGeneration,slot=admissionSlot,ref=slot.ref,version=++admissionReadVersion,controller=new AbortController();
 const current=()=>generation===admissionGeneration&&version===admissionReadVersion&&slot===admissionSlot;
 const read={controller,promise:null};admissionRead=read;admissionButtons();
 read.promise=(async()=>{try{const value=await admissionRequest('/requests/'+ref,undefined,{controller});if(!current())return;if(value?.v!==1||value.ref!==ref||!admissionStates.includes(value.state)||typeof value.resultAvailable!=='boolean')throw Error('result');
   if(value.state==='completed'&&value.resultAvailable&&(typeof value.result?.body!=='string'||value.result.body.length>16000||!['information','question'].includes(value.result.kind)))throw Error('result');
   if(['completed','failed','blocked','cancelled','uncertain'].includes(slot.state)&&value.state!==slot.state)throw Error('state_regression');
   slot.state=value.state;slot.statusKnown=true;$('admission-state').textContent=value.state==='uncertain'?'Uncertain. This request is spent. Do not retry it.':value.state==='failed'&&value.reasonCode==='output_incomplete'?'Output incomplete. This request is spent. Do not retry it.':'State: '+value.state;
   if(value.state==='completed'&&value.resultAvailable){$('admission-output').textContent=value.result.body;renderAdmissionText(value.result.body);$('admission-review-note').hidden=!(admissionEntry.entryId===reviewedRegressionResult.entryId&&admissionEntry.inputSha256===reviewedRegressionResult.inputSha256&&ref===reviewedRegressionResult.ref&&value.result.body===reviewedRegressionResult.body);$('admission-result').hidden=false;}
   admissionCapability();admissionMessage(value.state==='completed'?'Saved result ready.':'Saved status checked. No request was resubmitted.');
   if(poll&&['queued','claimed','invoking'].includes(value.state)&&Date.now()<admissionPollUntil&&document.visibilityState!=='hidden')admissionPoll=setTimeout(()=>{if(current()&&authenticated&&Date.now()<admissionPollUntil)void readAdmissionResult({poll:true});},2000);
  }catch{if(current()){slot.statusKnown=false;$('admission-state').textContent='Current status unknown. Last observed: '+slot.state+'.';admissionMessage('Saved status could not be checked. Current status is unknown; showing the last observation. No request will be resubmitted.');}}
  finally{if(current()&&admissionRead===read){admissionRead=null;admissionButtons();}}
 })();return read.promise;
}
function appendResultInline(parent,text){
 const parts=text.split(/(\x60[^\x60\n]+\x60|\*\*[^*\n]+\*\*)/g);for(const part of parts){const code=part.startsWith('\x60')&&part.endsWith('\x60'),strong=part.startsWith('**')&&part.endsWith('**'),node=document.createElement(code?'code':strong?'strong':'span');node.textContent=code?part.slice(1,-1):strong?part.slice(2,-2):part;parent.append(node);}
}
function renderAdmissionText(text){
 const root=$('admission-formatted');root.replaceChildren();const lines=text.split(/\r?\n/);let i=0;
 const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
 while(i<lines.length){let line=lines[i++];if(!line.trim())continue;
  if(/^\s*\x60{3}/.test(line)){const pre=document.createElement('pre'),code=document.createElement('code'),body=[];while(i<lines.length&&!/^\s*\x60{3}/.test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;code.textContent=body.join('\n');pre.append(code);root.append(pre);continue;}
  if(line.includes('|')&&i<lines.length&&cells(lines[i]).every(c=>/^:?-{3,}:?$/.test(c))){const wrap=document.createElement('div'),table=document.createElement('table');wrap.className='result-table';const row=(values,header)=>{const tr=document.createElement('tr');for(const value of values){const cell=document.createElement(header?'th':'td');if(header)cell.setAttribute('scope','col');appendResultInline(cell,value);tr.append(cell);}table.append(tr);};row(cells(line),true);i++;while(i<lines.length&&lines[i].includes('|'))row(cells(lines[i++]),false);wrap.append(table);root.append(wrap);continue;}
  const heading=/^#{1,6}\s+(.+)$/.exec(line),node=document.createElement(heading?'h3':'p');appendResultInline(node,heading?heading[1]:line);root.append(node);
 }
}
async function approveAdmission(){
 if($('admission-approve').disabled||!admissionEntry||!admissionSlot)return;admissionBusy=true;admissionButtons();const generation=admissionGeneration,entry=admissionEntry,slot=admissionSlot;
 try{const proof=await admissionRequest('/request-approvals',{entryId:entry.entryId,slotId:slot.slotId});
  if(proof.existing===true){slot.state=proof.state;await readAdmissionResult();return;}
  if(proof.entryId!==entry.entryId||proof.slotId!==slot.slotId||proof.approvedInputSha256!==entry.inputSha256||!/^[A-Za-z0-9_-]{43}$/.test(proof.nonce??''))throw Error('approval');
  const receipt=await admissionRequest('/requests',{entryId:entry.entryId,slotId:slot.slotId,nonce:proof.nonce,approvedInputSha256:entry.inputSha256,approve:true});if(generation!==admissionGeneration)return;
  if(receipt.ref!==slot.ref||!admissionStates.includes(receipt.state))throw Error('receipt');slot.state=receipt.state;$('admission-state').textContent='State: '+receipt.state;admissionMessage('Registered once. Following this request; it will not be resubmitted.');admissionPollUntil=Date.now()+60000;await readAdmissionResult({poll:true});
 }catch{if(generation===admissionGeneration){slot.state='unknown';admissionMessage('Submission was not confirmed. Check this slot’s saved status. No retry or replacement was sent.');}}
 finally{if(generation===admissionGeneration){admissionBusy=false;admissionButtons();}}
}
$('admission-entry').addEventListener('change',selectAdmissionEntry);$('admission-slot').addEventListener('change',selectAdmissionSlot);$('admission-refresh').addEventListener('click',loadAdmissionCatalogue);$('admission-approve').addEventListener('click',approveAdmission);$('admission-check').addEventListener('click',()=>{if(!$('admission-check').disabled)return readAdmissionResult();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(admissionPoll);admissionPoll=null;}});
`;
