# BH dashboard API and data connections

This document describes the **implemented code in this repository**, not an official Airtable or Creatorstaq specification. The deployed dashboard uses Airtable for editable records and Creatorstaq for revenue. Credentials are encrypted Worker secrets and are not in the repository; source alone cannot reproduce the live data.

## Where the implementation lives

| Concern | Source |
| --- | --- |
| Dashboard route handlers | `app/api/session/route.ts`, `app/api/users/route.ts`, `app/api/data/[key]/route.ts`, `app/api/revenue/route.ts` |
| Airtable base, table, field and write allowlists | `lib/data-config.json` |
| Airtable transport, caching and response mapping | `lib/data-server.ts` |
| Validation, required and unique fields | `lib/data-rules.ts` |
| Permitted Creatorstaq requests | `lib/revenue-request.ts` |
| Client calls | `lib/datasource.ts` and `app/blocks/*.tsx` |
| Cloudflare Access verification and policy management | `lib/cloudflare-access.ts`, `lib/access-policy.ts`, `worker.ts`, `app/auth.ts` |
| Worker configuration and deployment | `wrangler.json`, `CLOUDFLARE.md` |

## Configuration and access

| Variable | Role | Where to set it |
| --- | --- | --- |
| `AIRTABLE_TOKEN` | Airtable personal access token with read/write access to the configured BH base | Ignored local `.env.local` or encrypted Cloudflare Worker secret |
| `CREATORSTAQ_AUTH` | Complete Creatorstaq `Authorization` header value, including `Bearer ` if that is how the issued token is used | Ignored local `.env.local` or encrypted Worker secret |
| `ACCESS_TEAM_DOMAIN` | HTTPS Cloudflare Access issuer, for example `https://your-team.cloudflareaccess.com` | Worker configuration; must match the Access application |
| `ACCESS_AUD` | Cloudflare Access application audience | Worker configuration; must match the Access application |
| `ACCESS_ACCOUNT_ID`, `ACCESS_APP_ID`, `ACCESS_POLICY_ID` | Exact Cloudflare account, application and manager policy IDs | Worker configuration |
| `ACCESS_API_TOKEN` | Cloudflare API token with Access Apps and Policies read/write for the account; used to read and edit the exact-email manager policy | Encrypted Worker secret |
| `ADMIN_EMAILS` | Comma-separated dashboard administrator emails, separate from manager access | Worker configuration |
| `DASHBOARD_KIND` | `bh` | Worker configuration |
| `OTHER_DASHBOARD_URL` | Link to Content Studio | Worker configuration |

`wrangler.json` has `workers_dev: true` and contains Access identifiers. `npm run deploy` builds and deploys the Worker but does not supply secrets. The current deployment has Airtable and Creatorstaq secrets configured. Do not put secrets in source, GitHub Actions logs, browser code, or issue reports. See [CLOUDFLARE.md](CLOUDFLARE.md) for the deployment boundary.

Production pages and API routes require a valid Cloudflare Access JWT for an email in the exact-email Access policy. The Worker verifies the issuer, audience, signature and claims, then reads the configured policy. It serves `/_next/static/` build assets without this app-level JWT check; those assets must contain no account data. Admin actions also require an email in `ADMIN_EMAILS`. Writes require an `Origin` header equal to the dashboard origin. This is a **session API for the dashboard**, not a public token-based integration API. Use the signed-in browser for the examples below; do not expose Airtable, Creatorstaq or Cloudflare API tokens to browser JavaScript.

## Dashboard routes

