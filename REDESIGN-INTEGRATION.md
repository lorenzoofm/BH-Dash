# Redesign integration

Based on Claude's `claude/eager-bell-4qvb2m` at `86bf0e0`, descended from main `0603692`.

## Preserved workflows

The redesigned default screens include links to detailed tools at `/detailed/overview`, `/detailed/staff`, `/detailed/pay-hours`, `/detailed/conversions`, `/detailed/expenses`, and `/detailed/revenue`. These retain the previous daily/monthly/custom expectations, richer reports, batch tools, and editable fields while the new screens provide a compact daily workflow. The detailed revenue screen uses the existing server-backed manager session instead of its obsolete Softr email list.

The old P&L screen is not routed: its creator mapping and client email gate were obsolete. The new P&L provides model reporting and separate managed/chat-only company totals. Missing mappings/deal types leave affected aggregate financial figures unavailable; paid unassigned costs leave aggregate profit unavailable until assigned. Unassigned costs are never duplicated across models.

## Corrections to redesigned screens

- Linked record editing preserves multiple linked models.
- All-columns controls expose otherwise hidden editable fields; staff end date/currency and expense currency/channel/source reference are restored.
- Table failures expose a retry action instead of an endless loading state.
- Weekly conversions reject invalid integer values and retain unsuccessful edits after partial saves.
- Enter/blur and Escape do not trigger duplicate or unwanted grid saves.
- The mock API override is removed: Airtable/revenue backend files match main.

## Verification

Passed TypeScript, production build, and `check-finance`, `check-core`, `check-bh-calendar`, `check-expectations`, `check-paid-subs`, and `check-overview` scripts. Live Creatorstaq reconciliation remains unverified because its production credential is absent; do not treat unavailable revenue as zero.

## Integration

No production deployment is included. Merge the separate Cloudflare authentication/infrastructure work afterward; review any layout/shell conflicts to preserve the new navigation and protected session handling. No Cloudflare configuration, auth API, user administration API, or Airtable backend changes are included here.
