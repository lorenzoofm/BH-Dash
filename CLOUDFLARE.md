# Cloudflare deployment

This branch runs in the owner's Cloudflare account. The existing Sites deployment stays available on the main branch.

- Deploy: `npm run deploy` (builds first and removes local-only secrets from the build).
- Check private access: `npm run check:access`.
- Worker identity and public settings live in `wrangler.json`.
- Airtable and Creatorstaq credentials are encrypted Worker secrets, never client variables.
- The Access application must protect all traffic to this Worker. Its issuer and audience must match `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
- `MANAGER_EMAILS` is the exact email allowlist. Update the Access policy as well when adding a manager.
- Preview URLs stay disabled. The Worker verifies signed Access tokens for pages, APIs and assets, and rejects missing or invalid authentication.
- Before initial activation, `workers_dev` remains false. No data is publicly reachable.

The Airtable bases and daily scraper are unchanged by this hosting migration.
