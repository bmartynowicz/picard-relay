# Protected public relay trial

The public cockpit can offer **Test the relay** alongside its practice guide.
Practice uses a fixed sample and makes no AI call. The live trial queues that
same harmless task on an explicitly configured owner's relay. It uses the
existing Free Groq enrollment and the normal durable dispatcher, not a second
provider client or background service.

## Owner controls

The feature is off by default. After the reviewed runtime is installed and the
proxy is configured, open **System → Public trial → Manage test allowance**.
Review the exact request, context, Free enrollment and public-results notice.
Check the approval box and choose **Enable 8 tests**. A recent owner sign-in is
required. This approves a distinct finite public batch; it does not manufacture
an owner-console or signed task-board approval.

- Eight calls total per manual refill; one public job at a time.
- Each call has a 512-output-token ceiling, no tools, execution, retries or paid
  fallback. Provider reasoning can consume that ceiling and yield no useful answer.
- An accepted request spends its slot before external I/O. A failed or uncertain
  attempt stays spent. Uncertainty stops the public trial and blocks refill.
- Turn off stops new admissions and not-yet-started dispatch. A call already
  sent to the provider can still finish. Resume keeps the original allowance.
- A batch expires after 48 hours. An explicit refill after exhaustion or expiry
  grants eight new slots; expired unused slots are retired separately, never
  counted as completed calls. Changing or restarting the browser does not refill.
- Replacing the key or changing the bound enrollment, configuration or public
  origin stops new public work. Existing public answers remain readable.

An owner session does not grant visitors access to private history. Public
results are registered under dedicated random receipt IDs and are shareable.
The public endpoint rejects owner cookies and bearer credentials. Do not put
personal information in this demonstration. The fixed request cannot be edited
by visitors.

## Host wiring

Preserve the existing relay, state, credentials and uncertainty records. Do not
run fresh setup over a working host. Install through its existing signed update
path after review. No new VM, paid service or npm runtime dependency is needed.

The existing admission, reusable Board and workspace settings must already be
enabled. Add these explicit settings to the host's existing environment:

```text
BRIDGE_PUBLIC_TEST_ENABLED=true
BRIDGE_PUBLIC_TEST_ORIGIN=https://bmartynowicz.github.io
BRIDGE_PUBLIC_TEST_PROXY=caddy-overwrite-v1
```

The origin is exact and has no path or trailing slash. In the existing Caddy
reverse-proxy block for this relay, overwrite this header:

```caddyfile
reverse_proxy 127.0.0.1:8787 {
    header_up X-Picard-Public-Client-IP {remote_host}
}
```

Keep the host's actual upstream port; `8787` is an example. Validate and reload
the existing proxy configuration. The runtime accepts this client-IP header
only from a loopback peer and rejects lists or invalid addresses. Do not expose
the upstream listener, trust arbitrary forwarded headers or reuse a client-sent
value. Confirm the overwrite at the deployed proxy before enabling a batch.

Submission limits are enforced on the server: ten attempts per minute globally,
one accepted public request per fifteen seconds, and one accepted request per
client IP per ten minutes. The IP is hashed before it is stored in public-trial
metadata. Existing proxy logging is an independent host setting. Client storage
and CORS do not enforce the eight-call cap. A determined visitor can consume the
small shared allowance; no CAPTCHA or account creation is included.

The website permits connections only to the configured Brian relay origin.
Opening the guide makes no provider request. Checking availability and saved
answers makes no provider request. **Run one Free test** sends the fixed brief
once. A lost response preserves the receipt and offers a result read, never an
automatic resubmission. After exhaustion, the practice guide and setup flow
remain usable.

## API and retained evidence

Public requests require the exact configured Origin and omit credentials:

| Route | Purpose |
| --- | --- |
| `GET /public-test/status` | Public fixed brief, limits, remaining allowance and readiness |
| `POST /public-test/requests` | Exact `{requestId,inputSha256,approve:true}`; no prompt input |
| `GET /public-test/results/:requestId` | Only the registered public trial result |

Owner routes use the existing secure owner cookie and same-origin checks:
`GET /public-test/manage`, `GET /public-test/owner`, and POST
`/public-test/owner/approval`, `/enable`, `/disable`, `/resume`.
Activation consumes a session-bound, one-use 60-second nonce, bound to the exact
batch specification and current revision. Public authority and receipt metadata
use a separate namespace in the existing SQLite ledger. Queued work, budget
reservation and enrollment association commit atomically. Existing tables,
private grants and saved records are preserved; no migration resets them.

Cost enrollment is retained evidence, not a live billing guarantee. Activation
still requires the existing verified Free enrollment; the implementation has no
paid fallback. Keep this public feature disabled if the account's Free status
cannot be verified. A synthetic CI pass does not establish live activation or
successful model output. Report those checks separately.

## Anonymous badge interest

The separate marketing **Badge** panel offers one anonymous interest signal per
saved browser token. It is not a preorder, contact form, verified person count or
promise of hardware availability. No name, email, address, IP address or provider
input is retained by this feature. A UUID is generated only after the visitor
chooses to vote; the website remembers it locally and the relay retains only its
hash in a separate permanent ledger namespace. Proxy logging is an independent
host setting. Clearing browser storage or using another browser can vote again;
this is best-effort deduplication, not bot-proof voting.

This API is off unless `BRIDGE_BADGE_INTEREST_ENABLED=true`. It uses the existing
`BRIDGE_PUBLIC_TEST_ORIGIN` and `BRIDGE_PUBLIC_TEST_PROXY=caddy-overwrite-v1`
boundary, with exact public Origin and relay Host checks, loopback proxy access,
and no cookie or Authorization header. It does not enable or consume the public
AI trial. No provider, dispatcher, grant or request row is created.

| Route | Purpose |
| --- | --- |
| `GET /public/badge-interest` | Aggregate count and whether new votes are accepted |
| `POST /public/badge-interest` | Exact `{voteId}` UUIDv4; atomically save once |
| `POST /public/badge-interest/status` | Exact `{voteId}`; read the existing vote without adding one |

Bodies are limited to 128 bytes. New votes share a durable ten-per-minute bound;
all route operations share a sixty-per-minute in-process bound. At 4,096 retained
signals new votes stop, while existing receipts remain readable. No automatic
reset, refill, identifier rotation, IP fingerprinting or execution fallback is
provided. A lost acknowledgement offers a status check using the original token.
Browser storage must work before a vote is sent.

For release, qualify the backend and preserved records first, explicitly enable
the flag on the intended public host, and verify its aggregate read without
inflating the real count. Publish the website assets only after that succeeds.
Keep fixture votes isolated from the production ledger. The badge preview is a
CSS concept, not an image of shipped hardware; its module and materials load only
when the visitor opens Badge. Pause, hidden-tab and reduced-motion handling apply.
