# Cloudflare capacity and cost audit

Checked on **4 October 2026**.

**Result:** the app supports 2–3 simultaneous organisers. After the changes in this audit, normal small-team use is suitable for Cloudflare Workers Free. A zero-cost deployment uses the free `workers.dev` hostname, D1 and two SQLite-backed Durable Object classes. Keep the account on Workers Free; a custom domain registration is separate.

This is a local runtime verification and a usage model, not a production bill or a guarantee for unlimited traffic. The repository still has a placeholder D1 database ID, so the deployed account, account-wide remaining quotas, HTTPS deployment and real private Google Sheet have not been verified.

## Changes made

- Moved API processing and scheduled imports into `WorkspaceService`. This keeps expensive password hashing and workspace processing out of the public Worker's 10 ms CPU allowance. SQLite-backed Durable Objects are available on Free and have a default 30-second CPU allowance. [Cloudflare limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
- Preserved scrypt's existing parameters and password hashes. Account operations queue so simultaneous logins cannot run multiple 32 MiB hashes in the same 128 MiB isolate.
- Routed live upgrades directly into the separate hibernating `CollaborationHub`. A WebSocket forwarded through the workspace object could keep that object active; the workspace now handles only finite requests.
- Completed the live socket close handshake explicitly and passed close information from the Node development server. Reconnecting now removes the old presence entry. The call is also safe on runtimes that automatically acknowledge closes. [WebSocket close handling](https://developers.cloudflare.com/durable-objects/api/base/).
- Added a three-account Cloudflare stress check, gateway/security regressions and a repeatable Worker conflict check.

D1 remains the database, and existing permissions, CSRF checks, session revocation, conflict protection, imports and saved states remain in use. The new WORKSPACE binding and `workspace-v1` class migration must deploy with the updated code. There is no password reset or new D1 migration.

## Simulation evidence

The tests used fictional responses, isolated local state and Cloudflare's real local Worker/D1/Durable Object runtime. They did not modify your real workspace or deploy to Cloudflare.

| Check                            | Result                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unit/API/security/SQLite tests   | 72 passed                                                                                      |
| Desktop/mobile/browser workflows | All 17 passed in the final complete run; four role/security checks also passed separately      |
| Worker and D1 smoke check        | Login, persistent saves, imports, B2B plans, snapshots, restore and cron passed                |
| Collaboration runtime check      | Live notifications, incremental reads, queued moves, retry deduplication and revocation passed |
| Three-account stress check       | One administrator and two managers, each with a separate login/session                         |
| Dataset                          | 200 DJs on one board                                                                           |
| Independent simultaneous edits   | All 60 edits retained across 20 rounds                                                         |
| Competing edits to one field     | One saved; two returned explicit conflicts                                                     |
| Concurrent comments and retries  | Three comments retained; retries created no duplicates                                         |
| Presence                         | Three distinct account IDs                                                                     |
| Missed changes after disconnect  | One changed profile returned in the catch-up patch                                             |
| Sign-out                         | Signed-out account disconnected and received 401; other accounts stayed authorized             |
| Production deployment dry run    | Passed; bundle approximately 94 KiB before compression                                         |

Successful edits in the first completed 200-DJ stress run had a local median wall time of **404 ms** and a 95th percentile of **558 ms**. The final repeat, alongside the full browser suite, measured **561 ms** and **1,075 ms** respectively. Both include simultaneous requests and local database I/O. These are not production CPU measurements. Wrangler does not enforce production free-plan quotas. One browser run lost a browser session during a role test; the four role/security scenarios passed independently, and the final complete suite passed all 17 tests.

## Free-tier usage model

The following request counts are estimates, not measured account analytics. Assume three users, one open tab each, eight hours of visible use daily, 200 DJs total, 1,800 saves daily, and one linked Sheet checked every five minutes. Allow up to three client refreshes per save, 30 asset/page requests per user and 288 scheduled invocations per day. That is substantially more saving than a typical small organiser team needs.

| Resource                                            | Estimated daily use                                      | Free allowance                              |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Worker invocations with live updates                | About 10,500                                             | 100,000/day                                 |
| Worker invocations with continuous fallback polling | About 36,400                                             | 100,000/day                                 |
| Durable Object requests with live updates           | About 12,500                                             | 100,000/day                                 |
| D1 reads, with retry/refresh headroom               | About 2.2 million                                        | 5 million rows/day                          |
| D1 writes, with index/retry headroom                | Under 40,000                                             | 100,000 rows/day                            |
| D1 storage                                          | Depends on response sizes and five saved states          | 500 MB for this database; 5 GB account-wide |
| Durable Object duration                             | Depends on processing/I/O time; idle live hub hibernates | 13,000 GB-s/day                             |

Request arithmetic: `3 × 28,800 / 30 + 3 × 1,800 + 1,800 + 90 + 288 = 10,458`. With a three-second fallback, replace the first term by `3 × 28,800 / 3`, giving `36,378`. Durable Object requests additionally allow one publish per save and 25-second presence messages at Cloudflare's 20:1 incoming-message billing ratio. Account operations and reconnections add a small number of requests.

Read headroom allows roughly 1,000 row reads per save including two commit attempts, plus 400,000 background/import/refresh reads. Write headroom allows 20 writes per save including metadata/index work, plus 4,000 import/account/snapshot writes. These bounds are a planning approximation for this dataset. Large retained boards, tombstones, bulk imports, extra tabs or repeated commit contention increase usage; production D1 `rows_read` and `rows_written` metrics are the authoritative counts.

Duration is shared across simultaneous requests to an object. At an illustrative one second per API request, 10,500 requests use about 1,344 GB-s for the workspace object, plus the live hub and imports. This is an assumption, not a measured production duration total. The code keeps live connections hibernatable and avoids long-lived connections through WorkspaceService. [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Free quota exhaustion causes Cloudflare operations to fail rather than silently upgrading this project. Limits are shared with other applications in the same account. A paid Workers account has different billing behavior. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## External services and remaining deployment checks

There are no paid AI, email, font, analytics or hosting services required by the app. CSV boards need only Cloudflare. Private Google Sheets use a read-only service account; each ordinary check uses two Sheets reads, well below the standard 60-per-minute service-account quota for a single board. Google lists standard Sheets API use at no additional cost, with future charges planned for exceeding quota limits. [Google Sheets usage and pricing](https://developers.google.com/workspace/sheets/api/limits).

Before relying on a live lineup, configure the D1 ID, apply existing database migrations, deploy both SQLite Durable Object classes, set the administrator setup secret and optionally the private-Sheet key. Use the `workers.dev` URL, verify the account is on Workers Free, sign in with all three real accounts, make an edit/import and check the dashboard's CPU, duration and D1 metrics. Account configuration and real Google credentials are required for those live checks; the local simulation cannot establish them.

## Reproduce

Use a fresh isolated local persistence directory to keep synthetic stress data separate from ordinary development data:

```sh
node scripts/prepare-worker-test.mjs
npx wrangler d1 migrations apply ouems-open-decks --local --config wrangler.local.json --persist-to .wrangler/free-audit
npx wrangler dev --config wrangler.local.json --port 8791 --persist-to .wrangler/free-audit
```

In another terminal:

```sh
node scripts/check-worker.mjs
node scripts/check-collaboration-worker.mjs
npm run check:capacity
npm test
npm run check
npm run test:browser
npx wrangler deploy --dry-run
```

The capacity script is deliberately fixed to loopback. It creates test accounts and a synthetic MT48 board in that local database; it must not be pointed at a real workspace.
