# Owner updates, earned ranks and the space window

Updated November 12, 2026. The cockpit and ranks are in the signed-runtime source;
the latest recorded enrolled-host identity is v1.0.59. Use the [visual tour](COCKPIT-TOUR.md)
for controls and the walkthrough, and [Status](STATUS.md) for dated installation
evidence. Other hosts still need a signed release; the owner-update bridge needs
separate host enrollment.

## Check for updates

The System button and its separate host enrollment are documented in the
[owner update guide](OWNER-UPDATES.md). They are prepared independently of the
HUD so a host can receive the update button without changing its appearance.

## Earned work

Open **Rank guide** from **Your progress** for all ranks and unlocks.
The first-run walkthrough ends after the first review and can be replayed from
**Settings → Replay walkthrough**. Rank progress remains visible. A 1–5 quality
grade is separate from the output-bound acceptance review used for rank credit.

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

Select **Cockpit view** above the Workspace or activate the insignia five times to switch
to the optional windshield. A centered horizontal control rail keeps the navigation opaque
and preserves the spinning upper-left insignia.
Refresh sits at the right of the navigation. Documentation and sign-out are
in its adjacent menu. Two
small inline SVG star planes use independent 113-second and 179-second base
loops, giving a sense of forward travel. Round stroke caps replace expanding
square pixels; 128 irregularly placed points use two restrained sizes, and both
planes start partway through their travel so the scene is visible immediately. The two planes still
contain only four static paths. The opaque navigation covers the
scene. The curved rail integrates layout, **Stars**, motion, **Stealth** and **Auto**. Stars can be switched off while the HUD stays visible. The
browser remembers both display choices.

The compact view shows relay readiness, projected **active** and **completed**
job counts, progress and the next useful action. These are real observed relay
values, not simulated flight instruments. Failed, stale or materially future
observations show unknown counts. Clicking the counts opens Jobs; clicking
readiness opens System. The next action continues an unfinished request or the
current onboarding step.

Navigation expands a translucent panel from its control: up to 560px for
Groq/System, 660px for Overview and 760px for Jobs/Requests, bounded by the
available windshield. Short content stays compact; long content scrolls inside.
Controls follow the glass curve and meet the viewport bottom. On narrow screens
they form upright, tappable rows.

On short phones (up to 700px wide and 700px tall), the header and HUD compact
to leave more room for reading. Panels use the remaining windshield and scroll
internally; the HUD's next action stays available. Display and instrument
buttons keep 44px touch targets. Taller phones and desktop retain their layout.

The old panel folds back before the next opens, including VM CPU and Auto.
Click the same control, Close, exposed space or Escape to retract it without
clearing the draft or result. Focus returns to its control. Reduced motion or
Pause skips the fold. Sign-out and Stealth cancel pending openings.

A fresh, loaded history supplies the windshield readout: uncertain work first,
then active work or the latest saved result. Selecting a result expands its
answer across the windshield. × hides the readout across reloads; **Show windshield
readout** in the account menu restores it. Opening panels submits no work.
One resize observer fits the curve after layout changes, with no new polling
timers, frame loops, dependencies or server endpoints.

The [flight instrument refinement](FLIGHT-INSTRUMENTS.md) adds a VM CPU reading,
an etched navigation rail and background-only look-around. Measured whole-VM CPU
gently changes travel speed from 1× to at most 1.3×. There is no canvas,
WebGL, bitmap download, blur, JavaScript render loop, dependency or new polling
timer. Pointer movement is handled only over exposed space. Two CSS star animations run only
while the optional scene is active. Pause Motion and hidden tabs pause them;
reduced motion displays a static scene. The insignia retains one CSS rotor.

An earlier layout's local Chrome sample of the vector scene used 7.896 seconds of main-thread
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

A [third saved proposal](https://picard-relay.141-148-50-78.sslip.io/#requests/6352a2dfda1a1c86557bec3f9c1ede78ec9fc48763374a18e752164935d4cd9d)
helped generate the static round-dot paths for the cockpit refinement. Review
changed each point to an independent move command (the proposal connected them),
rejected sparse arrays and corrected the suggested assertions. The corrected
generator ran during development; the browser receives static path data. CSS
compositor scaling can still change apparent dot size; the thin round strokes
keep the rendered geometry round. This was one existing Free-enrollment call,
without tools, retries, paid fallback or source/private data in the brief.

The [physical badge research](BADGE-RESEARCH.md) is a separate no-purchase
prototype/design, not an installed device-sync feature.
