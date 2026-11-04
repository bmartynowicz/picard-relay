# Picard Relay documentation

Picard Relay accepts a narrowly approved AI request, records it durably, sends it to the configured provider once, and makes the saved answer available for later retrieval. It also provides an authenticated console for inspecting the relay. Generated answers are proposals for a person to review; Picard does not execute them.

## Start here

| Goal | Read |
| --- | --- |
| Create requests, download results and review answers | [V1 workflow](V1.md), [AI/API contract](workspace-contract.json) |
| Understand Picard and try it without an account | [Quickstart](QUICKSTART.md) |
| Use the live console and recover an answer | [Console guide](CONSOLE-WORKSPACE.md) |
| Understand components, authority and job states | [Architecture](ARCHITECTURE.md) |
| Integrate a client or inspect the protocol | [API reference](API.md) |
| Configure, release, operate or troubleshoot a host | [Operations](OPERATIONS.md) |
| Change code and run the appropriate checks | [Development](DEVELOPMENT.md) |
| Understand constraints and unsupported behavior | [Limitations](LIMITATIONS.md) |
| Find known bugs and requested features | [Work register](WORK-REGISTER.md), [structured register](work-register.json) |
| Check what has actually been verified | [Status](STATUS.md) |

For AI tools, begin with [../llms.txt](../llms.txt), [../AGENTS.md](../AGENTS.md) and [project-map.json](project-map.json). The JSON files use stable IDs, explicit states and repository-relative paths. They contain no credentials or ready-to-run approval grants.

## Which information wins?

1. For behavior, inspect the relevant source and its tests at the commit you are using.
2. For installed state, inspect that host's authenticated System view and physical release identity. A repository branch or successful workflow does not prove installation.
3. Use this index and its linked guides for current documentation. The work register is a dated, sanitized snapshot of known work; the owner's private task board remains the operational record.
4. Older review/checkpoint documents preserve design history. Their original verification limits apply to their stated checkpoint, rather than all later releases.

The top-level `src/` offline preview and `experimental/runtime-control/src/` signed-runtime source are separate trees. Read [Development](DEVELOPMENT.md) before changing a file: changing the top-level preview alone does not update the signed console.
