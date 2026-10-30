"use client";
import {useEffect, useMemo, useRef, useState} from "react";
import {AlertTriangle, Banknote, Link2, Plus, Receipt, RefreshCw, TrendingUp, Users, Wallet} from "lucide-react";
import {Btn, Drawer, Field, Notice, PageHeader, PageSkeleton, Segmented, inputClass} from "@/components/bh/ui";
import {Select} from "@/components/bh/menu";
import {toast} from "@/components/bh/toast";
import {addDays, label, linkIds, money, num, todayIso, validDay} from "@/lib/bh";
import {useAccountRevenues, useCreators, useDapAccounts, useTable} from "@/lib/tables";
import {useSession} from "@/lib/datasource";
import {usePayData} from "@/lib/pay-data";
import {wagesFor} from "@/lib/pay";
import {dapRevenueFor, modelPnL} from "@/lib/finance";
import {cn} from "@/lib/utils";
import {ModelPicker, type PickerModel} from "@/views/pnl/model-picker";

type Preset = "month" | "last-month" | "7d" | "30d" | "custom";
const MODEL_KEY = "bh-pnl-model";
const CARD = "rounded-[var(--radius-card)] border border-[var(--edge-card)] bg-card shadow-[var(--shadow-card)]";
// ponytail: Creatorstaq's /v1/me photo field name is unverified; these are the likely keys.
const photoOf = (a: any): string | null => a?.avatar_url || a?.avatar || a?.profile_picture || a?.photo_url || null;

function presetRange(p: Preset, today: string): [string, string] {
  if (p === "7d") return [addDays(today, -6), today];
  if (p === "30d") return [addDays(today, -29), today];
  if (p === "last-month") { const last = addDays(today.slice(0, 8) + "01", -1); return [last.slice(0, 8) + "01", last]; }
  return [today.slice(0, 8) + "01", today];
}

function Kpi({label: name, icon: Icon, value, sub, ink, tone}: {label: string; icon: any; value: string; sub?: string; ink?: boolean; tone?: number | null}) {
  const valueC = !ink ? undefined : tone == null ? undefined : tone >= 0 ? "#3fa86a" : "#ff6a4d";
  return <div className={cn("rounded-[var(--radius-card)] border p-6 shadow-[var(--shadow-card)]", ink ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--edge-card)] bg-card text-foreground")}>
    <div className={cn("flex items-center justify-between text-[13px] font-medium", ink ? "text-[#f4f1ea99]" : "text-muted-foreground")}>{name}<Icon className={cn("size-4", ink ? "text-signal" : "text-[#69655eb3]")} strokeWidth={1.75}/></div>
    <div className="num mt-5 text-[32px] font-bold leading-none tracking-[-0.05em]" style={{color: valueC}}>{value}</div>
    <div className={cn("mt-4 min-h-[18px] text-[12px]", ink ? "text-[#f4f1ea99]" : "text-muted-foreground")}>{sub}</div>
  </div>;
}

const BarRow = ({pct, color, h = 6}: {pct: number; color: string; h?: number}) =>
  <div className="overflow-hidden rounded-full bg-[var(--ink-100)]" style={{height: h}}><div className="h-full rounded-full" style={{width: `${Math.min(100, Math.max(0, pct))}%`, background: color}}/></div>;

