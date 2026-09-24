import {label, linkIds, num, type Creator} from "@/lib/bh";

type Rec = {id: string; fields: Record<string, any>};

export type ModelPnL = {
  modelId: string;
  name: string;
  dealType: string;
  modelCut: number | null;
  ourCut: number | null;
  linked: boolean;
  pageRevenue: number;
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

/*
  One model's P&L for [start, end]:
  - Revenue: Creator Staq net for the pages linked to the model in Model Accounts.
  - Managed: 20MG keeps the page revenue and pays the model Model's Cut %.
    Chat-only: 20MG earns Our Cut % of page revenue; no payout.
  - Wages: every Pay Log row (paid or unpaid) for staff assigned to the model,
    split evenly when a staff member covers several models.
  - Expenses: Paid expenses linked to the model (split evenly across linked models).
    Unassigned expenses are excluded until allocated to a model; otherwise each
    model's report would count the same company expense in full.
*/
export function modelPnL(model: Rec, {staff, paylog, expenses, map, creators, start, end, revenueKnown}: {
  staff: Rec[]; paylog: Rec[]; expenses: Rec[]; map: Rec[]; creators: Creator[]; start: string; end: string; revenueKnown: boolean;
}): ModelPnL {
  const modelId = model.id;
  const pages = new Set(map.filter(r => r.fields.include !== false && linkIds(r.fields.model).includes(modelId)).map(r => String(r.fields.accountId ?? "")));
  const pageRevenue = creators.filter(c => pages.has(c.id)).reduce((s, c) => s + c.net, 0);
  const dealType = label(model.fields.dealType);
  const modelCut = model.fields.modelCut == null ? null : num(model.fields.modelCut);
  const ourCut = model.fields.ourCut == null ? null : num(model.fields.ourCut);
  const chatOnly = dealType === "Chat-only";
  const known = revenueKnown && pages.size > 0 && (dealType === "Managed" || chatOnly);
  const income = !known ? null : chatOnly ? (ourCut === null ? null : pageRevenue * ourCut / 100) : pageRevenue;
  const payout = !known ? null : chatOnly ? 0 : (modelCut === null ? (pageRevenue === 0 ? 0 : null) : pageRevenue * modelCut / 100);

  const staffInfo = new Map(staff.map(s => [s.id, {name: label(s.fields.name), models: linkIds(s.fields.model)}]));
  const byStaff = new Map<string, {id: string; name: string; hours: number; pay: number; unpaid: number}>();
  for (const w of paylog) {
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
    const ids = linkIds(e.fields.model);
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
    modelId, name: label(model.fields.model), dealType, modelCut, ourCut, linked: pages.size > 0, pageRevenue,
    income, payout, wages, unpaidWages: staffRows.reduce((s, r) => s + r.unpaid, 0), expenses: expenseTotal, unpaidExpenses, profit,
    margin: profit !== null && income ? profit / income : null,
    byStaff: staffRows,
    byCategory: [...byCategory.entries()].map(([name, amount]) => ({name, amount})).sort((a, b) => b.amount - a.amount),
  };
}
