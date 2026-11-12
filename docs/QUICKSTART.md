<a id="what-picard-does-and-how-to-use-it"></a>

# Your first useful Picard request

Turn a rough note into a short checklist, save the answer and reopen it without
sending another model request. This is the real-request path on your own relay.

## Before you start

Have these ready:

- Your relay's **HTTPS address** and **owner sign-in**, supplied by whoever set
  up your host. Picard does not provide a shared hosted account.
- An enabled request workspace and a configured **Groq Free** key/enrollment.
  Your operator completes [provider setup](DEPLOYMENT.md#configuration-and-credentials)
  and [workspace activation](V1.md#activation-and-limits); signing in alone
  does not enroll either one.
- **Ready for new work** in Overview. If blocked, read the reason in Groq before
  approving anything. Existing saved answers can remain readable.

**Don't have a relay?** Stop here for operator setup. Picard does not yet have
a one-command production installer. An operator must configure a Linux host,
Node.js 24, persistent storage, HTTPS, owner authentication and the explicitly
enrolled Free provider/workspace. Follow [the installation boundary](OPERATIONS.md#installation-boundary)
and [manual host setup](DEPLOYMENT.md). Cloning this repository or running the
demo does not complete that setup. Keep passwords and API keys out of chat.

Already set up? Use your own relay address and continue below.

<a id="use-the-v1-owner-workspace-on-an-enrolled-host"></a>

## Run your first useful request

Sign in to your relay. **Expected result:** a saved checklist with three checks
you can copy, review and use. The model drafts the checklist; it does not test
your relay or perform the checks.

1. Select **New request** in the console. In **Task title**, enter **My relay
   checklist**. In **What should Picard do?**, paste:

   > Turn this rough note into exactly three short checklist bullets, one per
   > check: verify the installed version; confirm a saved answer opens; inspect
   > the Groq readiness reason. Do not perform the checks or claim they passed.

2. Click the **Review request** button below the brief. **Draft saved. No
   provider call has been made.** confirms the draft. Check its exact brief,
   context, fixed model and displayed limits.
3. Select **Approve one call** when the draft is right. This sends one real
   request to Groq. Follow it in **Jobs** and open the saved answer.
4. Read the three bullets and copy or download the checklist. **Accept result**
   records that the answer was useful; **Request changes** records your feedback.
   Neither applies code, performs the checklist or starts another call.
5. Leave the answer and reopen the same request from **Jobs**. It should show
   the same saved answer, without asking you to approve or send it again.

If the result is failed, incomplete or uncertain, keep its reference and read
the reason. Do not send a replacement request just to retry it.

![Write a brief, review and approve it, follow the job, then reopen and review its saved answer](images/first-request.svg)

A quality grade is separate from the owner review. Onboarding ends after the
first review; rank progress remains available. Open **Rank guide** from
**Your progress**, or use **Settings → Replay walkthrough** to revisit the
steps. Later ranks depend on accepted useful results, not clicks or elapsed time.
See [ranks and unlocks](OWNER-FEATURES.md#earned-work).

<a id="try-the-offline-demo"></a>

## Try it locally

**Synthetic demo only:** no real model, API key or account is used, and the
answers do not prove live provider readiness. Install Git and **Node.js 24**:

```sh
git clone https://github.com/bmartynowicz/picard-relay.git
cd picard-relay
npm run preview:v1
```

Open the printed loopback address on the same computer to rehearse the request
steps. It returns a fixed sample proposal, not a model answer to your brief.
The preview has temporary data; Ctrl+C stops it. `npm run demo` runs the
separate offline terminal example, ending with `One synthetic request, one stored answer, duplicate replay suppressed.`
Neither command installs a production service. `npm start` needs explicit
runtime configuration; it is not the preview command.

## After your first answer

Use another small task you actually need help with. Include only text you
intend to send to the configured provider. Generated code remains a proposal
for you to review. [Limits](LIMITATIONS.md) · [All guides](README.md)

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
