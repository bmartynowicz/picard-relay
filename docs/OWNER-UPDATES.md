# Check for updates from Picard

The System button runs on enrolled hosts. Source changes are not installed by
opening a preview or publishing a PR. Runtime changes need a signed release;
the owner-update helper and its units are separate host support.

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

Setup failures before the updater starts are saved as failed. A timed-out check
or unreadable post-check observation stays unknown. The helper removes the empty
request directory only after a known outcome has been saved. If the helper cannot
start or status cannot be read/written, the directory remains: the console shows
checking briefly, then unknown, and refuses another request. No private error text
is added to public status.

The service and path templates limit starts to one per five minutes. A retained
request can cause the path unit to stop at that limit; it does not authorize a
replay after the cooldown. An operator must inspect the original status, queue,
HOLD/STOP/journal evidence and unit result before repairing setup or re-enabling
the watcher. Preserve checking/unknown/held evidence; do not reset it to idle or
delete the queue merely to make the button ready.

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
   Check Node startup under the exact service environment, including any existing
   host OpenSSL configuration. Install the reviewed helper and both unit files
   together; a runtime-only source update does not change their limits or logic.
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

