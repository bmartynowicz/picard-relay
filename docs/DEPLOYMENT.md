# Manual deployment — advanced preview

Start with `npm run demo` and `npm test`. These instructions are not an automated installer or a claim that arbitrary fresh hosts were tested.

## Requirements

- A Linux host with persistent local storage and Node.js 24; SQLite is built into Node.
- OpenSSL CLI for the offline loopback TLS regression (not for issuing public production certificates).
- Production Groq requests use a fixed-endpoint native `node:https` transport, including under `node --jitless`; no Undici/WebAssembly dependency. Certificate verification remains enabled.
- A dedicated unprivileged service account; root-owned application code and configuration, private service-owned data directory.
- Correct system clock, service supervision, backups of the durable database, and a consuming client that implements `src/protocol.mjs`.
- Trusted HTTPS reverse proxy, with only TCP 443 exposed for the relay and backend bound to `127.0.0.1:8787`.

Review `src/oracle-service.mjs` and `src/selected-assistant.mjs` for exact environment requirements. Template values intentionally cannot activate a provider. Do not expose the backend port or remove HMAC verification to get a health check working.

## Configuration and credentials

Create distinct high-entropy HMAC material and a key ID for the client and relay through your secure secret-management mechanism. Use private regular files for provider keys and gates; never pass secrets on a command line or commit them. Both sides must agree on owner, assistant and allowed task identity. The Groq provider ID is `groq:openai/gpt-oss-20b`.

The one-shot gate shape and validators are in `src/groq-once-adapter.mjs`. It requires your actual owner/task identifiers, the exact approved pilot text/context, external Free-plan evidence, and a validity window of at most one hour. Its marker directory must be owned by the service user, private (0700), absolute, and free of symlinks. The marker is consumed durably **before** network I/O. Do not delete it to retry an uncertain call. Stored-result retrieval is separate from permission to invoke again.

No ready-made live authorization is shipped in this repository.

## Reverse proxy and SELinux

`deploy/Caddyfile.example` is a conventional domain-based template. Replace the hostname with one you control, satisfy certificate issuance requirements, and validate with your installed Caddy version. A domain is not mandatory: public-IP certificates were separately demonstrated with Caddy's short-lived certificate profile and TLS-ALPN validation, but issuance, renewal, CA terms and external reachability must be validated for your own installation. Do not substitute an insecure certificate bypass.

On SELinux-enforcing Oracle Linux, a custom Caddy binary/service needs appropriate persistent contexts: executable `httpd_exec_t`, configuration `httpd_config_t`, writable state `httpd_var_lib_t`. Use `semanage fcontext` and `restorecon` for your exact installation paths. The standard `httpd_can_network_connect` boolean permits outbound connections for **all** services in `httpd_t`, not only this relay. Review that scope before enabling it. Keep SELinux enforcing and inspect actual denials rather than broadly disabling protection.

Configure cloud ingress and guest firewall separately. Service startup is not proof of trusted public TLS. Check an external client with certificate verification enabled, then check signed protocol requests separately. A root 404 from the proxy can be expected and does not prove board dispatch.

## Updates

Deploy manually from a reviewed commit. Stop new claims, preserve database/credentials, test the candidate, restart under supervision, and verify actual signed requests/results. Do not roll back durable state blindly: doing so can re-invoke work already sent. Automatic updating is future work. No Actions workflows or webhook deployment mechanisms are included.
