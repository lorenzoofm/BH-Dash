"use client";
import {useEffect, useMemo, useState} from "react";
import {AlertTriangle, Banknote, Link2, Receipt, RefreshCw, Store, TrendingUp, Users, Wallet} from "lucide-react";
import {Bar, Btn, Empty, Field, Notice, PageHeader, PageSkeleton, Panel, Segmented, Stat, inputClass} from "@/components/bh/ui";
import {addDays, label, linkIds, money, num, todayIso, validDay} from "@/lib/bh";
import {useCreators, useTable} from "@/lib/tables";
import {modelPnL} from "@/lib/finance";

type Preset = "month" | "last-month" | "7d" | "30d" | "custom";
const MODEL_KEY = "bh-pnl-model";

function presetRange(p: Preset, today: string): [string, string] {
  if (p === "7d") return [addDays(today, -6), today];
  if (p === "30d") return [addDays(today, -29), today];
  if (p === "last-month") { const last = addDays(today.slice(0, 8) + "01", -1); return [last.slice(0, 8) + "01", last]; }
  return [today.slice(0, 8) + "01", today];
}

export default function PnL() {
  const [today, setToday] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState<[string, string] | null>(null);
  useEffect(() => { const t = todayIso(); setToday(t); setRange(presetRange("month", t)); }, []);
  const [modelId, setModelId] = useState("");

  const models = useTable("models"), map = useTable("map"), expenses = useTable("expenses"), pay = useTable("paylog"), staff = useTable("staff");
  const [start, end] = range ?? ["", ""];
  const valid = !!today && validDay(start) && validDay(end) && start <= end && end <= today;
  const creators = useCreators(valid ? start : null, valid ? end : null);

  useEffect(() => {
    if (modelId || !models.rows.length) return;
    let saved = "";
    try { saved = localStorage.getItem(MODEL_KEY) || ""; } catch {}
    const live = models.rows.filter(m => label(m.fields.status) !== "Ended");
    setModelId(models.rows.some(m => m.id === saved) ? saved : (live[0] ?? models.rows[0]).id);
  }, [models.rows]);
  useEffect(() => { if (modelId) try { localStorage.setItem(MODEL_KEY, modelId); } catch {} }, [modelId]);

  const model = models.rows.find(m => m.id === modelId);
  const p = useMemo(() => model && valid ? modelPnL(model, {staff: staff.rows, paylog: pay.rows, expenses: expenses.rows, map: map.rows, creators: creators.data ?? [], start, end, revenueKnown: creators.isSuccess}) : null,
    [model, valid, staff.rows, pay.rows, expenses.rows, map.rows, creators.data, creators.isSuccess, start, end]);
  const company = useMemo(() => {
    if (!valid || !creators.isSuccess) return null;
    const active = models.rows.map(m => modelPnL(m, {staff: staff.rows, paylog: pay.rows, expenses: expenses.rows, map: map.rows, creators: creators.data ?? [], start, end, revenueKnown: true}))
      .filter(r => r.linked || r.wages || r.expenses);
    const names = new Set(models.rows.map(r => label(r.fields.model).trim().toLowerCase()));
    const unmatched = (creators.data ?? []).filter(c => c.net !== 0 && !names.has(c.name.trim().toLowerCase()));
    const unassigned = expenses.rows.filter(r => !linkIds(r.fields.model).length && label(r.fields.status) === "Paid" && String(r.fields.date ?? "").slice(0, 10) >= start && String(r.fields.date ?? "").slice(0, 10) <= end)
      .reduce((sum, r) => sum + num(r.fields.amount), 0);
    const unresolved = unmatched.length > 0 || active.some(r => r.dealType !== "Managed" && r.dealType !== "Chat-only");
    const sum = (rows: typeof active, key: "income" | "payout" | "profit") => rows.some(r => r[key] === null) || unresolved || (key === "profit" && unassigned > 0) ? null : rows.reduce((n, r) => n + (r[key] ?? 0), 0);
    const section = (deal: string) => {
      const rows = active.filter(r => r.dealType === deal);
      return {count: rows.length, income: sum(rows, "income"), payout: sum(rows, "payout"), profit: sum(rows, "profit"), wages: rows.reduce((n, r) => n + r.wages, 0), expenses: rows.reduce((n, r) => n + r.expenses, 0)};
    };
    return {managed: section("Managed"), chat: section("Chat-only"), unassigned, unmatched: unmatched.length, unknownDeals: active.filter(r => r.dealType !== "Managed" && r.dealType !== "Chat-only").length};
  }, [valid, creators.data, creators.isSuccess, models.rows, staff.rows, pay.rows, expenses.rows, map.rows, start, end]);

  if (!today || !range || [models, map, expenses, pay, staff].some(t => t.loading)) return <PageSkeleton/>;
  const creator = creators.data?.find(c => c.name.trim().toLowerCase() === label(model?.fields.model).trim().toLowerCase());

  const syncing = creators.isFetching || [models, map, expenses, pay, staff].some(t => t.fetching);
  const showRevenue = p && p.income !== null;

  return <div className="space-y-6">
    <PageHeader eyebrow="Finance" title="Profit & Loss" subtitle="One model at a time: her Creator Staq earnings, less payout, staff wages and expenses."
      actions={<Btn onClick={() => { creators.refetch(); [models, map, expenses, pay, staff].forEach(t => t.refetch()); }} disabled={syncing}><RefreshCw className={syncing ? "animate-spin" : ""}/>Refresh</Btn>}/>

    <Panel bodyClass="grid gap-5 lg:grid-cols-[1fr_1.3fr_auto]">
      <Field label="Model">
        <select className={inputClass} value={modelId} onChange={e => setModelId(e.target.value)}>
          {models.rows.map(m => <option key={m.id} value={m.id}>{label(m.fields.model)}{label(m.fields.status) === "Ended" ? " (ended)" : ""}</option>)}
        </select>
      </Field>
      <Field label="Creator Staq creator">
        <div className="flex h-9 items-center gap-2 rounded-lg border bg-muted/50 px-3 text-[13px]">
          <Store className="size-3.5 text-muted-foreground"/><span className="flex-1 truncate font-medium">{creator ? `${creator.name} · ${money(creator.net)} this period` : creators.isPending ? "Loading revenue…" : "No matching creator in this key’s revenue response"}</span>
        </div>
      </Field>
      <Field label="Period">
        <Segmented size="md" value={preset} onChange={v => { setPreset(v); if (v !== "custom") setRange(presetRange(v, today)); }}
          options={[["month", "This month"], ["last-month", "Last month"], ["7d", "7d"], ["30d", "30d"], ["custom", "Custom"]] as const}/>
      </Field>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground lg:col-span-3">
        {preset === "custom" ? <span className="flex items-center gap-2">
          <input type="date" value={start} max={today} onChange={e => setRange([e.target.value, end])} className={inputClass + " h-8 w-auto"}/>→
          <input type="date" value={end} max={today} onChange={e => setRange([start, e.target.value])} className={inputClass + " h-8 w-auto"}/>
        </span> : <span className="num">{start} → {end}</span>}
        <span>Unassigned expenses stay outside model profit until assigned.</span>
      </div>
    </Panel>

    {!valid ? <Notice icon={AlertTriangle}>Choose valid dates, ending no later than today.</Notice>
    : [models, map, expenses, pay, staff].some(t => t.error) ? <Notice tone="red" icon={AlertTriangle}>Couldn’t load costs from Airtable. Refresh to try again.</Notice>
    : !p ? <Empty title="Choose a model"/> : <>
      <div className="space-y-2">
        {creators.isError && <Notice tone="red" icon={AlertTriangle}>Creator Staq revenue is unavailable: {(creators.error as Error).message}. Costs are shown; profit can’t be calculated.</Notice>}
        {creators.isSuccess && !p.linked && <Notice icon={Link2}>No revenue record for {p.name} is visible to the current Creator Staq key. Earnings and profit remain unavailable.</Notice>}
        {p.linked && p.dealType !== "Managed" && p.dealType !== "Chat-only" && <Notice icon={AlertTriangle}>{p.name} has no recognised deal type. Set it under Revenue → Model deals before profit can be calculated.</Notice>}
        {p.linked && p.income !== null && p.payout === null && <Notice icon={AlertTriangle}>{p.name} has no Model’s Cut % set, so her payout and profit can’t be calculated.</Notice>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label={p.dealType === "Chat-only" ? "Our chatting fee" : "Earnings"} icon={Banknote} value={p.income === null ? "—" : money(p.income, 2)} sub={p.dealType === "Chat-only" ? `${p.ourCut ?? "?"}% of ${money(p.pageRevenue)}` : "Creator Staq net"}/>
        <Stat label="Model payout" icon={Wallet} value={p.payout === null ? "—" : money(-p.payout, 2)} sub={p.dealType === "Chat-only" ? "Not applicable" : `${p.modelCut ?? "?"}% to ${p.name}`}/>
        <Stat label="Staff wages" icon={Users} value={money(-p.wages, 2)} sub={`${p.byStaff.length} staff · ${money(p.unpaidWages)} unpaid`}/>
        <Stat label="Expenses" icon={Receipt} value={money(-p.expenses, 2)} sub={p.unpaidExpenses ? `${money(p.unpaidExpenses)} unpaid, not deducted` : "Paid expenses"}/>
        <Stat accent label="Net profit" icon={TrendingUp} value={p.profit === null ? "—" : money(p.profit, 2)} tone={p.profit === null ? "" : p.profit >= 0 ? "positive" : "negative"} sub={p.margin === null ? "—" : `${(p.margin * 100).toFixed(1)}% margin`}/>
      </div>

      {company && <Panel title="Company summary" icon={Wallet}>
        <p className="mb-3 text-[12px] text-muted-foreground">Managed models and chatting clients are separate. Unassigned paid expenses stay outside both until linked to a model.</p>
        {company.unmatched > 0 && <Notice icon={AlertTriangle}>{company.unmatched} Creator Staq creator{company.unmatched === 1 ? " is" : "s are"} not matched to an Airtable model. Aggregate revenue and profit are unavailable until reconciled.</Notice>}
        {company.unknownDeals > 0 && <Notice icon={AlertTriangle}>{company.unknownDeals} model{company.unknownDeals === 1 ? " has" : "s have"} an unknown deal type and are excluded from these sections.</Notice>}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {([["Managed models", company.managed], ["Chatting agency", company.chat]] as const).map(([title, section]) => <div key={title} className="rounded-lg border p-4 text-[13px]">
            <h3 className="font-semibold">{title} · {section.count} models</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground">
              <div>20MG income <strong className="block text-foreground">{money(section.income, 2)}</strong></div>
              <div>Model payouts <strong className="block text-foreground">{money(section.payout, 2)}</strong></div>
              <div>Staff wages <strong className="block text-foreground">{money(section.wages, 2)}</strong></div>
              <div>Paid expenses <strong className="block text-foreground">{money(section.expenses, 2)}</strong></div>
              <div>Profit <strong className="block text-foreground">{money(section.profit, 2)}</strong></div>
            </dl>
          </div>)}
        </div>
        {company.unassigned > 0 && <p className="mt-3 text-[12px] text-amber-700">{money(company.unassigned, 2)} in paid expenses is unassigned. Aggregate profit remains unavailable until these costs are allocated.</p>}
      </Panel>}

      {showRevenue && <Panel title="Where the money goes">
        <div className="space-y-3">
          {([["Earnings", p.income!, "bg-foreground"], ["Model payout", -(p.payout ?? 0), "bg-chart-4"], ["Staff wages", -p.wages, "bg-brand"], ["Expenses", -p.expenses, "bg-chart-2"], ["Net profit", p.profit ?? 0, (p.profit ?? 0) >= 0 ? "bg-positive" : "bg-negative"]] as [string, number, string][]).map(([name, v, cls], i) => {
            const max = Math.max(1, p.income!, p.wages + p.expenses + (p.payout ?? 0));
            return <div key={name} className={"grid grid-cols-[110px_1fr_110px] items-center gap-4 text-[13px] " + (i === 4 ? "border-t pt-3 font-semibold" : "")}>
              <span className={i === 4 ? "" : "text-muted-foreground"}>{name}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={"h-full rounded-full " + cls} style={{width: `${Math.abs(v) / max * 100}%`}}/></div>
              <span className="num text-right">{money(v, 2)}</span>
            </div>;
          })}
        </div>
      </Panel>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Staff wages" icon={Users} actions={<span className="num text-[13px] font-semibold">{money(p.wages, 2)}</span>}>
          {p.byStaff.length ? <ul className="divide-y">{p.byStaff.map(s => <li key={s.id} className="grid grid-cols-[1fr_80px_90px] items-center gap-4 py-2.5 text-[13px]">
            <span className="min-w-0"><span className="block truncate font-medium">{s.name}</span><span className="num text-[12px] text-muted-foreground">{s.hours.toLocaleString()} h{s.unpaid ? ` · ${money(s.unpaid)} unpaid` : ""}</span></span>
            <Bar value={s.pay} max={p.byStaff[0].pay} className="bg-brand"/>
            <span className="num text-right">{money(s.pay, 2)}</span>
          </li>)}</ul> : <Empty title="No hours logged">No pay entries for {p.name}’s staff in this period.</Empty>}
        </Panel>
        <Panel title="Expenses by category" icon={Receipt} actions={<span className="num text-[13px] font-semibold">{money(p.expenses, 2)}</span>}>
          {p.byCategory.length ? <ul className="divide-y">{p.byCategory.map(c => <li key={c.name} className="grid grid-cols-[1fr_80px_90px] items-center gap-4 py-2.5 text-[13px]">
            <span className="truncate font-medium">{c.name}</span>
            <Bar value={c.amount} max={p.byCategory[0].amount} className="bg-chart-2"/>
            <span className="num text-right">{money(c.amount, 2)}</span>
          </li>)}</ul> : <Empty title="No paid expenses">Nothing paid in this period.</Empty>}
        </Panel>
      </div>
    </>}
  </div>;
}