All responses are JSON. Error responses have `{ "error": "message" }`. Data and revenue responses set `Cache-Control: private, no-store`; successful upstream reads also have a short server-side cache.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/session` | GET | Current signed-in user, `canEdit` and `isAdmin` flags |
| `/api/users` | GET, POST, DELETE | Admin-only list, add or remove manager emails in the Cloudflare Access policy |
| `/api/data/:key` | GET, POST, PATCH, DELETE where allowed | Read, create, edit or delete records in an allowlisted Airtable table |
| `/api/revenue?url=...` | GET | Server-side proxy for two specifically allowed Creatorstaq revenue endpoints |

`GET /api/users` returns `{ "emails": ["manager@example.com"] }`. `POST /api/users` with `{ "email": "manager@example.com" }` adds an exact-email Allow rule; `DELETE /api/users` with the same body removes it. The API rejects duplicate additions, unknown removals and removal of the current admin's own access. It requires the Access API token and an Allow policy containing only exact email rules; the server refuses to modify policies with other rule types. Policy reads are cached for up to 15 seconds per Worker isolate, so removal is not instantaneous. See `lib/access-policy.ts` for the actual Cloudflare request and error handling.

### Airtable-backed records

The BH Airtable base ID is in `lib/data-config.json` (`baseId`). This is a configuration identifier, not a token. Source keys and actions are:

| Key | Airtable table | Allowed writes |
| --- | --- | --- |
| `staff` | Staff | POST, PATCH |
| `paylog` | Pay Log | POST, PATCH, DELETE |
| `expenses` | Expense Log | POST, PATCH, DELETE |
| `models` | Models | POST, PATCH |
| `map` | Model Accounts | POST, PATCH |
| `conversions` | Conversion Log | POST, PATCH, DELETE |
| `expectations` | Staff Expectations | POST, PATCH |
| `paidSubs` | Weekly Paid Subscribers | POST, PATCH |

The full field list, types, select choices, table IDs and per-method editable fields are in `lib/data-config.json`. Read and write requests use **field names**; the client may give each selected field a shorter alias. An unknown table key or field is rejected. No schema or arbitrary Airtable query endpoint is exposed.

**Read a page:** `GET /api/data/staff?select=%7B%22name%22%3A%22Full%20Name%22%7D`. The `select` parameter is a JSON object mapping response aliases to exact Airtable field names, for example `{ "name": "Full Name", "status": "Status" }`. Optional `sort` is a selected alias, `direction` is `asc` or `desc`, and `offset` is the `nextCursor` from the preceding response. Pages contain at most 100 records. Response shape:

```json
{"items":[{"id":"rec...","fields":{"name":"Example","status":"Active"}}],"nextCursor":null}
```

`GET /api/data/staff?options=Status` returns `{ "options": [...] }` for a field's configured select choices. Expense `Category` also includes categories present in current records.

**Create:** `POST /api/data/expectations` with JSON body:

```json
{
  "select": {"name":"Name","staff":"Staff","week":"Effective Week","daily":"Daily Target","weekly":"Weekly Minimum","monthly":"Monthly Target"},
  "fields": {"name":"Example target","staff":["recXXXXXXXXXXXXXX"],"week":"2026-09-14","daily":4,"weekly":28,"monthly":120}
}
```

Use a real Airtable record ID for linked staff. This is a shape example, not a request to run against production. For PATCH, provide `recordId`, the selected aliases for changed fields, `fields`, and `expected` with the **original Airtable field names and values** read before editing. DELETE uses `recordId` and `expected` as well; `fields` is not required. Example PATCH:

```json
{
  "recordId":"recXXXXXXXXXXXXXX",
  "select":{"weekly":"Weekly Minimum"},
  "fields":{"weekly":30},
  "expected":{"Weekly Minimum":28}
}
```

An edit or delete returns HTTP 409 if the supplied expected values differ from the current record. Duplicate keys, including staff/week for expectations and model/week for paid subscribers, are checked before writes. These checks do **not** make Airtable writes atomic across workers or other clients; concurrent writers can still race. The API restricts writable fields by table and method. Percent fields use 0–100 in dashboard requests and responses (for example `25` means 25%); Airtable stores the fraction. Linked records return arrays of `{ "id": "rec...", "label": "..." }`. Date-only fields use `YYYY-MM-DD`; `Week Starting` and `Effective Week` must be Mondays. See `lib/data-rules.ts` for complete validation.

**Signed-in browser read example:**

```js
const select = JSON.stringify({ name: 'Full Name', status: 'Status' });
const response = await fetch('/api/data/staff?select=' + encodeURIComponent(select));
console.log(await response.json());
```

Open this in the dashboard's browser console only after signing in. The URL is same-origin; credentials stay on the server.

### Creatorstaq revenue

`GET /api/revenue?url=` accepts only URLs on `https://api.creatorstaq.com` with these paths and query parameters:

