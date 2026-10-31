import {label, linkIds, num, type Creator} from "@/lib/bh";

type Rec = {id: string; fields: Record<string, any>};

export type ModelPnL = {
  modelId: string;
  name: string;
  dealType: string;
  modelCut: number | null;
  ourCut: number | null;
  linked: boolean;
  pageRevenue: number | null;
  income: number | null;   // what 20MG earns before costs; null when a required % is missing
  payout: number | null;   // to the model (Managed deals only)
  wages: number;
  unpaidWages: number;
  expenses: number;        // paid expenses only
  unpaidExpenses: number;  // shown, not deducted
  profit: number | null;
  margin: number | null;
  byStaff: {id: string; name: string; hours: number; pay: number; unpaid: number}[];
  byCategory: {name: string; amount: number}[];
};

const inRange = (d: any, start: string, end: string) => {
  const s = String(d ?? "").slice(0, 10);
  return s !== "" && s >= start && s <= end;
};

export type Account = {id: number; slug: string; of_username: string};
// A Model Accounts row belongs to a Creatorstaq account by numeric id or by slug.
export const isLinked = (r: Rec, a: Account) => Number(r.fields.accountId) === a.id || label(r.fields.slug).toLowerCase() === a.slug.toLowerCase();

// Accounts the Sync button adds: no Model Accounts row at all. A row with no model is a deleted account, never synced back.
export const newAccounts = (accounts: Account[], rows: Rec[]) => accounts.filter(a => !rows.some(r => isLinked(r, a)));

// Each Creatorstaq account with its model-linked row, carrying Creatorstaq's own id and slug so revenue
// lookups (by slug) and monthly history (by id) never disagree with a hand-typed value.
export function accountRows(accounts: Account[], rows: Rec[]): Rec[] {
  return accounts.flatMap(a => {
    const r = rows.find(r => linkIds(r.fields.model).length > 0 && isLinked(r, a));
    return r ? [{...r, fields: {...r.fields, accountId: a.id, slug: a.slug.toLowerCase(), ofUsername: a.of_username || r.fields.ofUsername}}] : [];
  });
}

// Finished-month net per model for the counted accounts, from the agency monthly endpoint's monthly_by_account.
// Its account shape is undocumented, so an entry matches by account_id (or id) or by slug, and net may come as
// `net` or `net_amount` (decimal strings). A counted account missing from a month earned nothing in it.
// `why` says why there is no history to show; `missing` lists counted accounts absent from every month.
export function monthlyHistory(buckets: {month?: string; accounts?: Record<string, any>[] | null}[], counted: Rec[], thisMonth: string) {
  const byId = new Map(counted.map(r => [String(r.fields.accountId), r]));
  const bySlug = new Map(counted.map(r => [label(r.fields.slug).toLowerCase(), r]));
  const seen = new Set<Rec>();
  const chart = buckets.map(mo => {
    const row = {month: String(mo.month ?? "").slice(0, 7), total: 0, by: {} as Record<string, number>};
    for (const a of mo.accounts ?? []) {
      const r = byId.get(String(a.account_id ?? a.id)) ?? bySlug.get(String(a.slug ?? "").toLowerCase());
      if (!r) continue;
      seen.add(r);
      const mid = linkIds(r.fields.model)[0], net = num(a.net ?? a.net_amount);
      row.by[mid] = (row.by[mid] ?? 0) + net;
      row.total += net;
    }
    return row;
  }).filter(r => /^\d{4}-\d{2}$/.test(r.month) && r.month < thisMonth).sort((a, b) => a.month.localeCompare(b.month));
  const missing = counted.filter(r => !seen.has(r)).map(r => label(r.fields.slug));
  const why = !counted.length ? "No counted accounts" : !chart.length ? "Creatorstaq returned no finished months"
    : missing.length === counted.length ? `No history for counted accounts (${missing.join(", ")})` : null;
  return {chart, missing, why};
}

// No included DAP accounts means zero; unavailable or shared account revenue is unknown.
export function dapRevenueFor(modelId: string, rows: Rec[], modelIds: string[], ready: boolean, amounts: Record<string, {net: number | null}> | undefined): number | null {
  if (!ready) return null;
  const own = rows.filter(r => linkIds(r.fields.model).includes(modelId));
  if (own.some(r => linkIds(r.fields.model).filter(id => modelIds.includes(id)).length > 1)) return null;
  const values = own.map(r => amounts?.[label(r.fields.slug).toLowerCase()]?.net ?? null);
  return values.some(v => v === null) ? null : values.reduce<number>((sum, v) => sum + v!, 0);
}

