> Design/review checkpoint. For current behavior, limitations and operations, start with the [documentation index](README.md). Earlier scope and verification statements below describe their checkpoint, not every later release.

# Known incomplete responses

A new invocation with a parsed, valid HTTP-200 envelope, the exact configured
model, one inert assistant message and `finish_reason:length` is a known
incomplete response. It remains consumed and stores no partial result. Its new
terminal state is `failed`, with bounded code `groq_output_incomplete` and reason
`output_incomplete`. Unknown I/O, malformed envelopes, tools, cancellations and
other finish reasons retain the existing conservative behavior. Payment/quota
stops, Free-only enrollment, exact grants and the fixed 512-token cap are unchanged.

The dispatcher first commits the terminal failure in the existing SQLite ledger.
Only that exact committed in-memory row receives unforgeable settlement identity.
The original adapter then matches the event, typed failure and its own live
reservation before releasing the shared cost stop. A copied/reloaded row, another
event, failed persistence or another adapter instance cannot settle it. Changed
stop-file identity, mode, links, size or timestamps refuses cleanup. Every
one-use event marker remains consumed; the failed job cannot be reclaimed.

A separately approved distinct grant may subsequently use the same retained Free
enrollment through the existing operator-selected path. This is not a retry,
fallback, new provider, dynamic admission endpoint or new request authority.
There is no production selector, authentication, schema or updater change.

Historical uncertain jobs and pre-existing stop files are not reclassified or
automatically acknowledged. A crash between committed failure and settlement,
or refused cleanup, can retain the stop and requires operator evidence review.
The existing reservation is never reconstructed from a hash-only historical row.

All test inputs and responses are synthetic. The new test suite covers known
truncation, strict envelope limits, sanitized failures, durable ordering,
non-reclaimable events, copied/restarted proof rejection and real POSIX marker
isolation. POSIX ownership/fsync cases must run on Linux before release.
