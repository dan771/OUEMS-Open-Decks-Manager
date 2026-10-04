# OUEMS Open Decks Manager

A shared planning app for Oxford termly Open Decks with Administrator, Manager and Viewer accounts. Cloudflare Workers serves the website and API; D1 stores boards, accounts and saved states. Google Sheets are read only. All website fonts and artwork are served with the app.

## Try it locally

Install Node.js 22.13 or later, then run:

```sh
npm ci
npm run dev
```

Open **http://localhost:8787**. On this Windows/Codex machine, `./start.ps1` also works without Node on PATH. The local server listens on loopback only and starts with 12 fictional DJs in **MT26 · demo**. You can create a real MT26 board alongside that demo.

On first launch, create your **Administrator** account. There are no default credentials or automatic development logins. Existing local boards are preserved. Use a unique password of at least 12 characters.

Local boards persist in `.local/state.json`, accounts/hashed sessions in `.local/auth-state.json`, and saved states in `.local/snapshots-state.json`. These files are ignored by Git and never served as assets. Stop the server before `npm run demo:reset`; it backs up the previous board and keeps your accounts. Browser tests use separate files and never modify your workspace.

The local server uses Node.js and the small `ws` WebSocket library. Wrangler, Playwright and Prettier are development/deployment tools, not production services. All website fonts and artwork are served with the app.

## Using the app

1. **Create Open Decks**, enter a code such as **MT26**, **HT27** or **TT27**, and paste the response Sheet's link. A specific Sheet tab can be selected using its `gid` in the link. Alternatively upload a response CSV.
2. Preview the dates and automatic field matching. The example form generates **16 October, 29 October, 12 November and 23 November 2026**, including week labels from the answers. Headers can reveal dates even before anyone responds. Correct any field mapping or date before creating.
3. DJs arrive as cards in **Unassigned**. Their DJ name falls back to full name. Genres, labelled experience colours, vinyl interest and comment counts appear on the card. A compact dot grid shows availability: one column per night in board order, Early on top and Late below. Green means available, amber means outside the preferred half, red means unavailable and grey means not specified. Hover for the date and status. Ambiguous experience is marked for review.
4. Open a card to see its available dates and preferred halves: an available Friday with “late” becomes **Late · Friday**; “Don't mind” becomes **Early & Late**. First/second-half form answers are recognised, alongside time ranges. Edit availability or timing to update the interpretation immediately. Edit its profile and form answers; inspect the original submission; add comments; move it; duplicate it; or revert. Comments and initial answers are shared by every duplicate. Revert restores fields and answers while preserving comments and placements.
5. Each night shows its **venue name** in place of Night 01 and has collapsible **Early** and **Late** lists. Drag into either list or use Add/Move. **Plan sets** orders all assigned DJs with arrow controls, pairs two different DJs into a B2B, and edits individual durations, including a 60-minute closer. Fill night equally divides available time among sets; Use …-minute sets restores the configured default. Saved ordering and times appear directly in Early/Late, with no separate planner dropdown. A set belongs to the half in which it starts. Dropping onto an occupied set swaps a DJ placement. The × on an assigned card returns it to Unassigned; its B2B partner stays scheduled.
6. **Configure** sets the venue, start/end, default set length and optional Early/Late split. With automatic timing checked, all assigned DJs receive consecutive sets using that length; B2B pairs stay together. Uncheck it to retain custom durations. Overnight schedules are supported, and plans cannot exceed the night's end. **Add a night** creates another date with its own venue and timings. On board creation, enter the initial venue before previewing your response source.
7. **Add a DJ to this night** lets you choose Early or Late and moves an existing card there; it does not duplicate it. For another appearance, explicitly **Duplicate** a card. Use the same Add picker or the card's Move control on touch devices and with a keyboard. **Compact mode** keeps names, genres, experience labels, vinyl and comment indicators in short rows: ten DJs fit in one night without vertical scrolling at a 1280×768 desktop viewport with untimed cards. Compact mode and collapsed lists are remembered on this browser.
8. Linked Sheets are checked every five minutes, including while nobody has the app open. **Check responses** also imports immediately. Shared changes arrive immediately over an authenticated live connection. The board shows other organisers and highlights DJs being edited. After disconnecting, it reconnects automatically and checks for missed changes; a three-second fallback keeps visible pages current if live updates are unavailable. Unchanged Sheet checks do not create board revisions. CSV boards require manual CSV uploads for additional responses.
9. The download icon exports the complete workspace, including initial responses, edits, comments and placements. Keep periodic backups; the source Sheet contains only the original submissions.

