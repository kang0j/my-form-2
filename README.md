# AN-FORM

Anonymous surveys and polls for small groups (up to ~30 people).

A voter's identity (`participants`) and their answers (`submissions`/`answers`) are
never linked anywhere in the database. There is no shared key, no precise submission
timestamp, and no sequential ID. Identities are stored only as HMAC hashes.

Built on Cloudflare Workers + D1, with a React/Vite front end.

## Development

    npm install
    cp .dev.vars.example .dev.vars   # once; fill in local ADMIN_AUTH_MODE and HMAC_SECRET
    npm run dev:api   # Worker (127.0.0.1:8787)
    npm run dev       # UI (5173); /api is proxied to the Worker

Both servers must run at the same time. Locally, `ADMIN_AUTH_MODE=insecure-local` in
`.dev.vars` opens `/admin` without authentication. **This value is for local use only
and must never be used in production.** Without `.dev.vars`, `wrangler dev` falls back
to `ADMIN_AUTH_MODE: "access"` and every admin API call returns 500.

## Tests

    npm test          # server (real local D1 via @cloudflare/vitest-pool-workers) + client (jsdom)
    npx tsc --noEmit
    npm run build

## Deployment

    npx wrangler d1 migrations apply an-form --remote
    npm run deploy

The site lives at one address, `anform.jaehyun.dev` (`routes` with `custom_domain` in
`wrangler.jsonc`). The workers.dev address is turned off: two doors into the same app
means two Access applications to cover, and the day one is forgotten the admin UI is
open through it.

Set `HMAC_SECRET` with `wrangler secret put`. Changing it makes previously stored
hashes incomparable with newly computed ones, so **rotate it only when no survey is in
progress**.

`/admin` and `/api/admin` are protected by Cloudflare Access. Until
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc` hold real Access application
values, the admin API **rejects every request with a 500** even when `ADMIN_AUTH_MODE`
is `"access"`. This is a fail-closed design — missing or unreadable configuration locks
the door rather than opening it. It is intended behavior, not a bug. The admin UI stays
locked until you fill in both values and redeploy.

## Operational notes

- **Impersonation cannot be undone by deleting a single vote.** The roster and the
  answers are unlinked by design. The remedy is "Duplicate survey" in the admin UI and
  running it again. A duplicate inherits the allowlist and starts with an empty roster.
- **The allowlist** is edited under the "Response permissions" tab. Paste one person per
  line with a name and a student ID; commas, tabs, or spaces all work as separators. An
  empty list lets anyone with the link take part (the default). The list can be edited
  while a survey is running and after it closes.
- **Who has not submitted yet** is visible under the "Participants" tab before closing.
  Submissions received before the list was pasted are marked "not on the list" there.
- The allowlist only filters people; it does not change how votes are counted. Someone
  on the list submitting twice is still detected, not blocked.
- Admin tabs: Edit / Results / Participants / Response permissions / Audit. Who did and
  did not submit lives only in **Participants**; **Audit** covers anomalies only
  (duplicate identity, duplicate device, same network).
- **Results open only after a survey closes — for admins too.** Reading the tally twice
  while a survey is running would make the difference a single incoming vote, and the
  participants view would name who arrived in between with a timestamp. Omitting a
  timestamp column from `answers` (`0001_init.sql`) prevents exactly that correlation,
  and polling a live API would restore it. The answers CSV is under the same lock.
- Each survey chooses who sees results after closing: admins only, or everyone.
- Submitting again under the same identity shows a notice on the completion screen;
  revisiting from the same browser shows "You already submitted" with an
  [Submit again] button.
- Answers and participants can each be downloaded as CSV (the answers CSV only after
  closing).

## Account setup (manual steps)

These require Cloudflare account authentication, so this repository's automation cannot
do them. Run them in order.

1. **Create the D1 database**

       npx wrangler d1 create an-form

   Paste the printed `database_id` into `d1_databases[0].database_id` in
   `wrangler.jsonc`. Wrangler offers to write the snippet for you; if you accept it,
   delete the extra entry it appends — the code reaches this database through the `DB`
   binding only, so a second binding for the same database ships unused.

2. **Apply migrations to the remote database**

       npx wrangler d1 migrations apply an-form --remote

3. **Register the `HMAC_SECRET` secret**

       openssl rand -hex 32 | npx wrangler secret put HMAC_SECRET

4. **Deploy**

       npm run deploy

5. **Protect `/admin` and `/api/admin` with Cloudflare Access**

   In the Zero Trust dashboard (Access → Applications → Add an application →
   Self-hosted):

   1. Create an application with `anform.jaehyun.dev` as the application domain and
      `admin` as the path. Create a second one the same way for `api/admin`. Never put
      one on `/s/*` — voters have no account to sign in with.
   2. Policy: action `Allow`, and include your own email address (or email domain).
   3. Copy the application's **Application Audience (AUD) Tag**.
   4. Fill in `vars.ACCESS_TEAM_DOMAIN` (your team domain, e.g.
      `<team>.cloudflareaccess.com`) and `vars.ACCESS_AUD` (the AUD tag you copied) in
      `wrangler.jsonc`.
   5. Deploy again.

          npm run deploy

   Until these values are set and redeployed, the fail-closed behavior described under
   "Deployment" keeps the admin UI locked.

6. **Verify by hand on the deployed site**

   1. Open `/admin` and confirm the Access login appears.
   2. Create a survey with one question of each of the four types, save it, and open it.
   3. In a private window, open `/s/<surveyId>` and submit.
   4. Close the survey (results are closed even to admins before that) and check the
      tally under the results tab.
   5. Reopen it, submit again with the same name and student ID, and confirm both the
      notice on the completion screen and the duplicate identity entry in the audit tab.
   6. Revisit from the same window and confirm "You already submitted" and the
      [Submit again] button.
   7. Download the answers CSV and the roster CSV and confirm Korean text is not
      mangled in Excel.
