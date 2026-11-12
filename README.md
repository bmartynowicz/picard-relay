# Picard Relay

<a id="your-relay-your-cockpit"></a>

**Your AI work, with a durable record.**

Picard is a small, self-hosted workspace for bounded AI requests. Write a brief,
approve the exact input, follow the job and reopen the saved answer later.
Connect your coding assistant through MCP, or use the cockpit yourself.
Generated code stays a proposal for you to review.

[![Curved cockpit with projected activity and a floating saved-result control](docs/images/cockpit-curved-preview.jpg)](docs/COCKPIT-TOUR.md)

*Curved cockpit layout with synthetic local data. The [15-second walkthrough](docs/images/picard-cockpit-walkthrough.gif)
records an earlier v1.0.33 release; the [tour](docs/COCKPIT-TOUR.md) explains the current controls.*

<a id="choose-your-starting-point"></a>

## Start here

| I want to… | Start with |
| --- | --- |
| Try Picard without an account or API key | [Local demo and interface preview](docs/QUICKSTART.md#try-it-locally) |
| Run a useful request on my relay | [First request](docs/QUICKSTART.md#run-your-first-useful-request) |
| Connect my coding assistant | [Independent tool access and MCP](docs/WORKSPACE-AGENT.md) |
| Ask Picard to check a code change | [Fixed repository checks](experimental/compute-broker/CODING-WORKFLOW.md) |
| Set up or update a host | [Operations](docs/OPERATIONS.md) · [Update button](docs/OWNER-UPDATES.md) |
| Understand the code, limits or unfinished work | [Documentation](docs/README.md) · [Limits](docs/LIMITATIONS.md) · [Known work](docs/WORK-REGISTER.md) |

**For AI companions:** [llms.txt](llms.txt) → [project map](docs/project-map.json) → [contributor instructions](AGENTS.md).

<a id="try-it-locally--no-account-or-api-key"></a>

## Try it locally

Install Git and **Node.js 24**. There are no npm dependencies to install.

```sh
git clone https://github.com/bmartynowicz/picard-relay.git
cd picard-relay
npm run demo
```

The demo ends with `One synthetic request, one stored answer, duplicate replay suppressed.`
For the cockpit and request workflow, run:

```sh
npm run preview:v1
```

Open the printed loopback address. Both demos use synthetic data and make no AI
provider call. The interface preview is temporary; it is not a production install.
Stop it with Ctrl+C. Full checks also require OpenSSL and are qualified on Linux.

<a id="v1-request-workspace"></a>
<a id="what-is-here"></a>

## What you can do

- **Approve useful work.** Send a short brief to the configured Groq model,
  follow its progress, review the saved answer, and copy or download it.
- **Come back later.** SQLite retains request identities and saved answers.
  Reconnecting reads the existing result instead of asking the model again.
- **Connect an assistant.** Read-only MCP tools expose status, history and results.
  The opt-in agent adapter also prepares drafts and submits only the exact work
  separately approved by the owner. Tool access is revocable and independent
  of browser sign-ins.
- **Check a change through Picard.** A separate, enrolled compute broker runs
  fixed public-project CI checks on one approved commit and returns a verified
  receipt. This is distinct from generating a text/code proposal.
- **Make it your cockpit.** Curved controls, expanding reading panels, optional
  stars, whole-VM CPU, earned ranks and Stealth Mode keep the essentials nearby.
  Motion can be paused; reduced motion is respected. Effects run in your browser.
- **Operate your relay.** Inspect health and installed identity, use the connected
  update button, replace an enrolled Groq key and inspect recorded workflow usage.

![An approved AI brief produces a saved proposal; an approved fixed CI job produces a verified receipt](docs/images/workflows.svg)

Text equivalent: a brief goes through exact approval and one Groq call to a
saved answer. A pinned public commit goes through an approved fixed CI job to a
verified receipt. Reading either saved result does not repeat execution.

<a id="what-is-not-here"></a>
<a id="safety-and-cost"></a>

## What to expect

The live text adapter is fixed to **Groq `openai/gpt-oss-20b`**: one call per
approval, at most 4,096 output tokens, no model tools, generated-code execution,
automatic retries or paid fallback. Request and context fields each allow up to
4,000 characters, with a combined byte limit. See [complete limits](docs/LIMITATIONS.md).

An uncertain outcome keeps its evidence and stops. Completed means an answer
was saved, not that it is correct or that a change was accepted, merged or
deployed. Saved-result recovery can remain available when new work is blocked.

The runtime uses Node.js and SQLite without package dependencies. Production
hosts need explicit Linux enrollment, HTTPS, provider setup and durable storage;
there is no one-command production installer. Signed updates replace allowed
runtime source, while host setup, credentials and saved state stay separate.
GitHub publishes releases; an enrolled host updater installs them.

Free-plan enrollment and no-paid-fallback controls are retained safeguards,
not a live billing guarantee. Fixed CI jobs have separate provider/allowance
rules. A CPU gauge does not measure available provider quota or budget.

<a id="experimental-progress"></a>

## Current status and next work

The latest recorded enrolled-host verification is **v1.0.59**, with independent
tool access and saved-result recovery checked on November 12, 2026. The setup
cleanup in [PR #123](https://github.com/bmartynowicz/picard-relay/pull/123) is
merged and verified from main. Read [dated evidence](docs/STATUS.md) for the
tested source and scope; each host has its own installed version.

Unfinished areas include portable installation, a reusable task-board connector,
less manual feedback submission, broader execution/provider support and the
physical voice badge. See [known work](docs/WORK-REGISTER.md) for the dated source
snapshot. The owner's private board is the operational backlog and is not bundled.

<a id="reuse-and-contributions"></a>

## Build and contribute

Read [AGENTS.md](AGENTS.md) and [Development](docs/DEVELOPMENT.md). The signed
runtime lives in `experimental/runtime-control/src/`; top-level `src/` is the
separate offline preview. Generated proposals are never executed automatically.

[MIT License](LICENSE). Picard is a project nickname, not an affiliation or
endorsement. In tribute to Sir Patrick Stewart.
