# Deploy with your Cloudflare domain and Google Form

Use the updated code in this repository. Deploy this app as a **Cloudflare Worker**, with its configured D1 database and two SQLite Durable Object classes. Keep your Cloudflare account on **Workers Free**. Commands below are for Windows PowerShell.

## 1. Open the project

```powershell
Set-Location 'C:\Users\danny\Documents\GitHub\OUEMS Open Decks Manager'
node --version
npm ci
```

Node must be version 22.13 or later. It was already installed on the machine used for this project's checks. If PowerShell blocks `npm.ps1` or `npx.ps1`, use `npm.cmd` and `npx.cmd` in the commands below.

## 2. Sign into Cloudflare

```powershell
npx wrangler login
npx wrangler whoami
```

Authorize the browser prompt. Use the same Cloudflare account that contains your domain. If you belong to multiple accounts, select that account when prompted.

## 3. Create the production database

```powershell
npx wrangler d1 create ouems-open-decks
```

Copy the returned database ID. Open `wrangler.jsonc` and replace only `REPLACE_WITH_YOUR_D1_DATABASE_ID` with that ID, then save. Keep the DB binding, both Durable Object bindings and both class migrations. If you already created this database in your account, reuse its existing ID instead of creating another one.

```powershell
npx wrangler d1 migrations apply ouems-open-decks --remote
```

Accept the migration prompt. All three SQL migrations should apply. This initializes the real Cloudflare database. [D1 setup](https://developers.cloudflare.com/d1/get-started/).

## 4. Upload the app

```powershell
npm run deploy
```

If prompted to choose a `workers.dev` subdomain, choose one. Save the HTTPS URL printed at the end. The first upload also installs both SQLite Durable Object classes and the five-minute scheduled importer. Administrator setup stays disabled until you set its secret in the next step. Ordinary deployments create a fresh cloud workspace; they do not upload your local demo or local accounts.

## 5. Set the administrator setup key

In the same PowerShell window:

```powershell
$setupKey = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$setupKey | npx wrangler secret put ADMIN_SETUP_TOKEN
$setupKey | Set-Clipboard
```

This generates a random key, stores it privately in Cloudflare and copies it to your clipboard. Keep this window open until you finish creating your administrator; you can run `$setupKey | Set-Clipboard` again if something overwrites your clipboard. The key is separate from the password you will choose for your account. [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 6. Attach your existing domain

Use an unused subdomain such as `decks.yourdomain.com` so your existing main website keeps its address.

In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages → ouems-open-decks → Settings → Domains & Routes → Add → Custom Domain**. Enter your chosen subdomain and add it. Your domain must show as an active zone in this account. Cloudflare configures DNS and the HTTPS certificate for you. If that hostname already has a conflicting DNS record, choose an unused subdomain. [Custom Domain instructions](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## 7. Create your administrator

Open `https://decks.yourdomain.com/login` once its certificate is ready. Enter your name, a username, a unique password of at least 12 characters and the setup key from your clipboard. Click **Create account & sign in**.

Use the initials/account button → **Users & roles** to create the other organisers. Choose **Manager** for organisers who edit lineups or **Viewer** for read-only access. The administrator creates credentials in the app; it does not send email invitations. Use separate accounts.

## 8. Link your Form to its response Sheet

Open your Google Form → **Responses → Link to Sheets**. Create or select its response spreadsheet, then open that spreadsheet and copy its URL. The app takes the **Google Sheets response link**, not the public Form link. Keep the spreadsheet private. [Google's linking instructions](https://support.google.com/docs/answer/2917686?hl=en).

## 9. Give the app read-only Sheet access

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create/select a project, for example `OUEMS Open Decks`.
2. Open **APIs & Services → Library**, find **Google Sheets API**, and enable it.
3. Open **IAM & Admin → Service Accounts → Create service account**, named `ouems-sheet-reader`. No project role or domain-wide delegation is needed for reading the explicitly shared Sheet.
4. Open that service account → **Keys → Add key → Create new key → JSON**.
5. Download the key. Rename the downloaded file to `ouems-sheets-key.json` in your Windows Downloads folder.
6. Copy the service account's email, ending in `iam.gserviceaccount.com`.
7. Open the response Sheet → **Share**, add that email as **Viewer**, and save.

The key is a private server credential: keep it out of this repository and `public/`. If your Google organization blocks service-account key creation, its administrator must permit it or you can start with a CSV import. [Service-account credentials](https://developers.google.com/workspace/guides/create-credentials), [key creation](https://docs.cloud.google.com/iam/docs/keys-create-delete).

Upload the downloaded JSON directly to the Worker secret:

```powershell
Get-Content -Raw -LiteralPath "$env:USERPROFILE\Downloads\ouems-sheets-key.json" | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
```

The app reads the Sheet with the `spreadsheets.readonly` scope and never writes to it. The browser does not receive this key.

## 10. Create the upcoming term board

Refresh your app after adding the Google secret. Choose **Create Open Decks**, enter the term code, paste the response spreadsheet URL and choose **Preview responses & dates**.

Use `MT26` for Michaelmas 2026, `HT27` for Hilary 2027 or `TT27` for Trinity 2027. Review the matched name, genres, experience, availability and date fields. Correct the dates and add your venue before creating. Headers can reveal dates before responses exist; add/correct dates manually if the Form does not contain them clearly.

Once created, use **Check responses** for an immediate import. Scheduled checks run every five minutes, even when the app is closed. Preserve Timestamp values and the original response order; use filter views instead of sorting the source response rows in place. Imports add new submissions and preserve your app edits.

## 11. Verify before sharing with organisers

Submit a clearly labelled test response through your real Form. Click **Check responses** and confirm the DJ appears. Open two different organiser accounts in separate browser profiles or a normal/private window. Edit a DJ or move a card and confirm the other account updates. Refresh to check persistence, test sign-out, and export a backup from the administrator account.

In Cloudflare, confirm the Worker lists `DB`, `WORKSPACE` and `COLLABORATION`, the `*/5 * * * *` scheduled trigger, and both secrets. Do not add `LOCAL_DEV` to production. If login and import work, share the app address with your organisers; share the Form address with applicants.

## Future updates and terms

For code updates, run these from the project folder:

```powershell
npx wrangler d1 migrations apply ouems-open-decks --remote
npm run deploy
```

Updates preserve the existing cloud database and secrets. Back up the workspace before significant changes.

For a new term, create/link its own response Sheet, share that Sheet with the same service-account email, then create another term board in the app. No new deployment is needed just to add a term. Use the same Cloudflare account, database ID and app hostname.

If Sheet access fails, check that the Sheets API is enabled, the service account has Viewer access and the JSON secret was uploaded in full. If the app reports a migration error, apply the remote migrations to the configured database. If administrator setup is unavailable, confirm `ADMIN_SETUP_TOKEN` exists and has at least 32 characters. Free-tier assumptions and simulation results are documented in [CLOUDFLARE-AUDIT.md](CLOUDFLARE-AUDIT.md).
