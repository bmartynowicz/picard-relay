# PICARD RELAY

```text
         .-============-.
     ___/   P I C A R D   \___
    (____.--------------.____)
              \ || /
  [==========]==||==[==========]
                ||
             .--||--.
             '------'

       P I C A R D  R E L A Y
            MAKE IT SO.
```

*In tribute to Sir Patrick Stewart.*

**Small ship. Durable messages. No surprise warp jumps.**

A lightweight, self-hosted relay for routing tasks to AI providers and reliably returning results. Built for modest hardware and tight budgets. Make it so.

Picard Relay is a lightweight Node.js + SQLite relay for bounded AI requests. It preserves request identity, claims work once, stores correlated responses, and refuses to automatically retry an invocation whose outcome is uncertain.

**Status: early source preview.** The simplest working entry point is an offline demo. A separately gated Groq text-only adapter exists; a complete portable board application, universal AI-provider router, and automatic updater do not. This repository stores code. **There are no GitHub Actions or automatic deployments.**

## Try it locally — no account or API key

Install Node.js 24 (includes `node:sqlite`) and Git. No npm dependencies are required.

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
- [Manual deployment notes](docs/DEPLOYMENT.md), configuration templates and [verification boundaries](docs/STATUS.md).

## What is not here

A hosted service, your task board, provider credentials, an autonomous coding agent, an unrestricted API proxy, or a one-command production installer. The original board integration is application-specific and is not bundled. Its client must implement the signed protocol and authorization checks; do not treat the local fixture as a production board adapter. The unavailable assistant adapter fails closed; it does not silently substitute another provider.

## Safety and cost

`npm start` is disabled unless explicitly configured. Keep the backend on loopback and use authenticated HTTPS in front of it. Never commit keys, HMAC secrets, credentials, runtime databases, certificate state or request content.

A “Free” gate is an operator's external account-plan verification, **not a billing API check or a hard spending cap**. Free quotas and models can change. Reconfirm eligibility before a live call; do not upgrade billing or retry on quota/payment failure to make a demo pass. The code cannot promise zero cost for an upgraded account.

## Reuse and contributions

Released under the [MIT License](LICENSE), as selected by the repository owner. This is an early source preview. No third-party music, images or character artwork are included. Picard is a project nickname, not an affiliation or endorsement.

Manual review and deployment remain deliberate operator actions. GitHub is source storage only.
