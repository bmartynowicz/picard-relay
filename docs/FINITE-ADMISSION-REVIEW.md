# No-restart admission: separate security proposal and local prototype

The routine requirement is NOT satisfied by the manual client alone. It removes
custom protocol scripting/result handoffs, while operator gate selection and
restart remain. This document/prototype preserves the unfinished requirement.

The pure experimental/finite-admission/planner.mjs prototype has no production
integration, authentication implementation, filesystem, listener, provider or
runtime selector. It always returns mayInvoke:false and refuses production mode.
Its actor object is a trusted-caller PRECONDITION, not an authentication proof.
Tests do not establish real session authorization or crash-safe admission.

## Proposed bounded authority

An operator enrolls a root-controlled finite catalogue once, binding one existing
owner/task/assistant and retained account/project/key enrollment. Each entry has
exact request/context/input hash, a recognized purpose and explicit preallocated
request/grant/event slots. Prototype limits:8 total slots,16KiB catalogue,24hour
catalogue window and1hour maximum request lifetime, with existing512tokens,
one call per slot, no tools/retries/paid fallback. These are review proposals,
not live grants or assumed permission for8 calls.

Each use still requires an actual owner approval of the exact displayed input.
The server must select the listed slot and immutable IDs; the browser may submit
only entryId/slotId, never text, owner/task, provider, model, marker path, grant ID
or expiry. Repeated clicks use the same slot and persisted request. Other task
scopes are not silently added. Changed configuration/enrollment invalidates the
catalogue; original evidence timestamps are preserved, not refreshed.

## Exact future integration delta — NOT IMPLEMENTED OR ENABLED HERE

1. New private GET /request-catalogue and POST /requests under the existing
   explicitly enabled console session, exact HTTPS Host/Origin and no-store
   controls. Require owner session, same-origin/CSRF checks, strict small bodies
   and a visible per-request approval action. No browser HMAC/API key.
2. A separately approved root-owned private catalogue/enrollment file and a
   reviewed reload/read policy using O_NOFOLLOW, bounded reads, complete schema,
   stable identity/permissions and fail-closed key/config association. No new
   credentials; the existing HMAC transport does not become approval authority.
3. Durable first-writer registration through existing relay_jobs transaction:
   preallocated event/grant/slot prevents new inference after duplicate click.
   Use the first persisted payload and clocks. On racing registration conflict,
   authenticate/scope-check and recover that same record, never mint a replacement.
   No new ledger table/index/migration is proposed, but atomic integration and
   power-loss/disk-full behavior still require implementation and crash tests.
4. Per-job adapter selection from that validated catalogue, internally derived
   marker paths and existing consumed-before-I/O plus shared-cost reservation.
   Do not change systemd/environment selectors or restart per admitted slot.
   Single dispatcher/control busy state remains; unknown I/O and payment/quota
   stops still block; only13001's own durably committed incomplete failure may
   settle its own live reservation. Historical uncertain rows/markers never reset.
5. Existing private Jobs remains metadata-only. Any request catalogue display is
   a new authenticated text surface and must be reviewed for auth/privacy/reset,
   not hidden in today's metadata contract. No auto-run/polling/automatic regrant.

This transfers a narrowly finite admission decision from per-request operator
provisioning to authenticated owner action within an independently enrolled
catalogue. It is a material access/security delta and needs exact approval;
general source-work approval does not enable it. It cannot be represented as a
cosmetic UI change or a mere signed protocol transport change.

The prototype plans are useful for reviewing exact binding/limits/idempotency.
Production routes, secure catalogue loading, durable registration, dynamic adapter
selection and owner-approval UI are still implementation/qualification gates.
Any added source files outside the current11module runtime require explicit
updater/delivery policy review; no allowlist/helper/trust expansion occurs here.

## Acceptance before any activation

Owner-session/CSRF/mixed-owner negative tests; strict selection/no arbitrary input;
catalogue/key/config/time mismatch; slot cap; concurrent duplicate registration;
no renewed clocks on reopen; consumed/uncertain/failed persistence and interrupted
admission; source signing/11file compatibility or exact approved migration;
synthetic desktop/mobile approval preview; explicit operator catalogue and live
activation approval. No provider calls are part of prototype qualification.
