# BH dashboard API and data connections

This document describes the **implemented code in this repository**, not a live API guarantee or official Airtable/Creatorstaq documentation. The dashboard currently uses Airtable for editable records and Creatorstaq for revenue. It does not contain a database export, API credentials, or a working Creatorstaq token. The source alone cannot reproduce the live data.

## Where the implementation lives

| Concern | Source |
| --- | --- |
| Dashboard route handlers | `app/api/session/route.ts`, `app/api/data/[key]/route.ts`, `app/api/revenue/route.ts` |
| Airtable base, table, field and write allowlists | `lib/data-config.json` |
| Airtable transport, caching and response mapping | `lib/data-server.ts` |
| Validation, required and unique fields | `lib/data-rules.ts` |
| Permitted Creatorstaq requests | `lib/revenue-request.ts` |
| Client calls | `lib/datasource.ts` and `app/blocks/*.tsx` |
| Cloudflare Access verification | `lib/cloudflare-access.ts`, `worker.ts`, `app/auth.ts` |
| Worker configuration and deployment | `wrangler.json`, `CLOUDFLARE.md` |

## Configuration and access

| Variable | Role | Where to set it |
| --- | --- | --- |
| `AIRTABLE_TOKEN` | Airtable personal access token with read/write access to the configured BH base | Ignored local `.env.local` or encrypted Cloudflare Worker secret |
| `CREATORSTAQ_AUTH` | Complete Creatorstaq `Authorization` header value, including `Bearer ` if that is how the issued token is used | Ignored local `.env.local` or encrypted Worker secret |
| `ACCESS_TEAM_DOMAIN` | HTTPS Cloudflare Access issuer, for example `https://your-team.cloudflareaccess.com` | Worker configuration; must match the Access application |
| `ACCESS_AUD` | Cloudflare Access application audience | Worker configuration; must match the Access application |
| `MANAGER_EMAILS` | Comma-separated email allowlist | Worker configuration; keep Access policy in sync |
| `DASHBOARD_KIND` | `bh` | Worker configuration |
| `OTHER_DASHBOARD_URL` | Link to Content Studio | Worker configuration |

`wrangler.json` currently has `workers_dev: false` and does not contain real Access issuer/audience values. Configure Access and the two secrets before enabling a URL. `npm run deploy` builds and deploys the Worker, but does not configure Access or supply missing credentials. Do not put secrets in source, GitHub Actions logs, browser code, or issue reports. See [CLOUDFLARE.md](CLOUDFLARE.md) for the deployment boundary.

Every production request, including pages, assets and API routes, must carry a valid Cloudflare Access JWT for an email in `MANAGER_EMAILS`. The Worker verifies the issuer, audience, signature and claims. The BH data routes also check manager authorization. Writes require an `Origin` header equal to the dashboard origin. This is a **session API for the dashboard**, not a public token-based integration API. Use the signed-in browser for the examples below; do not expose Airtable or Creatorstaq tokens to browser JavaScript.

## Dashboard routes

All responses are JSON. Error responses have `{ "error": "message" }`. Data and revenue responses set `Cache-Control: private, no-store`; successful upstream reads also have a short server-side cache.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/session` | GET | Current signed-in user and whether they can edit; `allowedEmails` is only populated for a manager |
| `/api/data/:key` | GET, POST, PATCH, DELETE where allowed | Read, create, edit or delete records in an allowlisted Airtable table |
| `/api/revenue?url=...` | GET | Server-side proxy for two specifically allowed Creatorstaq revenue endpoints |

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
| `/v1/computed/revenue/monthly` | `months=1` through `24`; defaults to 24 | `monthly_by_account` array |
| `/v1/computed/revenue/ranged` | `start=YYYY-MM-DD&end=YYYY-MM-DD`; start before end, at most 32 days apart | `by_creator` array |

Other hosts, paths, parameters, credentials in URLs, fragments and redirects are rejected. The proxy forwards the server-side `CREATORSTAQ_AUTH` header, validates the expected array, and caches successful requests for 60 seconds. It does not provide Creatorstaq credentials to the browser. Example signed-in browser call:

```js
const upstream = 'https://api.creatorstaq.com/v1/computed/revenue/monthly?months=1';
const response = await fetch('/api/revenue?url=' + encodeURIComponent(upstream));
console.log(await response.json());
```

The P&L uses ranged `by_creator` values such as `creator_id`, `name`, and `net_revenue`. Revenue and account mapping use monthly `monthly_by_account` groups with `month` and account values such as `account_id`, `slug`, `name`, and `net`. These are fields consumed by this code, **not a complete official Creatorstaq schema**. The actual token and live response contract still need verification; until `CREATORSTAQ_AUTH` is installed, this route returns HTTP 503 and revenue/P&L cannot be considered verified. Never replace missing revenue with zero.

## Operational behavior and errors

- Airtable requests use its REST API at `https://api.airtable.com/v0/{baseId}/{tableId}`, server-side only. Reads page at 100 records, cache for 60 seconds, and retry HTTP 429 up to three times after a delay. Successful writes clear the read cache.
- The dashboard's client pages refresh some datasets every minute. This is polling, not Airtable webhooks or a permanent replica.
- HTTP 400 means invalid input or unsupported fields; 403 means authentication, origin or action denial; 404 means unknown source; 409 means stale or duplicate record; 413 means payload too large; 502 means upstream failure or incomplete response; 503 means missing backend configuration or an upstream permission failure.
- The public repository contains schema/configuration and business logic. It does not contain the Airtable records, private API credentials, an official Creatorstaq API specification, or a live replacement for Softr.