/*
  One model's P&L for [start, end]:
  - Revenue: selected Creator Staq account-level ranged net, before chargebacks.
  - Managed: 20MG keeps the page revenue and pays the model Model's Cut %.
    Chat-only: 20MG earns Our Cut % of page revenue; no payout.
  - Wages: the pay run's wagesFor (lib/pay.ts) per staff member assigned to the model,
    split evenly when a staff member covers several models. Without `wages`, falls back to
    summing Pay Log Total Pay (legacy callers).
  - Expenses: Paid expenses linked to the model (split evenly across linked models).
    Shared expenses (no model) are split evenly across `sharedAcross` (the live models), so the
    models' expenses add up to every expense on the Expenses page. Without it they're excluded.
*/
export type StaffWages = Map<string, {hours: number; pay: number; unpaid: number}>;
export function modelPnL(model: Rec, {staff, paylog, expenses, map, creators, start, end, revenueKnown, accountRevenue = null, wages: payRun, sharedAcross = []}: {
  staff: Rec[]; paylog: Rec[]; expenses: Rec[]; map: Rec[]; creators: Creator[]; start: string; end: string; revenueKnown: boolean; accountRevenue?: number | null;
  wages?: StaffWages; // wagesFor(...) from lib/pay.ts for [start, end]
  sharedAcross?: string[]; // model ids that share the no-model expenses
}): ModelPnL {
  const modelId = model.id;
  // The ranged API returns creator_id, not an account ID. Its creator name is
  // the only identity shared with the Airtable Models table.
  const matches = creators.filter(c => c.name.trim().toLowerCase() === label(model.fields.model).trim().toLowerCase());
  // by_creator combines a model's accounts. It cannot establish DAP revenue.
  const pageRevenue = accountRevenue;
  const dealType = label(model.fields.dealType);
  const modelCut = model.fields.modelCut == null ? null : num(model.fields.modelCut);
  const ourCut = model.fields.ourCut == null ? null : num(model.fields.ourCut);
  const chatOnly = dealType === "Chat-only";
  // No revenue (no counted account, or $0) is $0 income and payout under any deal, so an un-configured
  // synced model or one with every account switched off doesn't blank the company totals.
  const income = pageRevenue === null ? null : pageRevenue === 0 ? 0 : chatOnly ? ourCut === null ? null : pageRevenue * ourCut / 100 : dealType === "Managed" ? pageRevenue : null;
  const payout = pageRevenue === null ? null : pageRevenue === 0 || chatOnly ? 0 : dealType === "Managed" && modelCut !== null ? pageRevenue * modelCut / 100 : null;

  const staffInfo = new Map(staff.map(s => [s.id, {name: label(s.fields.name), models: linkIds(s.fields.model)}]));
  const byStaff = new Map<string, {id: string; name: string; hours: number; pay: number; unpaid: number}>();
  if (payRun) for (const [sid, w] of payRun) {
    const s = staffInfo.get(sid);
    if (!s || !s.models.includes(modelId)) continue;
    const share = 1 / s.models.length;
    byStaff.set(sid, {id: sid, name: s.name, hours: w.hours * share, pay: w.pay * share, unpaid: w.unpaid * share});
  }
  // ponytail: legacy Pay Log path for callers that don't pass `wages` yet; delete once they all do.
  else for (const w of paylog) {
    if (!inRange(w.fields.workDate, start, end)) continue;
    for (const sid of linkIds(w.fields.staff)) {
      const s = staffInfo.get(sid);
      if (!s || !s.models.includes(modelId)) continue;
      const share = 1 / s.models.length;
      const row = byStaff.get(sid) ?? {id: sid, name: s.name, hours: 0, pay: 0, unpaid: 0};
      row.hours += num(w.fields.hours) * share;
      row.pay += num(w.fields.totalPay) * share;
      if (label(w.fields.status) !== "Paid") row.unpaid += num(w.fields.totalPay) * share;
      byStaff.set(sid, row);
    }
  }
  const byCategory = new Map<string, number>();
  let unpaidExpenses = 0;
  for (const e of expenses) {
    if (!inRange(e.fields.date, start, end)) continue;
    const linked = linkIds(e.fields.model), ids = linked.length ? linked : sharedAcross;
    if (!ids.includes(modelId)) continue;
    const amount = num(e.fields.amount) / Math.max(1, ids.length);
    if (label(e.fields.status) !== "Paid") { unpaidExpenses += amount; continue; }
    const cat = label(e.fields.category) || "Uncategorised";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + amount);
  }
  const staffRows = [...byStaff.values()].sort((a, b) => b.pay - a.pay);
  const wages = staffRows.reduce((s, r) => s + r.pay, 0);
  const expenseTotal = [...byCategory.values()].reduce((s, v) => s + v, 0);
  const profit = income === null || payout === null ? null : income - payout - wages - expenseTotal;
  return {
    modelId, name: label(model.fields.model), dealType, modelCut, ourCut, linked: pageRevenue !== null || matches.length === 1, pageRevenue,
    income, payout, wages, unpaidWages: staffRows.reduce((s, r) => s + r.unpaid, 0), expenses: expenseTotal, unpaidExpenses, profit,
    margin: profit !== null && income ? profit / income : null,
    byStaff: staffRows,
    byCategory: [...byCategory.entries()].map(([name, amount]) => ({name, amount})).sort((a, b) => b.amount - a.amount),
  };
}
