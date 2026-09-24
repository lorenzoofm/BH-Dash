"use client";
import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {Banknote, CalendarRange, Link2, Receipt, RefreshCw, Users, Wallet, TrendingUp, TrendingDown, AlertTriangle, Store} from "lucide-react";
import {q, useProxyFetch, useRecordCreate, useRecordUpdate, useRecords} from "@/lib/datasource";
import {Card, CardContent} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {addDays, fetchCreators, isLoading, label, linkIds, money, num, rowsOf, todayIso, useAllPages, validDay} from "@/lib/bh";

const modelsSelect = q.select({model: "Model", status: "Status", dealType: "Deal Type", modelCut: "Model's Cut %", ourCut: "Our Cut %"});
const mapSelect = q.select({slug: "Account Slug", accountId: "Account ID", model: "Model", include: "Include in P&L"});
const expenseSelect = q.select({date: "Expense Date", amount: "Amount", model: "Model", status: "Status", category: "Category", description: "Description"});
const paySelect = q.select({workDate: "Work Date", staff: "Staff", totalPay: "Total Pay", status: "Payment Status"});
const staffSelect = q.select({name: "Full Name", model: "Model"});
const MODEL_KEY = "bh-pnl-model";

type Preset = "month" | "last-month" | "7d" | "30d" | "custom";

function presetRange(p: Preset, today: string): [string, string] {
  if (p === "7d") return [addDays(today, -6), today];
  if (p === "30d") return [addDays(today, -29), today];
  if (p === "last-month") {
    const last = addDays(today.slice(0, 8) + "01", -1);
    return [last.slice(0, 8) + "01", last];
  }
  return [today.slice(0, 8) + "01", today];
}