| Upstream path | Allowed parameters | Expected response data |
| --- | --- | --- |
| `/v1/me` | none | `accounts` array only; key metadata is removed from the dashboard response |
| `/v1/computed/revenue/monthly` | `months=6`, `12`, `24`, or `all`; defaults to 24 | `monthly_by_account` array |
| `/v1/computed/revenue/ranged` | `start=YYYY-MM-DD&end=YYYY-MM-DD`; start before end, at most 32 days apart | `by_creator` array |
| `/v1/computed/{account}/revenue/ranged` | Same date range; account is a slug such as `irlapril` | `kpis.total_net` for that account |

Other hosts, paths, parameters, credentials in URLs, fragments and redirects are rejected. The proxy forwards the server-side `CREATORSTAQ_AUTH` header, validates the expected array, and caches successful requests for 60 seconds. It does not provide Creatorstaq credentials to the browser. Example signed-in browser call:

```js
const upstream = 'https://api.creatorstaq.com/v1/computed/revenue/monthly?months=12';
const response = await fetch('/api/revenue?url=' + encodeURIComponent(upstream));
console.log(await response.json());
```

The agency ranged response contains `by_creator` values; a creator can own multiple accounts, so its net cannot be used as DAP-only P&L. Creator IDs are **not** account IDs. P&L uses only selected account slugs from Airtable's `Model Accounts` table and the account-specific ranged endpoint. This transaction net is before chargebacks. The agency monthly response's `monthly_by_account` remains a separate historical source. Never replace missing account revenue with a creator total or zero.

### Live connection status (24 September 2026)

- The Worker at `https://20mg-bh.twentymg-automation.workers.dev/` is deployed behind Cloudflare Access and reads the configured BH Airtable base. P&L and Revenue were checked in an authenticated browser.
- The configured Creatorstaq key returns current ranged **creator-wide** earnings for April, Erin and Kylie. These can include multiple accounts and are shown only as references.
- The account-specific route for April DAP (`irlapril`, ID `329`) returned $3,712.95 transaction net for 1–24 September, matching the Creatorstaq April DAP view for the same date range. April's model P&L uses this account-specific route. Its figures are before chargebacks.
- P&L's Manage models panel lists every model in the Airtable roster and the accounts visible to the Creatorstaq key. Adding a model creates a Models row; connecting a selected DAP account creates or enables its Model Accounts row. Another model's mapped account cannot be silently reassigned. Deal type and cuts are edited on Revenue.
- The same key returns **no revenue record** for Skye, Lolita, Astrid or Mia in that period. Its account listing includes six pages and does not include the mapped pages for Skye, Lolita or Mia. This could be a scope issue or a true zero for a given model; the dashboard cannot tell which. Company-wide income and profit are withheld until coverage is confirmed.
- The key's 12-month `monthly_by_account` response contains no account-level history usable for the chart. The Revenue page shows that limitation rather than inventing monthly totals.
- On 25 September, April's Airtable `Model Accounts` row was corrected to `irlapril` (account ID `329`) at the owner's direction. A live ranged request with `account_id=329` returned the same creator-wide rows as an unfiltered request, so that parameter is ignored by the available endpoint and is not supported by this dashboard proxy.
- To extend DAP-only reporting beyond April, confirm each model's DAP account slug in Creatorstaq and map only those accounts in Airtable `Model Accounts`; verify key access for each. Company-wide income and profit remain withheld until all models are reconciled. The Revenue and Overview pages still use their existing sources and must not be interpreted as a complete DAP account rollup.

## Operational behavior and errors

- Airtable requests use its REST API at `https://api.airtable.com/v0/{baseId}/{tableId}`, server-side only. Reads page at 100 records, cache for 60 seconds, and retry HTTP 429 up to three times after a delay. Successful writes clear the read cache.
- The dashboard's client pages refresh some datasets every minute. This is polling, not Airtable webhooks or a permanent replica.
- HTTP 400 means invalid input or unsupported fields; 403 means authentication, origin or action denial; 404 means unknown source; 409 means stale or duplicate record; 413 means payload too large; 502 means upstream failure or incomplete response; 503 means missing backend configuration or an upstream permission failure.
- The public repository contains schema/configuration and business logic. It does not contain the Airtable records, private API credentials or an official Creatorstaq API specification. The deployed Worker is the live BH dashboard replacement for Softr, subject to the coverage limits above.
