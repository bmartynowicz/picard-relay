<a id="what-picard-does-and-how-to-use-it"></a>

# Start with Picard Relay

Picard saves an exact approved AI request, sends it once and keeps the answer
for later. Choose a local demo, your already-enrolled relay, or a coding-tool
connection. [Limits](LIMITATIONS.md) · [All guides](README.md)

<a id="try-the-offline-demo"></a>

## Try it locally

You need Git and **Node.js 24**. No account, API key or dependency install is
needed for either demo.

```sh
git clone https://github.com/bmartynowicz/picard-relay.git
cd picard-relay
npm run demo
```

The terminal demo ends with:

```text
One synthetic request, one stored answer, duplicate replay suppressed.
No network, API key, billing, deployment, or live AI invocation.
```

To try the console instead:

```sh
npm run preview:v1
```

Open the printed loopback address on the same computer. The preview uses
temporary synthetic data and makes no external AI calls. Press Ctrl+C to stop.
It does not install a production service. `npm start` needs explicit runtime
configuration; it is not the preview command.

For a real host, follow [Operations](OPERATIONS.md). HTTPS, durable state,
provider enrollment and the updater require operator setup. There is no
one-command production installer. OpenSSL is needed for TLS tests; the complete
release suite is qualified on Linux. See [Development](DEVELOPMENT.md).

<a id="use-the-v1-owner-workspace-on-an-enrolled-host"></a>

## Run your first useful request

These steps require an enrolled host with its workspace and Free Groq
configuration ready. Sign in at the HTTPS address supplied by its operator.
For a local rehearsal, use the synthetic preview above.

![Write a brief, review and approve it, follow the job, then reopen and review its saved answer](images/first-request.svg)

1. Select **New request** or open **Requests**. Give the work a clear title and
   brief. For a small useful example:

   > Turn these release checks into a concise checklist: verify the installed
   > version, run one approved request, and reopen an older saved answer.

2. Select **Review request**. Check the exact text/context, model and limits.
   Choose **Approve one call** only when that is the work you intend to send.
3. Follow the request in **Jobs** and open its saved result. Reading or
   refreshing the result does not send another provider request.
4. Inspect the answer. **Accept result** or **Request changes** records your
   review; neither action applies generated code. Copy or download the answer
   when you are ready to use it elsewhere.

A quality grade is separate from the owner review. Onboarding ends after the
first review; rank progress remains available. Open **Rank guide** from
**Your progress**, or use **Settings → Replay walkthrough** to revisit the
steps. Later ranks depend on accepted useful results, not clicks or elapsed time.
See [ranks and unlocks](OWNER-FEATURES.md#earned-work).

## Find your way around

| View | Next useful action |
| --- | --- |
| Overview | Continue onboarding, open the rank guide, inspect readiness and recent work. |
| Jobs | Find a request and reopen its saved answer. |
| Requests | Write a brief, review exact input and approve one call. |
| Groq | Inspect readiness and use **Replace key** when the host supports it. |
| System | Check the installed version, health and connected update button. |

Select **Cockpit view** to use the windshield layout. Its **Workspace**,
**Stars** and motion controls are separate. Click a navigation control to open
its reading panel; click it again, exposed space or Close, or press Escape to
retract it. The five-click logo shortcut remains available, but is not needed to
discover Cockpit Mode. Preferences are remembered in this browser.

**Stealth** has an **Alt+Shift+S** shortcut. Optional **Auto** settings cover
tab switching and inactivity; they start off. This changes the display, not your
network identity. **Refresh · Live 15s** reads status. Reload the page to load an
updated interface. The [tour](COCKPIT-TOUR.md) covers the controls and clearly
labels its earlier recorded walkthrough.

## Connect your coding assistant

Use [independent tool access](WORKSPACE-AGENT.md) for a local stdio MCP
connection. `read` access exposes status, history and saved answers; opt-in
`approved-work` mode also prepares drafts and submits a separately
owner-approved draft. The assistant cannot approve its own work or grade it.
Tool access is revocable, expires explicitly and survives browser sign-in changes.

When setup requires a recent password check, use the private terminal command
rather than sending a password in chat:

```sh
node tools/workspace-request.mjs login --origin https://YOUR-RELAY --fresh
```

Follow the guide for enrollment, protected storage, exact approval and proxy
configuration. To check an exact public Picard commit through the separate
fixed CI worker, use [the coding workflow](../experimental/compute-broker/CODING-WORKFLOW.md).
A model proposal is not a CI result.

<a id="read-the-outcomes-correctly"></a>

## If something stops

- **New work blocked:** read the reason in Overview/Groq. Saved answers may
  still open. An expired grant does not renew automatically.
- **Completed:** an answer was saved; inspect it before use. Acceptance,
  execution, merge and deployment remain separate actions.
- **Failed, incomplete or uncertain:** keep the request identity and evidence.
  Do not replay the call automatically or create a replacement request to retry.
- **Tool access missing:** check enrollment/expiry and the fixed HTTPS proxy
  routes. An older proxy can strip bearer authentication. See the
  [upgrade checklist](WORKSPACE-AGENT.md#upgrade-an-existing-https-proxy).

<a id="use-an-enrolled-host-with-the-legacy-finite-picker"></a>

Older finite-picker hosts offer enrolled inputs and **Approve and queue**
instead of a free-text brief. An operator must enroll that exact input and slot;
spent slots stay spent. See [the legacy API](API.md) for that compatibility path.
