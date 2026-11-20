# Cinemeta caching and reliability

Cinemeta's variable response times and gateway failures can delay metadata-dependent searches. Raw responses now use the existing SQL cache table under cinemeta:v2, independent of Redis. Persist the configured SQLite/Postgres database as usual. No schema migration, service, dependency, provider toggle, or metadata merge-priority change is required.

Keys use media type and IMDb ID, so requests for different episodes share one fetch per process. SQL reads are coalesced too. Provider responses keep the five-second HTTP timeout and are validated before caching; HTTP error bodies are released. Callers receive independent snapshots, and background refresh only changes future reads.

| Content | Refresh on access after | Fresh through | Stale while revalidating through | Stale if error through |
| --- | --- | --- | --- | --- |
| Ongoing/unknown series | 45 minutes | 1 hour | 1 day | 7 days |
| Completed series/movies | 6 days | 7 days | 14 days | 30 days |

Ages are measured from the last successful fetch. Explicit ongoing status, scheduled videos, and future episodes prevent a closed year range from making an active series look complete. Refresh is demand-driven, with four background refreshes per process and no queue. Persisted exponential failure backoff runs from one minute to one hour; failures never extend last-good age.

Stale episode data requires that exact season/episode with a valid, already-aired release date. Missing, future, and undated stale episodes require refresh or existing alternative-provider fallback. Newly fetched responses missing an episode are reused for at most one minute to avoid repeated requests for unusual numbering. Hinted anime shows retain fallback to the anime entry's own IMDb record. Existing episode resolution, season counts, aliases, release dates, and title merging remain unchanged.

## Limits

SQL persistence is best effort under the existing cache write/requeue behavior. Existing row caps, LRU eviction, expiration maintenance and maximum value size apply; failed writes, eviction or oversized responses can produce cold misses. No old timestamp-free Cinemeta cache entries are migrated. Background caps/single-flight are process-local; multiple workers can duplicate requests or race writes. Stale data cannot reflect provider corrections made after its last successful fetch.

Cold searches still wait for required metadata; this change does not separate addon execution timeouts or return the first provider result early. The timeout-accounting fix is an independent change. Missing episode metadata during an outage may leave alternative providers whose numbering differs; stale fallback never invents an episode match.

## Regression tests

Run from packages/core:

```sh
pnpm exec tsx --test --test-force-exit --import ./test/setup.ts src/metadata/cinemeta-cache.test.ts src/metadata/cinemeta.integration.test.ts
```

Tests use isolated SQLite databases and mocked HTTP, including a separate-process cache read. They cover persistence, deduplication, refresh policies, slow responses/504s, stale/error/backoff behavior, bounded background slots, SQL expiry/storage faults, cold alternatives, Goosebumps (1995) split episodes/season counts, continuous anime numbering, specials and future/missing episodes. The reduced Goosebumps fixture preserves a public Cinemeta snapshot from 2026-10-19; it does not assert all providers use identical numbering.
