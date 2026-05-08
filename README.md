# Teamtailor → Webflow Sync

Cloudflare Worker that keeps Reqruitz job listings in Webflow CMS in sync with Teamtailor ATS — including multi-locale support (EN, FI, SV).

---

## Architecture

```
Teamtailor ATS
    │
    ├─ Webhooks (job.created / job.updated / job.destroyed)
    │       │
    │       └──► Cloudflare Worker (teamtailor-webflow-sync)
    │                   │
    └─ Cron (03:00 UTC) ┘
                        │
                        ▼
                  Webflow CMS
              (EN + FI + SV locales)
```

The worker has two sync paths:

| Path | Trigger | Behaviour |
|------|---------|-----------|
| **Webhook** | `POST /` from Teamtailor | Syncs a single job immediately |
| **Reconcile** | Cron (nightly) or `GET /reconcile?key=…` | Full sync of all jobs + cleanup of orphans |

---

## Files

```
sync-worker/
  src/
    index.js        — Worker entry: HTTP router, cron handler, reconcileAllJobs()
    sync.js         — Core syncJob() and deleteJob() logic
    teamtailor.js   — TeamTailor API v1 client (read + write)
    webflow.js      — Webflow CMS API v2 client
    utils.js        — sleep(), verifySignature()
  wrangler.toml     — Worker config, cron schedule, bindings
  .dev.vars         — Local secrets (not committed)

webflow-scripts/
  list-filter.js    — Client-side filter/pagination script embedded in Webflow
```

---

## Sync Flow

### Webhook (single job)

1. Teamtailor sends `job.created`, `job.updated`, or `job.destroyed` to `POST /`.
2. Webhook signature is verified via `TEAMTAILOR_WEBHOOK_SECRET`.
3. For create/update: `syncJob()` is called via `ctx.waitUntil`.
4. For destroy: `deleteJob()` archives the Webflow item.

### syncJob()

1. Fetch job from Teamtailor (with `locations,picked-questions.question` includes).
2. Guard: if `human-status !== 'published'` (Hidden, Closed, etc.) → archive from Webflow and return.
3. Resolve location name(s) and questions JSON from included data.
4. Build `fieldData` map (name, title, pitch, body, locations, remote-status, questions-json, etc.).
5. **Primary locale (EN):** find existing Webflow item by `job-id` field.
   - If found and up-to-date (same timestamp, internal flag, questions, locations, not archived, not draft) → skip update.
   - Otherwise → `PATCH` the item.
   - If not found → `POST` create.
6. **Secondary locales (FI + SV):** always `PATCH` with the same `fieldData` via `?locale={cmsLocaleId}` — no skip check, ensuring they stay in sync even if the primary was already up-to-date.
7. `POST /collections/{id}/items/publish` — publishes all locales in one call.

### Reconcile (full sync)

1. Fetch all publicly visible + internal jobs from Teamtailor (`filter[feed]=public` and `filter[feed]=internal`).
2. Fetch all Webflow items once; build a `job-id → item` map.
3. For each Teamtailor job: resolve location + questions from the shared `included` array, then call `syncJob()`.
4. Sleep 250 ms between jobs (rate-limit politeness).
5. **Cleanup:** any Webflow item with a `job-id` not present in the current Teamtailor list → archive (if not already archived).

---

## Locales

All content is identical across locales — the client manages language at the Teamtailor level, not per-CMS-item.

| Locale | Webflow CMS Locale ID |
|--------|-----------------------|
| English (primary) | `662123573a11a37d76a9f412` |
| Finnish | `665cb20748cb746631bffd66` |
| Swedish | `69b282e8dac0c1bbda31232c` |

The `SECONDARY_LOCALES` constant in `sync.js` holds the FI and SV IDs. Primary (EN) uses the default collection endpoint.

---

## Environment Variables / Secrets

Set via `wrangler secret put <NAME>` (production) or `.dev.vars` (local dev).

| Variable | Purpose |
|----------|---------|
| `TEAMTAILOR_API_KEY` | Teamtailor read API key |
| `TEAMTAILOR_WRITE_API_KEY` | Teamtailor write API key (applications, candidates) |
| `WEBFLOW_API_TOKEN` | Webflow API token |
| `WEBFLOW_COLLECTION_ID` | Webflow CMS collection ID for jobs |
| `TEAMTAILOR_WEBHOOK_SECRET` | Shared secret for webhook signature verification |

---

## Deployment

```bash
cd sync-worker
npx wrangler deploy
```

Cron schedule is defined in `wrangler.toml` (`0 3 * * *` = 03:00 UTC daily).

---

## Manual Reconcile

Trigger a full resync from the command line:

```bash
curl "https://teamtailor-webflow-sync.<account>.workers.dev/reconcile?key=<TEAMTAILOR_API_KEY>"
```

The request blocks until all jobs are synced and returns `200 Full Reconciliation Complete` when done. Useful after bulk changes in Teamtailor or to fix locale gaps.

---

## Key Design Decisions

**`filter[feed]=public` not `filter[status]=published`**
Teamtailor's `status=published` includes Hidden jobs (visible in ATS but not on the careers page). `feed=public` returns only jobs that are publicly visible — which is what should appear in Webflow.

**`human-status` guard on webhook path**
If a job transitions to Hidden/Closed via webhook, the worker archives it from Webflow immediately, without waiting for the nightly cron.

**Always write secondary locales**
Secondary locales (FI, SV) are always written regardless of whether the primary locale changed. This guarantees locale parity even when only the primary was behind.

**`await` not `ctx.waitUntil` for HTTP reconcile**
The HTTP `/reconcile` endpoint uses `await reconcileAllJobs(env)` so the full sync runs within the request lifecycle. `ctx.waitUntil` on HTTP-triggered workers has a strict CPU budget that would cut off after ~7 jobs when 3 locale API calls are made per job. The nightly cron uses `ctx.waitUntil` (higher budget) which is fine.

**Publish covers all locales**
A single `POST /collections/{id}/items/publish` call with the item ID publishes the primary and all secondary locales simultaneously.
