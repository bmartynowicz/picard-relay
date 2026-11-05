# Owner updates, earned ranks and the space window

Source candidate, November 5, 2026. These changes are not installed merely by
opening the preview or publishing a PR. Existing hosts still need a signed
release; the owner-update bridge needs separate host enrollment.

## Check for updates

The System button and its separate host enrollment are documented in the
[owner update guide](OWNER-UPDATES.md). They are prepared independently of the
HUD so a host can receive the update button without changing its appearance.

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

## Windshield HUD

Activate the insignia five times to switch between the console and an optional
space windshield. The navigation keeps its existing material and colors. Two
small inline SVG star planes scale slowly over 90 seconds, giving a sense of
forward travel. The scene is clipped outside the navigation. Stars remain off by
default and persist only in the current page.

The compact view shows relay readiness, projected **active** and **completed**
job counts, progress and the next useful action. These are real observed relay
values, not simulated flight instruments. Failed, stale or materially future
observations show unknown counts. Clicking the counts opens Jobs; clicking
readiness opens System. The next action continues an unfinished request or the
current onboarding step.

Navigation opens a floating opaque panel: 560px for Groq/System, 660px for
Overview and 760px for Jobs/Requests, bounded by the viewport. Narrow layouts
use one column and a scrollable panel. **Minimize panel** or Escape restores the
windshield without clearing the draft, selected result or job context. Focus
returns to an instrument. Counts use a static text glow; they add no animation.

There is no canvas, WebGL, bitmap download, blur, pointer tracker, JavaScript
render loop, dependency or new polling timer. Two CSS star animations run only
while the optional scene is active. Pause Motion and hidden tabs pause them;
reduced motion displays a static scene. The insignia retains one CSS rotor.

A local Chrome sample of the vector scene used 7.896 seconds of main-thread
time over 821.6 seconds (about 0.96%), including status refresh and browser-tool
activity, with about 2.7 MB JavaScript heap. Earlier box-shadow experiments used
roughly 3.8–4.2%; those renderers were replaced. These observations are not a
controlled benchmark or a measurement of GPU, battery, low-end hardware or Oracle
CPU. Effects render in the user's browser. All five panels were checked at real
320px and 390px viewports; minimizing retained an unfinished synthetic draft.

## How Picard helped

Two generic specifications were sent through the live relay's existing Groq
Free enrollment using `openai/gpt-oss-20b`, each limited to one call and 4,096
output tokens, with no tools, retries or paid fallback. The first proposal
counted owners instead of requests, suggested a new auth stack and made
unsupported performance claims. A changes-requested review preserved those
findings; those suggestions were not adopted.

The [second saved proposal](https://picard-relay.141-148-50-78.sslip.io/#requests/8b1fe2e29a52f3a44529fd0a5a39614dbf0e446d22ee67ec3913f3f1f2917068)
generated the HUD panel-state helper now used by the browser. Review added a
strict string guard and replaced suggested third-party test assumptions with
built-in regression tests of the actual embedded function. Tests cover exact
booleans, five view widths, unknown/inherited names, minimizing/Escape, private
clearing and truthful projected counts. Original proposals and reviews remain
saved. Generated text was reviewed before integration, never auto-executed.
Source checks remain separate from installation and owner acceptance.

The [physical badge research](BADGE-RESEARCH.md) is a separate no-purchase
prototype/design, not an installed device-sync feature.
