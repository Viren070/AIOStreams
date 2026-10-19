# Addon timeout accounting

Issue [#1150](https://github.com/Viren070/AIOStreams/issues/1150) showed Newznab's four-second execution timeout expiring while shared metadata was still resolving, before its HTTP search began.

On stream-cache misses, the wrapper prepares metadata for supported local built-ins before creating their execution deadlines. External addons remain immediate and fetcher grouping/conditions are unchanged. Direct Library item IDs bypass preparation. The actual local route configuration supplies metadata credentials, including manifest overrides.

Preparation has a separate ceiling using the existing maximum HTTP timeout (default 50 seconds), including the initial anime-database lookup. Five seconds of preparation plus a four-second execution budget can take about nine seconds plus setup and processing. This is not a four-second overall Stremio response guarantee; client and proxy deadlines still apply.

A reference-counted lease retains a cloned metadata snapshot through the built-in HTTP hop until resource work settles, including intentional background work. Effective metadata credentials are part of the sharing key. Metadata lock lifetimes include preparation; delayed lock cleanup cannot delete a replacement lock. Existing stale stream-cache fallback remains available when preparation fails.

TorBox's ID-only HTTP search starts concurrently with preparation. Its execution deadline starts after preparation, while earlier success/failure returns immediately. Coalesced callers retain their own deadlines, and late preparation leases are released.

## Limits

Downstream cancellation is out of scope. Outer cancellation/timeouts can still leave built-in searches or shared metadata work running; intentional background cache warming is unchanged. Leases and metadata single-flight are process-local, so INTERNAL_URL must reach the same process. This change does not add Cinemeta caching, change metadata merge priorities, or introduce a new end-to-end response deadline.

## Regression tests

Run from packages/core:

```sh
pnpm exec tsx --test --test-force-exit --import ./test/setup.ts src/metadata/preparation.test.ts src/utils/distributed-lock.test.ts
```

Tests mock providers and cover the five-second metadata/four-second execution case, near-budget HTTP execution, independent fetching, parallel/sequential group behavior, foreground/background deadlines, cache hits and stale fallback, anime enrichment, credential isolation, shared leases and lifecycle cleanup.