Profiles also have optional **Ethnicity** and **Gender** text fields, matched from form columns or entered when adding/editing a DJ. Existing matching form answers populate these fields. Search matches names, genres, ethnicity and gender in both the board and Add picker. The **Genres / Ethnicity & gender** toolbar toggle changes the details shown on cards in either density and remembers your choice on this browser; search always checks all fields. On phones the demographic view is labelled **E/G**.

An optional **College** field is imported from matching form columns or edited on the profile. Cards with a college show a university icon; hover for its name. College is also searchable. Assigned cards have a final-confirmation tick: managers and administrators toggle it after the DJ replies, and a green tick marks confirmation. Status persists per appearance, so duplicates and B2B partners are independent. Reordering or changing times within the same night preserves it; moving to another night or back to Unassigned clears it. Viewers see the status without editing it.

On phones, the board shows one column at a time. Use the left/right buttons beside the column heading to move between Unassigned and each night. Your selected column is remembered for each board. Desktop keeps the side-by-side columns.

Managers and administrators can choose **Configure → Delete night**. Cards return to Unassigned with their set times and confirmations cleared; profiles and submitted availability remain. Administrators can choose **Account menu → Delete current board** to remove the entire selected board. Both actions require confirmation and save the complete workspace first. If saving fails, nothing is deleted. An administrator can revert through **Edit history & saved states**; restoration replaces the entire workspace. Automatic safety copies count toward the five-state limit.

### Import behaviour

Importing is append-only. Existing profiles, initial responses and placements are never changed by another import, even when somebody corrects answers in Google Sheets. Each submission is identified by its Timestamp and its occurrence within that timestamp; email/name corrections do not create duplicate cards. Keep source response rows append-only, retain their timestamps, and keep equal-timestamp responses in their original order. Deleting/reordering responses with identical timestamps breaks that fallback identity. A separate Sheet per term is recommended.

Profile fields and edited transcript answers are separate: correcting the transcript does not silently reclassify a profile you have already curated. Revert restores both. All raw questions are retained, including contact and demographic answers; access should be limited to your organisers.

Independent edits merge automatically: different DJs, different profile fields, availability values and individual transcript answers can save together. Comments append safely alongside edits. Moves check the source placement, destination set and schedule they depend on; competing moves or schedule edits are rejected. A same-field conflict keeps your draft and shows both your value and the latest saved value, with **Keep my value** and **Use latest value** choices. **Review latest DJ** explicitly discards the current form and reopens the saved profile.

Dragging, removing and confirming cards updates the board immediately and saves actions in order. You can make several moves while an earlier save is still pending. Pending cards have a gold edge, and the status reports how many changes still need saving. **Pending saves** shows the intended changes and the saved placements; retry a failed connection, explicitly apply reviewed conflicts, or discard the pending actions. Offline moves and confirmations are kept in the tab and retry on reconnect. After a reload, review the recovered queue and choose **Retry saves**. Form saves wait until queued board changes finish. A local preview does not mean the server has saved it.

Unsaved profile drafts survive reloads in the same browser tab; reopen the DJ and choose **Restore draft** or **Discard draft**. Unsent comments reopen in the composer. Failed save identifiers also survive reloads, so retrying a comment after losing its reply uses the original identifier. Tab recovery data expires after one day and is cleared on sign-out, session expiry and role changes. Recent **Activity** includes creation, edits, imports and restores, updates while open, and omits private form answers and comment bodies from viewer responses. Live connections check their health and reconnect when acknowledgements stop; presence rosters are only broadcast when they change.

