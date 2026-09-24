# 20MG BH Operations

Standalone manager-only dashboard backed by the existing BH Airtable base and a server-side Creatorstaq connection. The first hosted review is owner-private. It does not replace or publish the existing Softr site.

This repository contains the custom dashboard source, including Overview, Conversions, Staff, Pay & Hours, P&L, Expenses and Revenue. Publishing this repository does **not** make the dashboard site live or publish its Airtable records. The Cloudflare Worker URL remains disabled until Cloudflare Access is configured and the route is deliberately enabled. See [CLOUDFLARE.md](CLOUDFLARE.md).

## Local setup

Use Node 22.13 or newer. Run `npm run install:ci`, then the checks below and `npm run build`. Keep credentials in ignored `.env.local` for local development; do not commit them. A Cloudflare deployment needs encrypted Worker secrets `AIRTABLE_TOKEN` and `CREATORSTAQ_AUTH`, plus real Access issuer/audience settings. The account ID, Airtable base/table IDs and example email addresses in this source are configuration identifiers, not credentials; forks must use their own values and data.

## Runtime configuration

AIRTABLE_TOKEN and CREATORSTAQ_AUTH are secrets. CREATORSTAQ_AUTH is the full Bearer authorization value. Cloudflare Access policy holds the exact manager email allowlist; ADMIN_EMAILS is the dashboard-admin allowlist; DASHBOARD_KIND=bh; OTHER_DASHBOARD_URL links to Content Studio. Use ignored .env.local for local preview. Local loopback mock authentication is excluded from the production server.

## Checks

Run `node scripts/check-core.cjs` and `node scripts/check-finance.cjs`. The Sites build helper creates the production output.

## Preserved business rules

Conversions are weekly totals dated to Monday. Daily average is the weekly total divided by seven. A crossing week belongs to the month containing its Monday. Daily, weekly and monthly expectations are independently nullable, with no assumed target. Paid subscriber figures per VA remain proportional estimates for a model/week, not direct attribution.

P&L separates managed models with assigned expenses/wages from chatting agency income. It deducts paid operational expenses and all staff wages, including unpaid wages, and handles model payouts separately. Shared expenses are split evenly. Airtable percentage fields are converted between fractional storage and UI percentages.

Known existing limitation: wages follow a staff member's current model assignment, so later reassignment can change historical model allocation. This has not been silently redesigned.

## Release blocker

The actual Creatorstaq API key is not yet supplied. The previous Softr resource exposes a masked key and a literal token placeholder. Revenue and P&L must be verified against real ranged/monthly API results before cutover; missing revenue is shown as unavailable, never a fabricated zero. All Airtable expense/payroll and weekly calculation checks have passed.

Airtable lacks cross-client atomic conditional writes. Pre-write conflict and duplicate checks are enforced, but external clients can still race; coordinate writes during the review period.
