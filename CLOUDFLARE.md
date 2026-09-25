# Cloudflare deployment

The BH dashboard is a Cloudflare Worker. It does not need the DigitalOcean droplet. The existing Softr site remains in service until a private review passes.

## Required configuration before enabling a URL

1. Create a Cloudflare Access self-hosted application for the exact BH Worker hostname. Protect every path (`/*`) and enable one-time PIN (or the account's trusted identity provider). Do not create an Everyone, Bypass, email-domain, or login-method-wide Allow rule.
2. Create one application-specific Allow policy consisting only of exact email rules. Include `massi@20mg.co` initially. Record its Access application UUID, policy UUID, application audience tag, and team domain.
3. Set `ACCESS_APP_ID`, `ACCESS_POLICY_ID`, `ACCESS_AUD`, and `ACCESS_TEAM_DOMAIN` in `wrangler.json` vars. `ACCESS_TEAM_DOMAIN` must be the full `https://<team>.cloudflareaccess.com` issuer. `ACCESS_ACCOUNT_ID` and `ADMIN_EMAILS` are already set. `ADMIN_EMAILS` determines who can manage dashboard access, independent of manager access.
4. Create an API token scoped to **Access: Apps and Policies Read + Write** for this Cloudflare account. Store it as encrypted Worker secret `ACCESS_API_TOKEN`, never a public or build variable. Also set encrypted `AIRTABLE_TOKEN` and `CREATORSTAQ_AUTH` secrets; the latter is the full Bearer authorization value.
5. Set `workers_dev: true` only after Access and the secrets are in place. Run `npm run deploy`, then `npm run check:access`. Visit the Worker URL signed out: it should show Cloudflare Access. After one-time PIN login, the dashboard should open only for emails in the exact Allow policy.

The Worker verifies the signed Access JWT and checks the dedicated Access policy email list. If the policy API is unavailable, it denies the request. Managers can be invited/deactivated at `/account/users` by an admin. The dashboard changes the exact email list in Cloudflare; after adding an email, share the dashboard URL. Cloudflare handles the login code. Removing an email takes up to 15 seconds per Worker isolate to take effect due to the short policy cache. Keep the Access application limited to the exact BH hostname. No custom `/login` bypass is needed.

Before retiring Softr, compare actual Airtable, Creatorstaq Revenue and P&L values for matching date ranges, and check all write flows. The scraper is separate and unchanged.

## Page permissions (pending Cloudflare D1 provisioning)

The Users screen now supports per-manager page access. Administrator emails in
`ADMIN_EMAILS` always see every page. New managers default to Overview,
Conversions, Staff, Pay & Hours, and Expenses; Profit & Loss and Revenue start
blocked. Page routes, the Revenue API, and Airtable data routes enforce these
permissions on the server. The Staff page reads the existing BH Airtable Staff
table (`app0OseEBbAAAU6xt` / `tblbHePRmAbfWwXBU`), so no export/import or
record copy is needed. Do not migrate historical staff records into a second
store; Softr and this dashboard read the same source.

To activate editable grants, create a Cloudflare D1 database in the same
account, bind it to this Worker as `PERMISSIONS_DB` in `wrangler.json`, then
apply `migrations/0001_dashboard_permissions.sql` remotely before deploying.
The binding needs the actual database ID returned by Cloudflare. Until that
binding exists, the safe default grants above still apply and the Users page
returns an explicit 503 if someone tries to change a manager's page access.
