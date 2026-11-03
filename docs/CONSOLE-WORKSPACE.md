# Private console workspace

The existing authenticated console is organized into four client-side views:

- **Overview:** observed service/readiness state, scoped counters and recent
  activity. Operational service health does not imply provider capacity.
- **Jobs:** existing bounded history, aligned rows and a metadata-only inspector.
  Filters apply only to loaded rows; pagination remains manual and capped at 100.
- **Groq:** observed availability and the existing Free-only, exact one-request
  policy. No other provider or request-submission control is introduced.
- **System:** observed release fingerprint and honestly unknown version/updater
  information where the runtime does not supply evidence.

Navigation, filtering and inspection make no network requests. Refresh uses the
existing authenticated `/status` and `/jobs` reads. No backend route, session,
password, grant, selector, marker, ledger schema or execution authority changes.
Only the embedded `CONSOLE_HTML` value changes in the signed runtime source.

The exact insignia is preserved. Counter motion remains bounded, pausable and
disabled by reduced-motion preference or hidden visibility. Every added private
field, selection and accessibility label is cleared on logout, 401, 403 and
pagehide. Failed reads retain the last actual observation and report uncertainty
about current availability. Uncertain jobs never acquire a retry action.

## Synthetic visual qualification

Run `node examples/console-preview.mjs <output.html>` to generate one complete
preview from the exact embedded production HTML. The preview intercepts all data
requests with deterministic synthetic responses and never falls back to network.
It contains no owner session, real data, password, provider key or live connection.
Serve only through an approved preview workflow; the generator starts no server.
Do not treat this fixture as proof of a real authenticated session, TLS, filesystem
authorization, native OS reduced-motion preference or successful provider call.

The fixture supports responsive widths, stale/unavailable reads, 401/403 privacy
reset, bounded pagination, motion and count changes. The runtime test harness
also verifies four-view navigation, loaded-row filters, inspector projection,
privacy clearing and absence of request-dispatch controls.

Routine-request admission simplification remains separate local work. This
console does not issue gates, approve jobs, change enrollment or run AI requests.
