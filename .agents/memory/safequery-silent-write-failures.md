---
name: safeQuery silent write failures
description: storage.setPageSectionSettings (and similar write paths built on safeQuery) can report success even when the underlying YDB write timed out or failed.
---

`safeQuery` in `server/storage.ts` swallows errors (including YDB timeouts) and returns `null` instead of throwing. Callers like `setPageSectionSettings` don't check for a `null`/falsy return — they unconditionally invalidate the relevant cache and respond `{success:true}` to the client, even when the actual write never landed in YDB.

**Why:** Observed directly — a page-settings save endpoint returned `{success:true}` while the write had silently failed due to a transient YDB timeout; only a raw YDB check revealed the field was missing. A retry of the same call succeeded normally.

**How to apply:** Don't trust `{success:true}` alone as proof of persistence for admin write endpoints built on this pattern — if a save seems to not "stick" on the frontend, retry once and/or verify via the actual GET endpoint (allowing for normal cache staleness, see `SimpleCache` TTL/staleUntil semantics) before assuming a real bug. If fixing this class of endpoints, make `setPageSectionSettings`-style writers check `safeQuery`'s return and propagate failure instead of reporting success blindly.
