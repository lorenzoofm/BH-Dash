# Cloudflare deployment

The BH dashboard is a Cloudflare Worker. It does not need the DigitalOcean droplet. The existing Softr site remains in service until a private review passes.

## Required configuration before enabling a URL

Sign-in is Clerk (Google only). Cloudflare Access is no longer used; delete the Access application for this hostname once Clerk sign-in works, or visitors get two logins.

1. In Clerk, create an application. Under **User & authentication**, enable **Google** only and turn off email, phone and username sign-in. Set sign-up mode to **Restricted** so only people you add can create accounts.
2. Under **Sessions → Customize session token**, add the claim `{"email": "{{user.primary_email_address}}"}`. The Worker rejects sessions without it.
3. Copy the **publishable key** (`pk_test_…` or `pk_live_…`) into `CLERK_PUBLISHABLE_KEY` in `wrangler.json` vars. It is public; no Clerk secret key is needed, because sessions are verified against Clerk's published keys.
4. A Clerk **production** instance (`pk_live_`) needs a domain you control (for example `bh.20mg.co`) with Clerk's DNS records; it cannot run on `workers.dev`. A development instance (`pk_test_`) works on `workers.dev` for review but shows a development banner.
5. Apply the permissions migration: `npx wrangler d1 migrations apply bh-dashboard-permissions --remote`. It creates the `managers` table and keeps everyone who already had page permissions.
6. Run `npm run deploy`, then `npm run check:clerk`. Signed out, the Worker URL should show the 20MG sign-in page; a Google account not on the manager list sees "Not approved yet".

The Worker verifies the Clerk session JWT (issuer, expiry, the `azp` origin and the email claim), then checks `ADMIN_EMAILS` and the D1 `managers` table, cached for 30 seconds per isolate. Admins add and remove managers at `/account/users`; removing someone takes up to 30 seconds per isolate, and their Clerk session token expires within a minute. Data requests with an expired token get a 401, which the browser answers by refreshing the Clerk session and retrying once.

## Page permissions

The Users screen now supports per-manager page access. Administrator emails in
`ADMIN_EMAILS` always see every page. New managers default to Overview,
Conversions, Staff, Pay & Hours, and Expenses; Profit & Loss and Revenue start
blocked. Page routes, the Revenue API, and Airtable data routes enforce these
permissions on the server. The Staff page reads the existing BH Airtable Staff
table (`app0OseEBbAAAU6xt` / `tblbHePRmAbfWwXBU`), so no export/import or
record copy is needed. Do not migrate historical staff records into a second
store; Softr and this dashboard read the same source.

The `bh-dashboard-permissions` D1 database and its table were created in the
Massi Cloudflare account. `wrangler.json` binds it as `PERMISSIONS_DB`. Deploy
the Worker to activate the page controls. If the binding is unavailable, the
safe default grants above still apply and edits return an explicit 503.
