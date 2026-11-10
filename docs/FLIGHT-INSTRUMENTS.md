# Flight instruments

Source candidate, November 5, 2026. Publishing this guide or opening the preview does not install it on a host.

The cockpit keeps its instruments steady while space moves behind them. The centered navigation uses an etched rail with illuminated selections. Click a view to expand its reading deck; click exposed space or press Escape to retract it. Drafts and selection stay in place.

## Power reading

Select **Cockpit** beside Refresh to show the HUD. **VM CPU** shows whole-VM utilization. Click it for CPU, VM memory, Picard RAM and the sample time. The same readings are available in System. `—` means unavailable. `0%` means a measured zero.

The reading covers every workload on the supporting Linux VM. It does not measure Picard alone, remaining credits or the size of the provider's free allocation. Memory uses available memory, including reclaimable cache; Picard RAM covers the relay's Node process, not all services on the host. The VM must expose normal Linux `/proc` counters. Other platforms show unknown values.

The existing signed-in status refresh supplies the readings. Its first CPU sample establishes a baseline; a second sample at least 15 seconds later provides utilization. Long gaps, failed reads, counter resets, stale samples and invalid values become unknown. Memory is independent of CPU. There is no metrics history or monitoring daemon. [The API contract](API.md) defines the fields and limits.

## Space travel

The scene uses 128 irregularly placed round stars in two independent planes, with different travel times and origins. It still loops; it is not an infinite simulation. Higher measured VM CPU gently raises travel speed from **1× to at most 1.3×**, preserving each animation's phase. Missing or stale readings restore the base speed. This visual cue represents measured usage, not invented speed or a capacity guarantee.

Move the pointer over exposed space to look around. With the space view focused, arrow keys also work. The background moves at most 14px horizontally and 10px vertically. The HUD, navigation, reading deck and controls do not move with it. Controls ignore look input; leaving the scene recenters it. Touch does not hijack scrolling.

Pause Motion, reduced motion and hidden tabs disable look-around and pause travel. Reduced motion keeps a static scene. These controls never change job execution or provider selection.

## Small-machine budget

The host performs two fixed, bounded kernel-file reads and one process-memory read, cached for 15 seconds and reached only through authenticated status requests. There is no added polling loop, process, dependency, canvas, WebGL or JavaScript animation loop. Look-around updates only on input, at most about 30 times per second, using one background transform. The same two CSS travel animations remain; only their playback rates change on a status update.

The static console document guard is 144 KiB, increased from 128 KiB for these controls; request/provider body limits and the 20-module runtime allowlist are unchanged. This is a bounded size limit, not a measured CPU, GPU, battery or low-end hardware benchmark. The local preview uses explicitly synthetic metrics and makes no external AI calls. `PICARD_PREVIEW_VM_CPU` can set its fixture reading from 0 to 100.

## Picard's contribution

The live relay generated the [reading-validation proposal](https://picard-relay.141-148-50-78.sslip.io/#requests/87ad801f24bb1056562d7f484c29d511b1a73f5d56dbd3845acf97994decc4b9) using its existing Groq Free enrollment, one call with a 4,096-token output ceiling, no tools, retries or paid fallback. Review found that the proposed object guard admitted arrays with attached properties; the integrated helper rejects them and explicitly checks finite numbers. Built-in tests exercise zero versus unknown, freshness, malformed input and the actual embedded browser behavior. Generated code was inspected before testing. No saved review decision is claimed for that proposal.

The earlier [round-star proposal](https://picard-relay.141-148-50-78.sslip.io/#requests/6352a2dfda1a1c86557bec3f9c1ede78ec9fc48763374a18e752164935d4cd9d) informed the corrected offline SVG path generator. The browser receives static vector paths, not a generator or model call.
