# Owner updates, earned ranks and the space window

Source candidate, November 5, 2026. These changes are not installed merely by
opening the preview or publishing a PR. Existing hosts still need a signed
release; the owner-update bridge needs separate host enrollment.

## Check for updates

System has one **Check for updates** button. On an enrolled host it requests the
existing signed updater, then reports checking, up to date, installed, paused,
failed or unknown. Updates may briefly reconnect the console. A lost response is
followed by read-only status checks, never an automatic second POST.

The new API is authenticated `GET /updates` and same-origin `POST /updates` with
exactly `{}` (64-byte body limit). It accepts no command, URL, unit or policy.
Its state is separate from the existing one-minute updater activity observation.
The existing visible 15-second status refresh reads update-request status while
System is open; no new browser polling timer was added.

The runtime remains unprivileged. It may create one empty `request` directory in
the separately prepared `/var/lib/picard-update-requests` directory. A fixed
systemd path unit starts the root helper, which can only start
`picard-updater.service`. That existing unit still fetches the fixed feed,
verifies its pinned Sigstore identity, exact modules and monotonic sequence,
drains safely, and preserves durable state. The helper has no IP networking or
shell command interpretation. It adds no persistent Node process.

HOLD, STOP, disabled policy and a pending update journal stop the request. Five
minutes of durable cooldown follow an attempt. Interrupted checks stay unknown
for operator review; the button cannot clear stop evidence or request a replay.
`up_to_date` means that this successful check did not change the installed source;
it is not a guarantee against an upstream cache or a later publication.

### Host enrollment checklist

This is preparation, not a portable installer or permission to activate it:

1. Review/install `experimental/updater/owner-request.mjs` and the two
   `picard-owner-update` units as root-owned host support. They are outside the
   signed 20-module bundle. Keep the existing updater/policy/verifier unchanged.
2. Create the fixed queue directory, root-owned, with the existing runtime's
   primary group and exact mode `0770`. Create no general sudo/systemctl rule.
   The runtime requires that exact UID/GID/mode and canonical directory.
3. Initialize root-owned mode-0644
   `/var/lib/picard-updater-status/request.json` in the existing root-owned
   mode-0755 status directory:
   `{"v":1,"state":"idle","requestedAt":null,"finishedAt":null,"retryAt":null}`.
   Never overwrite a checking/unknown/held record to retry it.
4. Validate the fixed units, service filesystem restrictions and actual SELinux
   labels/permissions. Permit only the required queue creation, status reads,
   fixed unit start and helper status write. Keep SELinux enforcing.
5. Add only GET/POST `/updates` to the existing exact proxy routes; see the
   disabled `deploy/Caddyfile.workspace.example`. Set
   `BRIDGE_OWNER_UPDATES_ENABLED=true` only after the bridge is ready, then
   enable its path unit. The source default is disabled.
6. Exercise a no-new-release request on the actual host. Verify the unchanged
   release, saved jobs/markers/configuration and no provider call. Test each
   negative case in disposable Linux fixtures, not by corrupting production.

No host enrollment, new access rule or production activation is claimed by this
source change. A disconnected bridge has a disabled button with a short operator
hint. Resetting an interrupted request is a manual evidence/recovery operation.

## Earned work

Training remains Cadet → Ensign → Lieutenant. Setup, a saved result and an
output-bound owner review teach the existing workflow. After training:

| Rank | Accepted results |
| --- | ---: |
| Commander | 5 |
| Captain | 25 |
| Admiral | 100 or more |

These initial thresholds are product defaults for review. Each distinct request
earns at most one credit when its validated completed result is information and
its **latest** output-bound review is accepted. Changes-requested, uncertain,
failed, empty, incomplete and question outcomes earn no work credit. Changing an
accepted review can reduce the current count/rank. A review still completes
training even if it asks for changes.

The server derives credit from owner-scoped durable reviews across tasks, never
the currently loaded history page. It validates original request/result identity
and hashes, caps the display at 100+, and fails to unknown on inconsistent
evidence. A process-local cache invalidates on same-connection SQLite changes or
another connection's data version; no second progress ledger or schema migration
is introduced. Rank never authorizes execution, another provider, money, retries
or broader API access. Higher ranks add a brass crown, etched wings and a center
inlay to the same spinning insignia. Locked templates/context/code/handoff
exports are hidden; history, original answers and recovery remain available.

## A more visible space window

The optional five-click starfield has brighter pixels, stars positioned in the
visible window gutters, and a faint inset frame around the existing opaque
workspace. Navigation retains its original background. Two existing CSS star
layers gently shift/glimmer when the existing 15-second fresh-status heartbeat
changes phase; there is no perpetual star animation. The logo retains its one CSS
rotor. No canvas, WebGL,
bitmap download, blur, pointer tracker, render loop, dependency or new animation
timer was added. Pause Motion, reduced motion and hidden-tab behavior still
apply. Stars remain off by default and persist only in the current page.

Initial local Chrome diagnostics showed roughly 3.8–4.2% main-thread time for
continuous star animations, compared with about 0.2–0.3% with stars off. Stepping
the animation and compositing hints did not materially improve that observation,
so the candidate uses brief CSS transitions on the existing refresh heartbeat.
The final heartbeat sample used 0.464 seconds of main-thread time over 67.2 seconds (about 0.69%), with about 2.4 MB JavaScript heap; exact readings are retained with the source qualification. These are
unequal local observations including tool activity and status refresh, not a
controlled benchmark or a GPU, battery, low-end-device or Oracle CPU measurement.
Visual effects run in the user's browser; qualify actual client hardware before
claiming negligible overhead.

## How Picard helped

One generic specification was sent to the existing Groq Free enrollment using
`openai/gpt-oss-20b`, one call and a 4,096-token ceiling, no tools/retries/paid
fallback. The saved proposal counted owners instead of requests, suggested a
new auth stack and made unsupported performance claims. A changes-requested
review preserved those findings. The corrected implementation uses the existing
auth/state boundaries and is independently tested; generated text was never
executed. Source tests and any later full-repository Picard worker receipt are
separate from installation and owner acceptance.

The [physical badge research](BADGE-RESEARCH.md) is a separate no-purchase
prototype/design, not an installed device-sync feature.