## Accounts, security and history

| Role          | Access                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator | Full edits, account creation/roles, disabling accounts, password resets, history, saved states, restore, original-response revert and full export       |
| Manager       | Create boards, import, add/configure/delete nights, edit profiles/form answers/comments, duplicate/move cards, and plan sets/B2Bs; cannot delete boards |
| Viewer        | Read the lineup, availability, genres, experience and set times; search/filter and change their own password                                            |

Open the initials button in navigation for your account name, role, password change and sign out. Administrators also find **Users & roles**, **Edit history & saved states** and workspace export there. Saving an account change signs that user out on every device. The last active administrator cannot be disabled or demoted.

Permissions are checked server-side on every request, including direct API calls. Board pages, app code, data, imports, edits and exports require a session. Only login assets are public. Managers cannot fetch admin tools or restore data. Viewer responses omit private form transcripts, initial responses, full names, Sheet links and team comments.

Passwords use salted **scrypt** (N=32768, r=8, p=3, 32 MiB), one configuration in the [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Hashes and raw sessions never appear in workspace responses/exports. Eight-hour sessions use HttpOnly, SameSite=Strict cookies and Secure __Host- cookies in production. Sign-out, password/role changes and account disabling revoke sessions. Persistent account/IP counters rate limit sign-in. Mutations require same Origin and a per-session CSRF token. Production APIs require HTTPS.

**Edit history** shows who changed what, when, with before/after details. It retains up to 200 entries within a 150 KB storage budget. Each entry includes up to 30 changed paths; large values are abbreviated. History starts with this version of the app; older edits cannot be reconstructed.

Administrators can **Save current state** and **Restore** a named state of all boards, profiles, comments and placements. The latest **five** states are retained; a new one replaces the oldest. Restoring keeps accounts, roles and ongoing history. A pre-restore safety state is saved first so restoration can be undone; that copy counts toward the five-state limit. Concurrent changes are rejected. Automatic imports subsequently re-add source responses missing from a restored state.

Export downloads boards and retained history. Accounts, hashes, sessions and saved-state payloads are excluded; it is not a full authentication/database backup.

## Cloudflare hosting

Storage is designed for a small workspace. Password hashing adds deliberate computation cost; do not assume Workers Free's 10 ms CPU budget supports login/account operations. Validate your target hosting plan or use one with sufficient CPU. All static application requests now pass through the Worker to enforce login. No hosting plan is changed by this repository. See [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) and [authenticated asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/). The platform allowances below remain useful for planning:

| Resource                | Free allowance                         | Use here                               |
| ----------------------- | -------------------------------------- | -------------------------------------- |
| Static website requests | Subject to Worker invocation allowance | Login checks run before assets         |
| Worker requests         | 100,000/day                            | Board reads, edits and imports         |
| D1 reads                | 5 million rows/day                     | Version checks and changed entities    |
| D1 writes               | 100,000 rows/day                       | Changed entities, indexes and metadata |
| D1 total storage        | 5 GB                                   | Form responses and planning data       |
| Cloudflare Access       | Up to 50 users on Free                 | Your 2–3 organisers                    |

Platform allowances: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Access](https://www.cloudflare.com/sase/products/access/). Domain registration is separate. This repository has not been deployed to your Cloudflare account.

### Deploy

1. Sign into Cloudflare and create a Cloudflare project/account. Run:

   ```sh
   npx wrangler login
   npx wrangler d1 create ouems-open-decks
   ```

2. Put the returned database ID into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

3. Apply all database migrations (including `0003_collaborative_entities.sql`), configure a random administrator setup key of at least 32 characters, and deploy:

   ```sh
   npx wrangler d1 migrations apply ouems-open-decks --remote
   npx wrangler secret put ADMIN_SETUP_TOKEN
   npm run deploy
   ```

   Enter the private setup key at Wrangler's prompt. Do not put it in source/public assets. The deployment contains the five-minute Cron Trigger. No browser needs to be open for imports to run.

4. In **Workers & Pages → ouems-open-decks → Settings → Domains & Routes**, add your chosen Custom Domain, e.g. **decks.ouems.com**. The domain must be an active Cloudflare zone in your account. Cloudflare sets up the DNS record and HTTPS certificate. [Custom Domain instructions](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

5. Visit the HTTPS site, enter the setup key, and create your Administrator login. Create Manager/Viewer accounts in **Users & roles**. The key cannot create another administrator once any account exists; remove the secret after setup if desired. Keep `LOCAL_DEV` out of production. Cloudflare Access can optionally add an outer gate but does not replace app accounts or grant roles.

6. Set up read-only access to the response Sheet as below, then create your real MT26 board in the app. Test login with all organisers and make one sample edit before relying on it for a lineup.

### Private Google Sheets

Keep real response Sheets private. The app reads them on the server using Google's standard service-account flow, with the **spreadsheets.readonly** scope. It never writes to Sheets or exposes the key to the browser.

1. Create a Google Cloud project, enable the **Google Sheets API**, and create a service account. You do not need domain-wide delegation.
2. Create/download its JSON key and keep it out of Git and `public/`.
3. Share each response Sheet with the service account's `client_email` as **Viewer**.
4. Store the entire JSON key as the Worker secret:

   ```sh
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
   ```

5. Paste the key at Wrangler's prompt. Then link the Sheet in the app. A failed import displays an error and keeps every existing card.

For local private-Sheet testing, store the key at `.local/google-service-account.json`, and set the environment variable before starting:

```powershell
$env:GOOGLE_SERVICE_ACCOUNT_JSON = Get-Content -Raw -LiteralPath '.local/google-service-account.json'
./start.ps1
```

Do not share screenshots or logs containing the key. Public example Sheets work without credentials using Google's CSV export endpoint. The app does not change a Sheet's sharing settings. [Google service accounts](https://developers.google.com/identity/protocols/oauth2/service-account), [Sheets API limits](https://developers.google.com/workspace/sheets/api/limits).

## Verification and maintenance

```sh
npm test
npm run check
npm run test:browser
npx wrangler deploy --dry-run
```

Browser tests default to installed Microsoft Edge on Windows. Set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. On machines without either, run `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`.

See [TESTING.md](TESTING.md) for the acceptance scenarios. The domain tests cover dates, field classification, import deduplication, shared profiles, scheduling and revert. API tests cover authentication, cross-origin requests, save collisions, private-Sheet reads and import failures. Browser tests cover desktop and mobile workflows. `scripts/inspect-example.mjs PATH_TO_CSV` checks a real CSV and prints aggregate counts only.

D1 stores boards, profiles, card appearances and nights in separate rows. A save writes only changed entities and commits them atomically with the workspace revision. Migration `0003_collaborative_entities.sql` preserves existing data; legacy workspace JSON moves into entity rows on the first successful save. Conditional reads return no workspace payload when unchanged, and production incremental reads transfer only changed entities, including removals, with the same role filtering as initial loads. The global revision coordinates durable commits; field and placement checks determine whether an individual edit conflicts. The former 1.9 MB limit on the entire workspace is removed. Each individual entry remains capped at 1.9 MB to fit D1's [2 MB row limit](https://developers.cloudflare.com/d1/platform/limits/). Saved states are split into chunks when needed, with the latest five retained. Exports remain complete JSON backups.

The Worker uses an authenticated hibernating Durable Object for live notifications and board presence. Its binding and class migration are included in `wrangler.jsonc`; deploy that configuration together with the code. Live sockets never carry form responses, passwords or session tokens. Origin and session CSRF checks protect upgrades, account/session revocations close affected connections, and expiry is checked during presence updates. A disconnected live channel cannot roll back a durable save. Destructive board/night deletions and workspace restores deliberately retain strict workspace revision checks and safety copies.

The final deployment still needs your Cloudflare account, D1 ID, chosen hostname, administrator setup secret, suitable CPU allowance and Google service-account key. The local demo and automated tests do not require these credentials.
