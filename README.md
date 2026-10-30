# PICARD RELAY

```text
                    ###
                   ## ##
                  ##   ##
                 ##     ##
                ##       ##
           ######        #######
         ####  ##    #    ##  ####
       ###    ##     #     ##    ####
     ###      #      ##     ##      ##
    ##       #      ###     ##       ##
  ###       ##      ###      ##       ###
  ##       ##       ###       ##       ##
 ##        #     #########     #        ##
 ##       ##       #####       ##       ##
##       ##        ##  ##       ##       ##
##       #                       #       ##
 ##     ##                       ##     ##
 ##     #             #######     #     ##
  ##   ##          ####     ###   ##   ##
  ### ##         ###          ##   #  ###
   #####       ###             ##  ####
     ##      ###                ## ###
     ##    ###                   #####
     ##  ####                 ########
     # #### #######    ########    ###
    #####        #########          ##
    ###                              #
    #

           P I C A R D  R E L A Y
                MAKE IT SO.
```

*In tribute to Sir Patrick Stewart.*

**Small ship. Durable messages. No surprise warp jumps.**

A lightweight, self-hosted relay for routing tasks to AI providers and reliably returning results. Built for modest hardware and tight budgets. Make it so.

Picard Relay is a lightweight Node.js + SQLite relay for bounded AI requests. It preserves request identity, claims work once, stores correlated responses, and refuses to automatically retry an invocation whose outcome is uncertain.

**Status: early source preview.** The simplest working entry point is an offline demo. A separately gated Groq text-only adapter exists; a complete portable board application, universal AI-provider router, and production automatic updater do not. This repository stores code and signed source envelopes. **GitHub Actions tests, signs and publishes source releases only; it never deploys.**

## Try it locally — no account or API key

Install Node.js 24 (includes `node:sqlite`), Git, and the OpenSSL CLI for the local TLS test. No npm dependencies are required.

```sh
git clone https://github.com/bmartynowicz/picard-relay.git
cd picard-relay
npm run demo
npm test
```

The commands also work from PowerShell. The demo uses synthetic text, creates no listener, and makes no network request. Some permission-sensitive production adapter tests use POSIX filesystem semantics; the complete suite is qualified on Linux, not native Windows.

Expected demo ending: `One synthetic request, one stored answer, duplicate replay suppressed.`

## What is here

- Durable SQLite outbox, leases, replay detection, crash reconciliation and signed request/response protocol.
- Offline fixtures and real separate-process SQLite race/crash tests.
- A fixed Groq `openai/gpt-oss-20b` text-only adapter, disabled by default. No tools, paid fallback, automatic model substitution or automatic inference retries.
- A one-shot adapter limited to the exact harmless `Reply Hello World` pilot input and short-lived externally verified account gate.
- Loopback-only HTTP receiver suitable for a separately configured TLS reverse proxy.
- Fixed-endpoint native HTTPS transport compatible with `node --jitless`; certificate verification stays on. A local TLS fixture tests the adapter without calling Groq.
- [Manual deployment notes](docs/DEPLOYMENT.md), configuration templates and [verification boundaries](docs/STATUS.md).

## Experimental progress

The [bounded next candidate](docs/NEXT-CANDIDATE.md) adds an explicit Free-only
one-shot routing policy in the signed-runtime source, deterministic local fixture
tasks, sanitized diagnostics on the existing signed health action, and an offline
mission-control presentation. It adds no production executor or browser endpoint.
Run `npm run demo:fixtures` or `node examples/mission-control.mjs --output preview.html`
for synthetic local demonstrations; `npm run test:candidate` tests that candidate.

The [isolated updater and runtime-control candidates](experimental/README.md) preserve work toward signed, opt-in manual-host updates. **Disabled, not installed, not production-ready.** They do not replace this repository's normal runtime. See their explicit test results and Unix-socket/root-owned-release verification gaps before experimenting.

## What is not here

A hosted service, your task board, provider credentials, an autonomous coding agent, an unrestricted API proxy, or a one-command production installer. The original board integration is application-specific and is not bundled. Its client must implement the signed protocol and authorization checks; do not treat the local fixture as a production board adapter. The unavailable assistant adapter fails closed; it does not silently substitute another provider.

## Safety and cost

`npm start` is disabled unless explicitly configured. Keep the backend on loopback and use authenticated HTTPS in front of it. Never commit keys, HMAC secrets, credentials, runtime databases, certificate state or request content.

A “Free” gate is an operator's external account-plan verification, **not a billing API check or a hard spending cap**. Free quotas and models can change. Reconfirm eligibility before a live call; do not upgrade billing or retry on quota/payment failure to make a demo pass. The code cannot promise zero cost for an upgraded account.

## Reuse and contributions

Released under the [MIT License](LICENSE), as selected by the repository owner. This is an early source preview. No third-party music, images or character artwork are included. Picard is a project nickname, not an affiliation or endorsement.

Manual review and deployment remain deliberate operator actions. GitHub may build, sign and publish source; installation remains a separately enrolled host action.