export default function PnL() {
  const [today, setToday] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState<[string, string] | null>(null);
  useEffect(() => { const t = todayIso(); setToday(t); setRange(presetRange("month", t)); }, []);
  const [modelId, setModelId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newAccount, setNewAccount] = useState("");
  const [saving, setSaving] = useState(false);

  const models = useTable("models"), map = useTable("map"), expenses = useTable("expenses");
  const payData = usePayData(), {staff} = payData, pay = payData.paylog;
  const tables = [models, map, expenses, ...payData.tables];
  const [start, end] = range ?? ["", ""];
  const valid = !!today && validDay(start) && validDay(end) && start <= end && end <= today;
  const creators = useCreators(valid ? start : null, valid ? end : null);
  const dap = useDapAccounts();
  const session = useSession();

  useEffect(() => {
    if (modelId || !models.rows.length) return;
    let saved = "";
    try { saved = localStorage.getItem(MODEL_KEY) || ""; } catch {}
    const live = models.rows.filter(m => label(m.fields.status) !== "Ended");
    setModelId(models.rows.some(m => m.id === saved) ? saved : (live[0] ?? models.rows[0]).id);
  }, [models.rows]);
  useEffect(() => { if (modelId) try { localStorage.setItem(MODEL_KEY, modelId); } catch {} }, [modelId]);
  useEffect(() => { if (modelId && !selectedIds.length) setSelectedIds([modelId]); }, [modelId, selectedIds.length]);

  // Keep Model Accounts' Avatar URL in step with the Creatorstaq profile photo (admins only; map PATCH needs admin).
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !session.data?.isAdmin || !dap.data || map.loading) return;
    synced.current = true;
    const stale = map.rows.flatMap(r => { const photo = photoOf(dap.data!.find(a => a.id === Number(r.fields.accountId))); return photo && photo !== r.fields.avatar ? [[r.id, photo] as const] : []; });
    if (stale.length) Promise.all(stale.map(([id, avatar]) => map.update(id, {avatar}))).then(() => toast(`${stale.length} model photo${stale.length === 1 ? "" : "s"} updated from Creatorstaq`), (e: any) => toast.error(e.message));
  }, [session.data, dap.data, map.loading, map.rows]);

  const wages = useMemo(() => valid ? wagesFor(payData.data, payData.vas, start, end, today!) : new Map(), [valid, payData.data, payData.vas, start, end, today]);
  const model = models.rows.find(m => m.id === modelId);
  const inKey = new Set((dap.data ?? []).map(a => a.slug.toLowerCase()));
  const dapRows = map.rows.filter(r => r.fields.include !== false && inKey.has(label(r.fields.slug).toLowerCase()));
  const mappedCount = models.rows.filter(m => dapRows.some(r => linkIds(r.fields.model).includes(m.id))).length;
  const accountRows = dapRows.filter(r => linkIds(r.fields.model).includes(modelId));
  const accountSlugs = accountRows.map(r => label(r.fields.slug).toLowerCase());
  const selectedModels = models.rows.filter(m => selectedIds.includes(m.id));
  const relevantIds = models.rows.filter(m => label(m.fields.status) !== "Ended" || selectedIds.includes(m.id)).map(m => m.id);
  const revenueRows = dapRows.filter(r => linkIds(r.fields.model).some(id => relevantIds.includes(id)));
  const accountRevenue = useAccountRevenues(revenueRows.map(r => label(r.fields.slug).toLowerCase()), valid ? start : null, valid ? end : null);
  const revenueOf = (id: string) => dapRevenueFor(id, revenueRows, relevantIds, dap.isSuccess && (revenueRows.length === 0 || accountRevenue.isSuccess), accountRevenue.data);
  const pnlOf = (m: (typeof models.rows)[number]) => modelPnL(m, {staff: staff.rows, paylog: pay.rows, expenses: expenses.rows, map: map.rows, creators: creators.data ?? [], start, end, revenueKnown: creators.isSuccess, accountRevenue: revenueOf(m.id), wages});
  const reports = selectedModels.map(pnlOf);
  const p = reports.find(r => r.modelId === modelId) ?? null;
  const company = useMemo(() => {
    if (!valid) return null;
    const active = models.rows.filter(m => label(m.fields.status) !== "Ended").map(pnlOf);
    const missing = active.filter(r => r.pageRevenue === null).map(r => r.name);
    const unassigned = expenses.rows.filter(r => !linkIds(r.fields.model).length && label(r.fields.status) === "Paid" && String(r.fields.date ?? "").slice(0, 10) >= start && String(r.fields.date ?? "").slice(0, 10) <= end)
      .reduce((sum, r) => sum + num(r.fields.amount), 0);
    const unresolved = missing.length > 0 || active.some(r => r.dealType !== "Managed" && r.dealType !== "Chat-only");
    const sum = (rows: typeof active, key: "income" | "payout" | "profit") => rows.some(r => r[key] === null) || unresolved || (key === "profit" && unassigned > 0) ? null : rows.reduce((n, r) => n + (r[key] ?? 0), 0);
    const section = (deal: string) => {
      const rows = active.filter(r => r.dealType === deal);
      return {count: rows.length, income: sum(rows, "income"), payout: sum(rows, "payout"), profit: sum(rows, "profit"), wages: rows.reduce((n, r) => n + r.wages, 0), expenses: rows.reduce((n, r) => n + r.expenses, 0)};
    };
    return {managed: section("Managed"), chat: section("Chat-only"), unassigned, missing, unknownDeals: active.filter(r => r.dealType !== "Managed" && r.dealType !== "Chat-only").length};
  }, [valid, creators.data, creators.isSuccess, models.rows, staff.rows, pay.rows, expenses.rows, map.rows, start, end, dap.data, dap.isSuccess, accountRevenue.data, accountRevenue.isSuccess, selectedIds, wages]);

  if (!today || !range || tables.some(t => t.loading)) return <PageSkeleton/>;

  const pickerModels: PickerModel[] = models.rows.map((m, index) => {
    const own = map.rows.filter(r => linkIds(r.fields.model).includes(m.id));
    const a = own.find(r => r.fields.include !== false) ?? own[0], name = label(m.fields.model), handle = label(a?.fields.ofUsername);
    return {id: m.id, name, index, handle: handle ? "@" + handle : name, sub: name + (a ? " · " + label(a.fields.slug) : " · no DAP account"),
      avatar: a?.fields.avatar || photoOf(dap.data?.find(x => x.id === Number(a?.fields.accountId))), ended: label(m.fields.status) === "Ended", deal: label(m.fields.dealType)};
  });
  const activeIds = models.rows.filter(m => label(m.fields.status) !== "Ended").map(m => m.id);
  const pick = (ids: string[]) => { setSelectedIds(ids); if (!ids.includes(modelId)) setModelId(ids[ids.length - 1]); };

  const syncing = creators.isFetching || accountRevenue.isFetching || tables.some(t => t.fetching);
  const combined = reports.length > 1 ? {
    income: reports.every(r => r.income !== null) ? reports.reduce((n, r) => n + (r.income ?? 0), 0) : null,
    payout: reports.every(r => r.payout !== null) ? reports.reduce((n, r) => n + (r.payout ?? 0), 0) : null,
    profit: reports.every(r => r.profit !== null) ? reports.reduce((n, r) => n + (r.profit ?? 0), 0) : null,
    wages: reports.reduce((n, r) => n + r.wages, 0), expenses: reports.reduce((n, r) => n + r.expenses, 0),
  } : null;
  const accountErrors = dapRows.filter(r => linkIds(r.fields.model).some(id => selectedIds.includes(id))).map(r => label(r.fields.slug).toLowerCase()).flatMap(slug => accountRevenue.data?.[slug]?.error ? [`${slug}: ${accountRevenue.data[slug].error}`] : []);
  const m2 = (v: number | null) => money(v, 2), neg = (v: number | null) => v === null ? "—" : money(-v, 2);

  // Picking a model in the drawer also adds it to the report, so it never vanishes behind "Choose a model".
  const chooseModel = (id: string) => { setModelId(id); if (!selectedIds.includes(id)) setSelectedIds([...selectedIds, id]); };

  async function addModel() {
    const name = newModel.trim();
    if (!name) return;
    if (models.rows.some(r => label(r.fields.model).toLowerCase() === name.toLowerCase())) return toast.error("That model already exists");
    setSaving(true);
    try { const row = await models.create({model: name}); setNewModel(""); if (row?.id) { setModelId(row.id); setSelectedIds([row.id]); } toast(`${name} added. Set her deal and connect her DAP account.`); }
    catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function connectAccount() {
    const account = dap.data?.find(a => String(a.id) === newAccount);
    if (!account || !modelId) return;
    const existing = map.rows.find(r => Number(r.fields.accountId) === account.id || label(r.fields.slug).toLowerCase() === account.slug.toLowerCase());
    if (existing && linkIds(existing.fields.model).some(id => id !== modelId)) return toast.error("That account is already assigned to another model");
    setSaving(true);
    const photo = photoOf(account);
    try {
      if (existing) await map.update(existing.id, {model: [modelId], include: true});
      else await map.create({slug: account.slug, accountId: account.id, ofUsername: account.of_username, model: [modelId], include: true, ...(photo ? {avatar: photo} : {})});
      setNewAccount(""); toast(`${account.slug} connected to ${label(model?.fields.model)}`);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  const notices: [("amber" | "red" | "gray"), React.ReactNode][] = [];
  if (!valid) notices.push(["amber", "Choose valid dates, ending no later than today."]);
  else if (tables.some(t => t.error)) notices.push(["red", "Couldn’t load costs from the BH database. Refresh to try again."]);
  else if (combined) {
    if (accountErrors.length) notices.push(["red", `Some selected DAP accounts could not be read: ${accountErrors.join(" · ")}. Combined earnings and profit remain blank.`]);
    if (reports.some(r => r.pageRevenue === null)) notices.push(["amber", "A selected model has no verified DAP revenue. Connect its account and confirm API access before using the combined earnings or profit."]);
  } else if (p) {
    if (dap.isError) notices.push(["red", "The DAP account list could not be loaded. Revenue remains unavailable."]);
    if (accountErrors.length) notices.push(["red", `DAP account revenue is unavailable: ${accountErrors.join(" · ")}. Check the mapped account and Creator Staq access.`]);
    if (!accountRows.length && dap.isSuccess) notices.push(["gray", `No DAP account is mapped to ${p.name}; DAP revenue is $0.`]);
    if (p.pageRevenue !== null && accountSlugs.length) notices.push(["gray", `Revenue for ${accountSlugs.join(", ")} is transaction net before chargebacks. The monthly ledger may differ after chargebacks.`]);
    if (p.linked && p.dealType !== "Managed" && p.dealType !== "Chat-only") notices.push(["amber", `${p.name} has no recognised deal type. Set it under Revenue → Model deals before profit can be calculated.`]);
    if (p.linked && p.income !== null && p.payout === null) notices.push(["amber", `${p.name} has no Model’s Cut % set, so her payout and profit can’t be calculated.`]);
  }
  const showBody = valid && !tables.some(t => t.error);

  return <div>
    <PageHeader eyebrow="Finance" title="Profit & Loss" subtitle="Select one model or combine several models into one P&L."
      actions={<><Btn onClick={() => setManaging(true)}><Plus/>Manage models</Btn><Btn onClick={() => { creators.refetch(); accountRevenue.refetch(); dap.refetch(); tables.forEach(t => t.refetch()); }} disabled={syncing}><RefreshCw className={syncing ? "animate-spin" : ""}/>Refresh</Btn></>}/>
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-muted-foreground">{models.rows.length} models in the roster · {mappedCount} with a selected DAP account · {selectedIds.length} selected for this report.</p>

      <section className={CARD + " flex flex-wrap gap-6 p-6"}>
        <div className="grid min-w-0 flex-[1_1_280px] gap-1.5">
          <span className="text-[13px] font-medium text-muted-foreground">Models in this P&amp;L</span>
          <ModelPicker models={pickerModels} selected={selectedIds} onChange={pick} activeIds={activeIds} focus={modelId}/>
          <span className="text-[12px] text-muted-foreground">Names and photos come from each model’s Creatorstaq DAP account.</span>
        </div>
        <div className="grid min-w-0 flex-[1_1_320px] content-start gap-1.5">
          <span className="text-[13px] font-medium text-muted-foreground">Period</span>
          <Segmented size="md" value={preset} onChange={v => { setPreset(v); if (v !== "custom") setRange(presetRange(v, today)); }}
            options={[["month", "This month"], ["last-month", "Last month"], ["7d", "7d"], ["30d", "30d"], ["custom", "Custom"]] as const}/>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            {preset === "custom" ? <span className="flex items-center gap-2">
              <input type="date" value={start} max={today} onChange={e => setRange([e.target.value, end])} className="h-8 rounded-lg border border-[var(--ink-100)] bg-card px-2 text-[12.5px] text-foreground"/>→
              <input type="date" value={end} max={today} onChange={e => setRange([start, e.target.value])} className="h-8 rounded-lg border border-[var(--ink-100)] bg-card px-2 text-[12.5px] text-foreground"/>
            </span> : <span className="num">{start} → {end}</span>}
            <span>Unassigned expenses stay outside model profit until assigned.</span>
          </div>
        </div>
      </section>

      {notices.map(([tone, text], i) => <Notice key={i} tone={tone} icon={AlertTriangle}>{text}</Notice>)}

      {showBody && combined && <>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
          <Kpi label="20MG income" icon={Banknote} value={m2(combined.income)} sub={`${reports.length} selected models · before chargebacks`}/>
          <Kpi label="Model payouts" icon={Wallet} value={neg(combined.payout)}/>
          <Kpi label="Staff wages" icon={Users} value={neg(combined.wages)}/>
          <Kpi label="Paid expenses" icon={Receipt} value={neg(combined.expenses)}/>
          <Kpi ink label="Combined net profit" icon={TrendingUp} value={m2(combined.profit)} tone={combined.profit}/>
        </div>
        <section className={CARD + " overflow-hidden"}>
          <header className="px-6 pb-4 pt-6"><h2 className="text-[18px] font-bold tracking-[-0.02em]">Selected models</h2><p className="mt-1 text-[13px] text-muted-foreground">Each row uses only that model’s mapped DAP accounts. Click a model to open its P&amp;L.</p></header>
          <div className="overflow-x-auto border-t border-[var(--ink-100)]"><div className="min-w-[900px]">
            <div className="grid h-9 grid-cols-[minmax(120px,1fr)_repeat(6,110px)] items-center gap-2 bg-[var(--ink-100)] px-5 text-[11.5px] font-medium text-muted-foreground">
              <span>Model</span>{["DAP revenue", "20MG income", "Payout", "Wages", "Expenses", "Profit"].map(h => <span key={h} className="text-right">{h}</span>)}
            </div>
            {reports.map(r => <div key={r.modelId} className="num grid min-h-11 grid-cols-[minmax(120px,1fr)_repeat(6,110px)] items-center gap-2 border-b border-[var(--ink-100)] px-5 text-[13px]">
              <button type="button" onClick={() => { setSelectedIds([r.modelId]); setModelId(r.modelId); }} className="truncate text-left font-semibold hover:underline">{r.name}</button>
              {[r.pageRevenue, r.income, r.payout, r.wages, r.expenses].map((v, i) => <span key={i} className="text-right">{m2(v)}</span>)}
              <span className="text-right font-semibold" style={{color: r.profit === null ? undefined : r.profit >= 0 ? "var(--positive-fg)" : "var(--negative-fg)"}}>{m2(r.profit)}</span>
            </div>)}
          </div></div>
        </section>
        <Notice>Wages and paid expenses linked to several models are split between them. Unassigned expenses are excluded. Revenue is transaction net before chargebacks.</Notice>
      </>}

      {showBody && !combined && p && <>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
          <Kpi label={p.dealType === "Chat-only" ? "Our chatting fee" : "Earnings"} icon={Banknote} value={m2(p.income)} sub={p.pageRevenue === null ? "DAP account revenue unavailable" : `${accountSlugs.join(", ") || "No DAP account"} · before chargebacks`}/>
          <Kpi label="Model payout" icon={Wallet} value={neg(p.payout)} sub={p.dealType === "Chat-only" ? "Not applicable" : `${p.modelCut ?? "?"}% to ${p.name}`}/>
          <Kpi label="Staff wages" icon={Users} value={neg(p.wages)} sub={`${p.byStaff.length} staff · ${money(p.unpaidWages)} unpaid`}/>
          <Kpi label="Expenses" icon={Receipt} value={neg(p.expenses)} sub={p.unpaidExpenses ? `${money(p.unpaidExpenses)} unpaid, not deducted` : "Paid expenses"}/>
          <Kpi ink label="Net profit" icon={TrendingUp} value={m2(p.profit)} tone={p.profit} sub={p.margin === null ? "—" : `${(p.margin * 100).toFixed(1)}% margin`}/>
        </div>

        {company && <section className={CARD + " p-6"}>
          <h2 className="text-[18px] font-bold tracking-[-0.02em]">Company summary</h2>
          <p className="mb-3 mt-1.5 text-[12px] text-muted-foreground">Managed models and chatting clients are separate. Unassigned paid expenses stay outside both until linked to a model.</p>
          {company.missing.length > 0 && <div className="mb-3"><Notice icon={AlertTriangle}>DAP revenue could not be verified for {company.missing.join(", ")}; company totals remain unavailable.</Notice></div>}
          {company.unknownDeals > 0 && <div className="mb-3"><Notice icon={AlertTriangle}>{company.unknownDeals} model{company.unknownDeals === 1 ? " has" : "s have"} an unknown deal type and are excluded from these sections.</Notice></div>}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
            {([["Managed models", company.managed], ["Chatting agency", company.chat]] as const).map(([title, s]) => <div key={title} className="rounded-[14px] border border-[var(--ink-100)] p-4 text-[13px]">
              <h3 className="text-[13px] font-semibold text-foreground">{title} · {s.count} models</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground">
                {([["20MG income", s.income], ["Model payouts", s.payout], ["Staff wages", s.wages], ["Paid expenses", s.expenses], ["Profit", s.profit]] as const).map(([k, v]) =>
                  <div key={k}>{k}<strong className="num block text-foreground">{m2(v)}</strong></div>)}
              </div>
            </div>)}
          </div>
          {company.unassigned > 0 && <p className="mt-3 text-[12px] text-[var(--warning-fg)]">{m2(company.unassigned)} in paid expenses is unassigned. Aggregate profit remains unavailable until these costs are allocated. <a href="/expenses" className="underline">Assign them</a></p>}
        </section>}

        {p.income !== null && <section className={CARD + " p-6"}>
          <h2 className="mb-4 text-[18px] font-bold tracking-[-0.02em]">Where the money goes</h2>
          <div className="flex flex-col gap-3">
            {([["Earnings", p.income, "var(--ink)"], ["Model payout", p.payout === null ? null : -p.payout, "var(--ink-200)"], ["Staff wages", -p.wages, "var(--signal)"], ["Expenses", -p.expenses, "#6e6a63"], ["Net profit", p.profit, (p.profit ?? 0) >= 0 ? "#1f7a45" : "#c81e1e"]] as [string, number | null, string][]).map(([name, v, c], i) => {
              const max = Math.max(1, p.income!, p.wages + p.expenses + (p.payout ?? 0));
              return <div key={name} className={cn("grid grid-cols-[110px_1fr_110px] items-center gap-4 text-[13px]", i === 4 && "border-t border-[var(--ink-100)] pt-3 font-semibold")}>
                <span className={i === 4 ? "text-foreground" : "text-muted-foreground"}>{name}</span>
                <BarRow pct={Math.abs(v ?? 0) / max * 100} color={c} h={10}/>
                <span className="num text-right">{m2(v)}</span>
              </div>;
            })}
          </div>
        </section>}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-6">
          <section className={CARD}>
            <header className="flex items-center justify-between px-6 pb-1 pt-6"><h2 className="text-[18px] font-bold tracking-[-0.02em]">Staff wages</h2><span className="num text-[13px] font-semibold">{m2(p.wages)}</span></header>
            <div className="px-6 pb-6 pt-3">
              {p.byStaff.map(s => <a key={s.id} href="/pay-hours" className="grid grid-cols-[1fr_80px_90px] items-center gap-4 border-b border-[var(--ink-100)] py-2.5 text-[13px] text-[var(--text-body)] hover:text-foreground">
                <span className="min-w-0"><span className="block truncate font-medium">{s.name}</span><span className="num text-[12px] text-muted-foreground">{+s.hours.toFixed(2)} h{s.unpaid ? ` · ${money(s.unpaid)} unpaid` : ""}</span></span>
                <BarRow pct={s.pay / (p.byStaff[0].pay || 1) * 100} color="var(--signal)"/>
                <span className="num text-right">{m2(s.pay)}</span>
              </a>)}
              {!p.byStaff.length && <div className="py-6 text-center text-[13px] text-muted-foreground">No hours logged for this model’s staff in this period.</div>}
            </div>
          </section>
          <section className={CARD}>
            <header className="flex items-center justify-between px-6 pb-1 pt-6"><h2 className="text-[18px] font-bold tracking-[-0.02em]">Expenses by category</h2><span className="num text-[13px] font-semibold">{m2(p.expenses)}</span></header>
            <div className="px-6 pb-6 pt-3">
              {p.byCategory.map(c => <a key={c.name} href="/expenses" className="grid grid-cols-[1fr_80px_90px] items-center gap-4 border-b border-[var(--ink-100)] py-2.5 text-[13px] text-[var(--text-body)]">
                <span className="truncate font-medium">{c.name}</span>
                <BarRow pct={c.amount / (p.byCategory[0].amount || 1) * 100} color="#6e6a63"/>
                <span className="num text-right">{m2(c.amount)}</span>
              </a>)}
              {!p.byCategory.length && <div className="py-6 text-center text-[13px] text-muted-foreground">Nothing paid in this period.</div>}
            </div>
          </section>
        </div>
      </>}
    </div>

    <Drawer open={managing} onClose={() => setManaging(false)} title="Manage P&L models" subtitle="Add a model, then explicitly connect only her DAP account.">
      <Field label="New model name"><div className="flex gap-2"><input className={inputClass + " flex-1"} value={newModel} onChange={e => setNewModel(e.target.value)} onKeyDown={e => e.key === "Enter" && addModel()} placeholder="Model name"/><Btn onClick={addModel} disabled={!newModel.trim() || saving}>Add</Btn></div></Field>
      <div className="grid gap-2 border-t border-[var(--ink-100)] pt-4">
        <span className="text-[13px] font-medium text-muted-foreground">Choose model</span>
        <Select value={modelId} onChange={chooseModel} ariaLabel="Choose model" options={models.rows.map(m => ({value: m.id, label: label(m.fields.model)}))}/>
        <span className="text-[12px] text-muted-foreground">Connected DAP accounts: {accountSlugs.length ? accountSlugs.join(", ") : "none"}</span>
      </div>
      <div className="grid gap-2 border-t border-[var(--ink-100)] pt-4">
        <span className="text-[13px] font-medium text-muted-foreground">Available Creatorstaq account</span>
        <Select value={newAccount || null} onChange={setNewAccount} disabled={!dap.data} placeholder="Choose the DAP account" ariaLabel="Available Creatorstaq account" searchable
          options={(dap.data ?? []).map(a => { const owner = map.rows.find(r => Number(r.fields.accountId) === a.id || label(r.fields.slug).toLowerCase() === a.slug.toLowerCase()); const other = owner && linkIds(owner.fields.model).some(id => id !== modelId);
            return {value: String(a.id), text: `${a.slug} @${a.of_username}`, label: `${a.slug} · @${a.of_username}${other ? " · assigned elsewhere" : owner && owner.fields.include !== false && linkIds(owner.fields.model).includes(modelId) ? " · connected" : ""}`, disabled: !!other}; })}/>
        {dap.isPending && <p className="text-[12px] text-muted-foreground">Loading available accounts…</p>}{dap.isError && <Notice tone="red" icon={AlertTriangle}>{(dap.error as Error).message}</Notice>}
        <Btn className="justify-self-start" onClick={connectAccount} disabled={!newAccount || !modelId || saving}><Link2/>Connect DAP account</Btn>
        <span className="text-[12px] text-muted-foreground">Only accounts available to the connected Creatorstaq key appear here. Set the model’s deal type and cut on the <a href="/revenue" className="underline">Revenue page</a>.</span>
      </div>
      <div className="grid gap-1.5 border-t border-[var(--ink-100)] pt-4"><span className="text-[12px] font-medium">Current roster</span>
        {models.rows.map(m => <button key={m.id} type="button" onClick={() => chooseModel(m.id)} className="flex justify-between rounded-[10px] border border-[var(--ink-100)] px-3 py-2 text-left text-[13px] hover:bg-[var(--ink-100)]"><span>{label(m.fields.model)}</span><span className="text-muted-foreground">{map.rows.filter(r => r.fields.include !== false && linkIds(r.fields.model).includes(m.id)).length} DAP accounts</span></button>)}</div>
    </Drawer>
  </div>;
}