export default function PnL() {
  const today = todayIso();
  const [preset, setPreset] = useState<Preset>("month");
  const [[start, end], setRange] = useState<[string, string]>(() => presetRange("month", today));
  const valid = validDay(start) && validDay(end) && start <= end && end <= today;
  const [modelId, setModelId] = useState("");
  const [includeShared, setIncludeShared] = useState(true);

  const models = useRecords({from: "models", select: modelsSelect});
  const map = useRecords({from: "map", select: mapSelect});
  const expenses = useRecords({from: "expenses", select: expenseSelect});
  const wages = useRecords({from: "paylog", select: paySelect});
  const staff = useRecords({from: "staff", select: staffSelect});
  [models, map, expenses, wages, staff].forEach(useAllPages);

  const modelRows = rowsOf(models);
  const activeModels = modelRows.filter(m => label(m.fields.status) !== "Inactive");

  // Remember the chosen model per browser; default to the only/first active model.
  useEffect(() => {
    if (modelId || !modelRows.length) return;
    let saved = "";
    try { saved = localStorage.getItem(MODEL_KEY) || ""; } catch {}
    setModelId(modelRows.some(m => m.id === saved) ? saved : (activeModels[0] ?? modelRows[0]).id);
  }, [modelRows.length]);
  useEffect(() => { if (modelId) try { localStorage.setItem(MODEL_KEY, modelId); } catch {} }, [modelId]);

  const model = modelRows.find(m => m.id === modelId);
  const linked = rowsOf(map).filter(r => r.fields.include !== false && linkIds(r.fields.model).includes(modelId));
  const linkedIds = new Set(linked.map(r => String(num(r.fields.accountId))));

  const proxyFetch = useProxyFetch("live");
  const revenue = useQuery({
    queryKey: ["bh-pnl-creators", start, end], enabled: valid, staleTime: 30000, refetchInterval: 60000, retry: 1,
    queryFn: () => fetchCreators(proxyFetch, start, end),
  });
  const creators = revenue.data ?? [];

  // ---- Page ↔ model linking (stored in the Model Accounts table) ----
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState("");
  const createLink = useRecordCreate({from: "map", fields: {slug: "Account Slug", accountId: "Account ID", model: "Model", include: "Include in P&L"}, onError: e => toast.error(e.message)});
  const updateLink = useRecordUpdate({from: "map", fields: {model: "Model", include: "Include in P&L"}, onError: e => toast.error(e.message)});
  async function savePage() {
    const c = creators.find(c => c.id === pick);
    if (!c || !modelId) return;
    for (const old of linked) if (String(num(old.fields.accountId)) !== c.id) await updateLink.mutateAsync({recordId: old.id, fields: {include: false}});
    const existing = rowsOf(map).find(r => String(num(r.fields.accountId)) === c.id);
    if (existing) await updateLink.mutateAsync({recordId: existing.id, fields: {model: [modelId], include: true}});
    else await createLink.mutateAsync({slug: c.name, accountId: Number(c.id) || null, model: [modelId], include: true});
    toast.success(`${c.name} linked to ${label(model?.fields.model)}`);
    setPicking(false);
  }

  const data = useMemo(() => {
    if (!model) return null;
    const inRange = (d: any) => { const s = String(d ?? "").slice(0, 10); return s >= start && s <= end; };
    const pageRevenue = creators.filter(c => linkedIds.has(c.id)).reduce((s, c) => s + c.net, 0);
    const dealType = label(model.fields.dealType);
    const modelCut = model.fields.modelCut == null ? null : num(model.fields.modelCut);
    const ourCut = model.fields.ourCut == null ? null : num(model.fields.ourCut);
    const chatOnly = dealType === "Chat-only";
    const income = chatOnly ? (ourCut === null ? null : pageRevenue * ourCut / 100) : pageRevenue;
    const payout = chatOnly ? 0 : (modelCut === null ? null : pageRevenue * modelCut / 100);

    const staffModels = new Map(rowsOf(staff).map(s => [s.id, {name: label(s.fields.name), models: linkIds(s.fields.model)}]));
    const byStaff = new Map<string, {name: string; hours: number; pay: number; unpaid: number}>();
    for (const w of rowsOf(wages)) {
      if (!inRange(w.fields.workDate)) continue;
      for (const sid of linkIds(w.fields.staff)) {
        const s = staffModels.get(sid);
        if (!s || !s.models.includes(modelId)) continue;
        const share = num(w.fields.totalPay) / s.models.length;
        const row = byStaff.get(sid) ?? {name: s.name, hours: 0, pay: 0, unpaid: 0};
        row.pay += share;
        if (label(w.fields.status) !== "Paid") row.unpaid += share;
        byStaff.set(sid, row);
      }
    }
    const byCategory = new Map<string, number>();
    let unpaidExpenses = 0;
    for (const e of rowsOf(expenses)) {
      if (!inRange(e.fields.date)) continue;
      const ids = linkIds(e.fields.model);
      const shared = ids.length === 0;
      if (shared ? !includeShared : !ids.includes(modelId)) continue;
      const amount = num(e.fields.amount) / (shared ? 1 : ids.length);
      if (label(e.fields.status) !== "Paid") { unpaidExpenses += amount; continue; }
      const cat = label(e.fields.category) || "Uncategorised";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + amount);
    }
    const wageTotal = [...byStaff.values()].reduce((s, r) => s + r.pay, 0);
    const expenseTotal = [...byCategory.values()].reduce((s, v) => s + v, 0);
    const profit = income === null || payout === null ? null : income - payout - wageTotal - expenseTotal;
    return {
      pageRevenue, income, payout, dealType, modelCut, ourCut, chatOnly, wageTotal, expenseTotal, unpaidExpenses, profit,
      margin: profit !== null && income ? profit / income : null,
      staff: [...byStaff.values()].sort((a, b) => b.pay - a.pay),
      categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [model, creators, linked.length, wages.data, expenses.data, staff.data, start, end, includeShared]);

  const costsLoading = [models, map, expenses, wages, staff].some(isLoading);
  const costsFailed = [models, map, expenses, wages, staff].some(r => r.status === "error");
  const syncing = revenue.isFetching || [models, map, expenses, wages, staff].some(r => r.isFetching);
  const linkedNames = linked.map(r => creators.find(c => linkedIds.has(c.id) && c.id === String(num(r.fields.accountId)))?.name ?? label(r.fields.slug));

  return <div className="space-y-5">
    <Card><CardContent className="space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profit &amp; loss</h1>
          <p className="mt-1 text-sm text-muted-foreground">One model at a time: her Creator Staq earnings, minus staff wages, expenses and her payout.</p>
        </div>
        <Button variant="outline" onClick={() => { revenue.refetch(); [models, map, expenses, wages, staff].forEach(r => r.refetch()); }} disabled={syncing}>
          <RefreshCw className={syncing ? "animate-spin" : ""}/>{syncing ? "Syncing" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5"><Users className="size-4 text-muted-foreground"/>Model</span>
          <select className="h-10 rounded-md border bg-background px-3" value={modelId} onChange={e => { setModelId(e.target.value); setPicking(false); }}>
            {modelRows.map(m => <option key={m.id} value={m.id}>{label(m.fields.model)}{label(m.fields.status) === "Inactive" ? " (inactive)" : ""}</option>)}
          </select>
        </label>
        <div className="grid gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5"><Store className="size-4 text-muted-foreground"/>Creator Staq page</span>
          {picking || (!linked.length && !costsLoading) ? <div className="flex gap-2">
            <select className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3" value={pick} onChange={e => setPick(e.target.value)} disabled={revenue.isPending || revenue.isError}>
              <option value="">{revenue.isError ? "Creator Staq unavailable" : revenue.isPending ? "Loading pages…" : "Choose her page"}</option>
              {creators.map(c => <option key={c.id} value={c.id}>{c.name} · {money(c.net)}</option>)}
            </select>
            <Button onClick={savePage} disabled={!pick || createLink.isPending || updateLink.isPending}><Link2/>Link</Button>
            {linked.length > 0 && <Button variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>}
          </div> : <div className="flex h-10 items-center justify-between rounded-md border bg-muted/40 px-3">
            <span className="truncate">{linkedNames.join(", ") || "—"}</span>
            <button className="text-xs text-muted-foreground underline" onClick={() => { setPick(""); setPicking(true); }}>Change</button>
          </div>}
        </div>
        <div className="grid gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5"><CalendarRange className="size-4 text-muted-foreground"/>Period</span>
          <div className="flex flex-wrap gap-1.5">
            {([["month", "This month"], ["last-month", "Last month"], ["7d", "7 days"], ["30d", "30 days"], ["custom", "Custom"]] as [Preset, string][]).map(([p, text]) =>
              <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => { setPreset(p); if (p !== "custom") setRange(presetRange(p, today)); }}>{text}</Button>)}
          </div>
        </div>
      </div>
      {preset === "custom" && <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">From<input type="date" value={start} max={today} onChange={e => setRange([e.target.value, end])} className="h-9 rounded-md border bg-background px-2"/></label>
        <label className="grid gap-1">To<input type="date" value={end} max={today} onChange={e => setRange([start, e.target.value])} className="h-9 rounded-md border bg-background px-2"/></label>
      </div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>{start} → {end} (inclusive)</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeShared} onChange={e => setIncludeShared(e.target.checked)}/>Include expenses with no model assigned</label>
      </div>
    </CardContent></Card>

    {!valid ? <p role="alert" className="text-amber-700">Choose valid dates, ending no later than today.</p>
    : costsFailed ? <Card><CardContent className="p-5 text-destructive">Could not load costs from Airtable. <Button size="sm" onClick={() => location.reload()}>Retry</Button></CardContent></Card>
    : costsLoading || !data ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted"/>)}</div>
    : <>
      {revenue.isError && <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0"/>Creator Staq revenue is unavailable ({(revenue.error as Error).message}). Costs are shown; profit can’t be calculated.</div>}
      {!revenue.isError && !linked.length && <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0"/>Link {label(model?.fields.model)}’s Creator Staq page above to pull in her earnings.</div>}
      {!data.dealType && <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0"/>This model has no Deal Type set, so her payout is assumed from Model’s Cut %. Set it on the Revenue page.</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={Banknote} title={data.chatOnly ? "Our chatting fee" : "Page earnings"} value={revenue.isError || !linked.length ? null : data.income} note={data.chatOnly ? `${data.ourCut ?? "?"}% of ${money(data.pageRevenue)}` : "Creator Staq net"}/>
        <Kpi icon={Wallet} title="Model payout" value={data.payout} note={data.chatOnly ? "not applicable" : `${data.modelCut ?? "?"}% to model`} negative/>
        <Kpi icon={Users} title="Staff wages" value={data.wageTotal} note={`${data.staff.length} staff · paid + unpaid`} negative/>
        <Kpi icon={Receipt} title="Expenses" value={data.expenseTotal} note={data.unpaidExpenses ? `${money(data.unpaidExpenses)} unpaid not deducted` : "paid expenses"} negative/>
        <Kpi icon={data.profit !== null && data.profit < 0 ? TrendingDown : TrendingUp} title="Net profit" value={revenue.isError || !linked.length ? null : data.profit} note={data.margin === null ? "—" : `${(data.margin * 100).toFixed(1)}% margin`} highlight/>
      </div>

      {!revenue.isError && linked.length > 0 && data.income !== null && <Card><CardContent className="space-y-3 p-5 sm:p-6">
        <h2 className="font-semibold">Where the money goes</h2>
        <Waterfall rows={[["Earnings", data.income], ["Model payout", -(data.payout ?? 0)], ["Staff wages", -data.wageTotal], ["Expenses", -data.expenseTotal]]} profit={data.profit ?? 0}/>
      </CardContent></Card>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="Staff wages" icon={Users} empty="No hours logged for this model's staff in this period." rows={data.staff.map(s => [s.name, s.pay, s.unpaid ? `${money(s.unpaid, 2)} unpaid` : ""])} total={data.wageTotal}/>
        <Breakdown title="Expenses by category" icon={Receipt} empty="No paid expenses in this period." rows={data.categories.map(([c, v]) => [c, v, ""])} total={data.expenseTotal}/>
      </div>
    </>}
  </div>;
}

function Kpi({icon: Icon, title, value, note, negative, highlight}: {icon: any; title: string; value: number | null; note: string; negative?: boolean; highlight?: boolean}) {
  const tone = highlight && value !== null ? (value >= 0 ? "text-emerald-600" : "text-red-600") : "";
  return <div className={"rounded-xl border bg-card p-4 " + (highlight ? "ring-1 ring-foreground/10" : "")}>
    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">{title}<Icon className="size-4"/></div>
    <div className={"mt-2 text-2xl font-semibold tabular-nums " + tone}>{value === null ? "—" : (negative && value ? "−" : "") + money(Math.abs(value), 2)}</div>
    <div className="mt-1 text-xs text-muted-foreground">{note}</div>
  </div>;
}

function Waterfall({rows, profit}: {rows: [string, number][]; profit: number}) {
  const max = Math.max(1, ...rows.map(r => Math.abs(r[1])), Math.abs(profit));
  return <div className="space-y-2">
    {[...rows, ["Net profit", profit] as [string, number]].map(([name, v], i) => <div key={name} className="grid grid-cols-[110px_1fr_110px] items-center gap-3 text-sm">
      <span className={i === rows.length ? "font-semibold" : "text-muted-foreground"}>{name}</span>
      <div className="h-6 rounded bg-muted/50"><div className={"h-6 rounded " + (i === rows.length ? (v >= 0 ? "bg-emerald-500" : "bg-red-500") : v >= 0 ? "bg-foreground" : "bg-orange-400")} style={{width: `${Math.abs(v) / max * 100}%`}}/></div>
      <span className="text-right tabular-nums">{money(v, 2)}</span>
    </div>)}
  </div>;
}

function Breakdown({title, icon: Icon, rows, total, empty}: {title: string; icon: any; rows: [string, number, string][]; total: number; empty: string}) {
  return <Card><CardContent className="space-y-3 p-5 sm:p-6">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-muted-foreground"/>{title}</h2><Badge variant="secondary">{money(total, 2)}</Badge></div>
    {rows.length ? <ul className="divide-y">{rows.map(([name, v, note]) => <li key={name} className="flex items-center gap-3 py-2.5 text-sm">
      <span className="flex-1 truncate">{name}{note && <span className="ml-2 text-xs text-amber-700">{note}</span>}</span>
      <div className="hidden h-1.5 w-24 rounded-full bg-muted sm:block"><div className="h-1.5 rounded-full bg-foreground/70" style={{width: `${total ? v / total * 100 : 0}%`}}/></div>
      <span className="w-24 text-right tabular-nums">{money(v, 2)}</span>
    </li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>}
  </CardContent></Card>;
}
