# Picard Relay documentation

Picard turns an exact approved AI request into a durable saved answer. You can
use its console or connect an assistant through scoped local MCP tools. A
separate compute broker checks approved project commits through fixed workers.
**[New relay: guided setup →](SETUP.md)** · **[Already set up: first useful request →](QUICKSTART.md)**

Start with a saved checklist you can use, then reopen the same answer. You need
your relay address, owner sign-in and a ready Free Groq workspace.
[Check the prerequisites](QUICKSTART.md#before-you-start) before you start;
the [local demo](QUICKSTART.md#try-it-locally) uses synthetic answers only.

[Controlled measurement reruns](CONTROLLED-MEASUREMENT-RUNS.md) describes the disabled-by-default independent-run authority and staged approval gates.

## Reference guides

| Your next step | Read |
| --- | --- |
| Set up a new relay on your existing Linux machine | [Guided setup](SETUP.md) |
| Run your first useful request | [First-request steps](QUICKSTART.md#run-your-first-useful-request) · [V1 workflow](V1.md) |
| Find your way around the interface | [Cockpit tour](COCKPIT-TOUR.md) · [Console guide](CONSOLE-WORKSPACE.md) |
| Connect an AI companion | [Tool enrollment and approved handoff](WORKSPACE-AGENT.md) · [Read-only adapter](WORKSPACE-MCP.md) |
| Check an exact code change through Picard | [Coding workflow](../experimental/compute-broker/CODING-WORKFLOW.md) |
| Install or maintain a host | [Operations](OPERATIONS.md) · [Update button](OWNER-UPDATES.md) · [Fresh CLI sign-in](CLI-OWNER-SESSION.md) |
| Understand progress and usage | [Ranks and owner features](OWNER-FEATURES.md) · [Flight instruments](FLIGHT-INSTRUMENTS.md) · [Workflow accounting](CLI-WORKFLOW.md) |
| Build or integrate | [Development](DEVELOPMENT.md) · [Architecture](ARCHITECTURE.md) · [API](API.md) |
| Connect a task board | [Owner-approved handoff contract](../integrations/README.md) |
| Offer a bounded public test from your relay | [Public trial controls and limits](PUBLIC-TRIAL.md) |
| Check limitations, bugs or feature requests | [Limitations](LIMITATIONS.md) · [Known work](WORK-REGISTER.md) · [Dated verification](STATUS.md) |

The [15-second walkthrough](images/picard-cockpit-walkthrough.gif) records an
earlier v1.0.33 interface. The tour labels that recording separately from the
curved source preview and current controls.

## For AI companions

Read [llms.txt](../llms.txt), [AGENTS.md](../AGENTS.md) and the
[project map](project-map.json) before changing code or proposing live work.

| Contract | Scope |
| --- | --- |
| [Workspace](workspace-contract.json) | Drafts, exact approval, saved answers and owner reviews. |
| [Read-only MCP](workspace-mcp-contract.json) | Three local status/history/result tools; no provider invocation. |
| [Approved agent MCP](workspace-agent-contract.json) | Independent tool credentials, five tools, owner-only management and exact one-use approval. |
| [Compute broker](../experimental/compute-broker/contract.json) | Separately enrolled fixed operations, finite authority and receipts. |
| [Work register](work-register.json) | Sanitized dated bugs/features; not an export of the private board. |
| [Interface tour](interface-tour.json) | Media provenance and source-documented controls. |

## Which information wins?

1. For behavior, inspect source and tests at the commit you are using.
2. For installed state, inspect that host's authenticated System view and
   physical release identity. A branch or successful workflow does not prove installation.
3. The [status page](STATUS.md) records dated checks. Its latest recorded host
   is v1.0.59 on November 12, 2026; other hosts have their own state.
4. The owner's private task board is the operational backlog. The public work
   register preserves source/delivery scope and does not infer owner acceptance.

Top-level `src/` is the offline preview; `experimental/runtime-control/src/` is
the signed runtime. Host support and credentials are outside that bundle.
Older checkpoint documents retain their original date and verification limits.

For longer-term work: [physical voice badge](BADGE-RESEARCH.md),
[provider research](../experimental/compute-broker/PROVIDERS.md) and
[execution enrollment](../experimental/compute-broker/EXECUTION.md).
