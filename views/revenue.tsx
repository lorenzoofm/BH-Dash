"use client";
import {useEffect, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {AlertTriangle, Banknote, CalendarDays, Link2, Plus, Trash2, TrendingUp, Trophy} from "lucide-react";
import {TableError, Btn, Drawer, Field, Notice, PageHeader, PageSkeleton, Panel, Stat, inputClass} from "@/components/bh/ui";
import {Select} from "@/components/bh/menu";
import {toast} from "@/components/bh/toast";
import {cn} from "@/lib/utils";
import {label, linkIds, money, num, todayIso} from "@/lib/bh";
import {completeDapMonth} from "@/lib/finance";
import {useProxyFetch} from "@/lib/datasource";
import {CHOICES, linkOptions, opts, useAccountRevenues, useCreators, useDapAccounts, useModels, useTable} from "@/lib/tables";

const MONTHLY = "https://api.creatorstaq.com/v1/computed/revenue/monthly?months=12";
const COLORS = ["var(--text-heading)", "#ff3000", "#6e6a63", "#2166c9", "#0f7b76", "#8a3cb8", "#b8327a", "#c9c4bb"];
const STATUS_TONE: Record<string, string> = {Active: "bg-positive-soft text-[var(--positive-fg)]", Paused: "bg-warning-soft text-[var(--warning-fg)]", Ended: "bg-negative-soft text-[var(--negative-fg)]"};
const DEAL_TONE: Record<string, string> = {Managed: "bg-positive-soft text-[var(--positive-fg)]", "Chat-only": "bg-brand-soft text-[var(--signal-tint-fg)]"};
const DEALS = "grid grid-cols-[minmax(120px,1fr)_110px_120px_120px_110px_minmax(200px,1.4fr)_140px_76px] items-center gap-2 px-5";
const PAGES = "grid grid-cols-[minmax(140px,1fr)_110px_minmax(130px,1fr)_150px_130px_120px] items-center gap-2 px-5";
const HEAD = "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "min-h-11 border-b py-0.5 text-[13px] hover:bg-muted/30";
const ghost = "h-8 w-full rounded-[6px] border border-transparent bg-transparent text-[13px] outline-none hover:border-[var(--ink-100)] focus:border-[var(--signal)] focus:bg-card";
type Row = {id: string; fields: Record<string, any>};

// Rows with pending edits laid over them, so a change shows at once and rolls back if the write fails.
function useOptimistic(table: {rows: Row[]; update: (id: string, f: Record<string, any>) => Promise<unknown>}) {
  const [over, setOver] = useState<Record<string, Record<string, any>>>({});
  const rows = table.rows.map(r => over[r.id] ? {...r, fields: {...r.fields, ...over[r.id]}} : r);
  const save = async (id: string, fields: Record<string, any>, done: string, shown = fields) => {
    setOver(o => ({...o, [id]: {...o[id], ...shown}}));
    try { await table.update(id, fields); toast(done); } catch (e: any) { toast.error(e.message); }
    finally { setOver(o => { const {[id]: _, ...rest} = o; return rest; }); }
  };
  return {rows, save};
}

export default function Revenue() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const models = useModels(), map = useTable("map");
  const m = useOptimistic(models), p = useOptimistic(map);
  const proxyFetch = useProxyFetch("live");
  const monthly = useQuery({queryKey: ["bh-monthly"], staleTime: 300000, retry: 1, queryFn: async () => {
    const res = await proxyFetch(MONTHLY);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Creator Staq returned ${res.status}`);
    return (body.monthly_by_account ?? []) as {month: string; accounts: {account_id: number; name: string; net: number | string}[]}[];
  }});
  const mtd = useCreators(today ? today.slice(0, 8) + "01" : null, today);
  const dap = useDapAccounts();
  const inKey = new Set((dap.data ?? []).map(a => a.slug.toLowerCase()));
  const liveIds = new Set(m.rows.filter(r => label(r.fields.status) !== "Ended").map(r => r.id));
  const dapRows = p.rows.filter(r => r.fields.include !== false && inKey.has(label(r.fields.slug).toLowerCase()) && linkIds(r.fields.model).some(id => liveIds.has(id)));
  const dapSlugs = [...new Set(dapRows.map(r => label(r.fields.slug).toLowerCase()))];
  // Every readable page, so the pages table can show this month for excluded pages too.
  const readable = [...new Set(p.rows.map(r => label(r.fields.slug).toLowerCase()).filter(s => inKey.has(s)))];
  const accountRevenue = useAccountRevenues(readable, today ? today.slice(0, 8) + "01" : null, today);
  const revenue = !dap.isSuccess || (dapSlugs.length > 0 && !accountRevenue.isSuccess) || dapSlugs.some(slug => accountRevenue.data?.[slug]?.net == null) ? null : dapSlugs.reduce((sum, slug) => sum + accountRevenue.data![slug].net!, 0);
  const [addingAccount, setAddingAccount] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  if ([models, map].some(t => t.error)) return <TableError tables={[models, map]}/>;
  if (!today || models.loading || map.loading) return <PageSkeleton/>;

  const pageModel = new Map(dapRows.map(r => [String(r.fields.accountId), linkIds(r.fields.model)[0]]));
  const modelName = new Map(m.rows.map(r => [r.id, label(r.fields.model)]));
  const shown = [...new Set([...pageModel.values()].filter(Boolean))] as string[];
  const chart = (monthly.data ?? []).map(mo => {
    const row = {month: mo.month.slice(0, 7), total: 0, by: {} as Record<string, number>};
    for (const a of mo.accounts) {
      const mid = pageModel.get(String(a.account_id));
      if (!mid) continue;
      row.by[mid] = (row.by[mid] ?? 0) + num(a.net);
      row.total += num(a.net);
    }
    return row;
  }).sort((a, b) => a.month.localeCompare(b.month));
  const thisMonth = today.slice(0, 7);
  const full = chart.filter(r => r.month !== thisMonth);
  const last = full.at(-1), prev = full.at(-2);
  const dapIds = dapRows.map(r => String(r.fields.accountId));
  const completeMonth = (month: string | undefined) => !!month && completeDapMonth(dapIds, monthly.data?.find(mo => mo.month.slice(0, 7) === month)?.accounts);
  const fullComplete = full.length > 0 && full.every(r => completeMonth(r.month));
  const best = [...full].sort((a, b) => b.total - a.total)[0];
  const activeNames = m.rows.filter(r => label(r.fields.status) !== "Ended").map(r => label(r.fields.model).toLowerCase());
  const unlinked = (mtd.data ?? []).filter(c => !activeNames.includes(c.name.trim().toLowerCase()));
  const lastOk = dap.isSuccess && completeMonth(last?.month);
  const delta = lastOk && completeMonth(prev?.month) ? Math.round(last!.total - prev!.total) : null;
  const nice = Math.ceil(Math.max(1, ...chart.map(r => r.total)) / 5000) * 5000;
  const ticks = [4, 3, 2, 1, 0].map(k => { const v = nice * k / 4; return v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`; });
  const fmtMonth = (mo: string) => new Date(mo + "-01T00:00:00Z").toLocaleDateString("en-GB", {month: "short", year: "2-digit", timeZone: "UTC"});
  const modelOptions = linkOptions(m.rows, "model");
  const edit = (r: Row, key: string, value: any) => m.save(r.id, {[key]: value}, `${label(r.fields.model)} · saved`);

  return <div className="space-y-6">
    <PageHeader eyebrow="Finance" title="Revenue" subtitle="DAP account assignments, model deals and available account-level history."
/>

    {(monthly.isError || mtd.isError) && <Notice tone="red" icon={AlertTriangle}>Creator Staq is unavailable: {((monthly.error ?? mtd.error) as Error).message}</Notice>}
    {(dap.isError || accountRevenue.isError || (accountRevenue.isSuccess && dapSlugs.some(slug => accountRevenue.data?.[slug]?.net == null))) && <Notice tone="red" icon={AlertTriangle}>DAP account revenue could not be verified. Current revenue remains unavailable.</Notice>}

    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <Stat accent label="This month so far" icon={Banknote} value={money(revenue)} sub="Included DAP accounts"/>
      <Stat label="Last full month" icon={CalendarDays} value={lastOk ? money(last!.total) : "—"}
        sub={<>{delta != null && <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", delta > 0 ? "bg-positive-soft text-[var(--positive-fg)]" : "bg-negative-soft text-[var(--negative-fg)]")}>{delta > 0 ? "↗ " : "↘ "}{money(Math.abs(delta))} vs prior</span>}{last ? fmtMonth(last.month) : ""}</>}/>
      <Stat label="Last 6 months" icon={TrendingUp} value={dap.isSuccess && monthly.isSuccess && fullComplete && chart.length > 0 ? money(full.slice(-6).reduce((s, r) => s + r.total, 0)) : "—"} sub="Full months only"/>
      <Stat label="Best month" icon={Trophy} value={dap.isSuccess && fullComplete && best ? money(best.total) : "—"} sub={best ? fmtMonth(best.month) : undefined}/>
    </div>

    <Panel title="Monthly net revenue" subtitle="Last 12 months, account-level history for included DAP accounts. This month is month to date.">
      {monthly.isPending ? <div className="h-[280px] animate-pulse rounded-lg bg-muted"/> : !chart.some(r => r.total) ? <Notice icon={Link2}>Creator Staq returned no account-level monthly revenue history for the selected key.</Notice> : <>
        <div className="grid h-[280px] grid-cols-[52px_1fr]">
          <div className="flex flex-col justify-between pb-7 font-mono text-[11px] text-muted-foreground">{ticks.map(t => <span key={t} className="num">{t}</span>)}</div>
          <div className="grid gap-2.5" style={{gridTemplateColumns: `repeat(${chart.length},1fr)`}}>
            {chart.map(r => <div key={r.month} className="flex min-w-0 flex-col justify-end">
              <div title={`${fmtMonth(r.month)} · ${money(r.total)}${r.month === thisMonth ? " (month to date)" : ""}`} className="flex flex-col-reverse overflow-hidden rounded-t-[5px]" style={{height: `${r.total / nice * 100}%`, opacity: r.month === thisMonth ? .55 : 1}}>
                {shown.map((id, i) => <div key={id} title={`${modelName.get(id) ?? "Model"}: ${money(r.by[id] ?? 0)}`} style={{height: `${r.total ? (r.by[id] ?? 0) / r.total * 100 : 0}%`, background: COLORS[i % COLORS.length]}}/>)}
              </div>
              <div className="h-7 overflow-hidden whitespace-nowrap pt-2.5 text-center font-mono text-[10.5px] text-muted-foreground">{fmtMonth(r.month)}</div>
            </div>)}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-3">
          {shown.map((id, i) => <span key={id} className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><span className="size-2 rounded-[2px]" style={{background: COLORS[i % COLORS.length]}}/>{modelName.get(id) ?? "Model"}</span>)}
        </div>
      </>}
    </Panel>

    {(() => {
      // Deleting removes the model, its Creatorstaq page links and its links on staff, expenses and conversions.
      const remove = async (r: Row) => { setConfirmDel(null); try { await models.remove(r.id); toast(`${label(r.fields.model) || "Model"} deleted`); } catch (e: any) { toast.error(e.message); } };
      const del = (r: Row) => confirmDel === r.id
        ? <button type="button" onClick={() => remove(r)} onBlur={() => setConfirmDel(null)} autoFocus className="h-7 rounded-full bg-[#f4dad7] px-3 text-[12px] font-semibold text-[var(--negative-fg)]">Delete</button>
        : <button type="button" onClick={() => setConfirmDel(r.id)} aria-label={`Delete ${label(r.fields.model)}`} title="Delete model" className="grid size-8 place-items-center rounded-[8px] text-[var(--text-faint)] hover:bg-[#f4dad7] hover:text-[var(--negative-fg)]"><Trash2 className="size-4"/></button>;
      const gone = models.all.filter(r => !m.rows.some(x => x.id === r.id));
      return <>
    <TableCard title="Model deals" subtitle="Managed: we keep page revenue and pay the model her cut. Chat-only: we earn our cut of page revenue." minWidth={1040}>
      <div className={cn(DEALS, HEAD)}><span>Model</span><span>Status</span><span>Deal</span><span className="text-right">Model’s cut %</span><span className="text-right">Our cut %</span><span>Payout basis</span><span>Started</span><span/></div>
      {[...m.rows].sort((a, b) => label(a.fields.model).localeCompare(label(b.fields.model))).map(r => {
        const status = label(r.fields.status), deal = label(r.fields.dealType);
        return <div key={r.id} className={cn(DEALS, ROW)}>
          <EditInput value={label(r.fields.model)} onCommit={v => v.trim() && edit(r, "model", v.trim())} className={ghost + " px-1.5 font-medium"} aria-label="Model name"/>
          <Select variant="pill" value={status} options={opts(CHOICES.modelStatus)} onChange={v => edit(r, "status", v)} className={cn("h-[26px] w-max px-2 text-[11px]", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")} ariaLabel="Status"/>
          <Select variant="pill" value={deal} options={[{value: "", label: "—"}, ...opts(CHOICES.dealType)]} onChange={v => edit(r, "dealType", v || null)} className={cn("h-[26px] w-max px-2 text-[11px]", DEAL_TONE[deal] ?? "bg-muted text-muted-foreground")} ariaLabel="Deal"/>
          <EditInput type="number" min="0" max="100" placeholder="—" value={r.fields.modelCut ?? ""} onCommit={v => cut(v, x => edit(r, "modelCut", x))} className={ghost + " num px-2 text-right"} aria-label="Model’s cut %"/>
          <EditInput type="number" min="0" max="100" placeholder="—" value={r.fields.ourCut ?? ""} onCommit={v => cut(v, x => edit(r, "ourCut", x))} className={ghost + " num px-2 text-right"} aria-label="Our cut %"/>
          <Select variant="cell" value={label(r.fields.basis) || null} options={opts(CHOICES.basis)} onChange={v => edit(r, "basis", v)} className="max-w-full px-1 text-[12.5px]" ariaLabel="Payout basis"/>
          <EditInput type="date" value={r.fields.start ?? ""} onCommit={v => edit(r, "start", v || null)} className={ghost + " num px-1 text-[12.5px]"} aria-label="Started"/>
          <span className="flex justify-end">{del(r)}</span>
        </div>;
      })}
    </TableCard>
    {gone.length > 0 && <Panel title="Not in Creatorstaq" subtitle="These models aren't linked to any account Creatorstaq lists, so they're hidden everywhere. Delete them to remove them for good.">
      <div className="flex flex-wrap gap-2">{gone.map(r => <span key={r.id} className="inline-flex h-9 items-center gap-2 rounded-full border pl-3.5 pr-1 text-[13px] font-medium">{label(r.fields.model) || "Untitled"}{del(r)}</span>)}</div>
    </Panel>}
      </>;
    })()}

    <TableCard title="Creator Staq pages" subtitle="Assign only each model’s DAP account here. Turn off DAP account for her other accounts." minWidth={880}
      actions={<Btn size="sm" onClick={() => setAddingAccount(true)}><Plus className="!size-3.5"/>Add account</Btn>}
      footer={unlinked.length > 0 && <div className="border-t px-5 py-3 text-[12.5px] text-muted-foreground">Creator Staq names not matched to a model this month: {unlinked.map(c => `${c.name} (${money(c.net)})`).join(" · ")}</div>}>
      <div className={cn(PAGES, HEAD)}><span>Page</span><span>Account ID</span><span>OF username</span><span>Model</span><span className="text-right">This month</span><span className="text-center">DAP account</span></div>
      {p.rows.filter(r => !dap.data || inKey.has(label(r.fields.slug).toLowerCase())).sort((a, b) => label(a.fields.slug).localeCompare(label(b.fields.slug))).map(r => {
        const slug = label(r.fields.slug), on = r.fields.include !== false, net = accountRevenue.data?.[slug.toLowerCase()]?.net, of = label(r.fields.ofUsername);
        return <div key={r.id} className={cn(PAGES, ROW)}>
          <span className="font-medium">{slug}</span>
          <span className="num text-muted-foreground">{String(r.fields.accountId ?? "")}</span>
          <span className="text-muted-foreground">{of ? "@" + of : "—"}</span>
          <Select variant="cell" value={linkIds(r.fields.model)[0] ?? null} options={modelOptions} placeholder="Choose model" className="px-1" ariaLabel={`Model for ${slug}`}
            onChange={v => { const name = modelName.get(v) ?? "model"; p.save(r.id, {model: [v]}, `${slug} assigned to ${name}`, {model: [{id: v, label: name}]}); }}/>
          <span className={cn("num text-right", on ? "text-foreground" : "text-muted-foreground")}>{money(net ?? null)}</span>
          <div className="flex justify-center"><Toggle on={on} label={`${slug} DAP account`} onClick={() => p.save(r.id, {include: !on}, `${slug} ${on ? "excluded from" : "included in"} DAP revenue`)}/></div>
        </div>;
      })}
    </TableCard>

    <AddAccount open={addingAccount} onClose={() => setAddingAccount(false)} create={map.create} models={m.rows} existing={p.rows}/>
  </div>;
}

function cut(v: string, save: (x: number | null) => void) {
  if (v === "") return save(null);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return toast.error("Enter a percentage from 0 to 100");
  save(n);
}

// Looks like text until hovered or focused; saves on blur or Enter, Esc reverts.
function EditInput({value, onCommit, ...props}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> & {value: string | number; onCommit: (v: string) => void}) {
  return <input key={String(value)} defaultValue={value} {...props}
    onBlur={e => { if (e.target.value !== String(value)) onCommit(e.target.value); }}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = String(value); e.currentTarget.blur(); } }}/>;
}

function Toggle({on, onClick, label}: {on: boolean; onClick: () => void; label: string}) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
    className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur-fast)]", on ? "bg-surface-inverse" : "bg-muted ring-1 ring-inset ring-[var(--border-subtle)]")}>
    <span className={cn("absolute top-0.5 size-4 rounded-full transition-[left] duration-200 ease-[cubic-bezier(.2,.8,.2,1)]", on ? "left-[18px] bg-card" : "left-0.5 bg-muted-foreground/70")}/>
  </button>;
}

function TableCard({title, subtitle, actions, minWidth, children, footer}: {title: string; subtitle: string; actions?: React.ReactNode; minWidth: number; children: React.ReactNode; footer?: React.ReactNode}) {
  return <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--edge-card)] bg-card shadow-[var(--shadow-card)]">
    <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-6">
      <div><h2 className="text-[18px] font-bold tracking-[-0.02em] text-[var(--text-heading)]">{title}</h2><p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p></div>
      {actions}
    </header>
    <div className="overflow-x-auto border-t"><div style={{minWidth}}>{children}</div></div>
    {footer}
  </section>;
}

function AddAccount({open, onClose, create, models, existing}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>; models: Row[]; existing: Row[]}) {
  const [slug, setSlug] = useState("");
  const [accountId, setAccountId] = useState("");
  const [of, setOf] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSlug(""); setAccountId(""); setOf(""); setModelId(""); } }, [open]);
  async function submit() {
    const id = Number(accountId);
    if (!/^[a-z0-9_-]+$/i.test(slug.trim()) || !Number.isSafeInteger(id) || id <= 0 || !modelId) return toast.error("Enter an account slug, numeric ID and model");
    if (existing.some(r => label(r.fields.slug).toLowerCase() === slug.trim().toLowerCase() || Number(r.fields.accountId) === id)) return toast.error("This account is already mapped");
    setBusy(true);
    try { await create({slug: slug.trim(), accountId: id, ofUsername: of.trim().replace(/^@/, "") || slug.trim(), model: [modelId], include: true}); toast("Account added"); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Add DAP account" subtitle="Use the exact account slug and ID from Creatorstaq. Only selected DAP accounts count in account-level reports."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Add account</Btn></>}>
    <div className="flex flex-col gap-4">
      <Field label="Creatorstaq account slug"><input className={inputClass} value={slug} onChange={e => setSlug(e.target.value)} placeholder="irlapril"/></Field>
      <Field label="Account ID"><input className={inputClass} type="number" min="1" step="1" value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="329"/></Field>
      <Field label="OF username"><input className={inputClass} value={of} onChange={e => setOf(e.target.value)} placeholder="username"/></Field>
      <Field label="Model"><Select value={modelId || null} options={linkOptions(models, "model")} onChange={setModelId} placeholder="Choose model" ariaLabel="Model"/></Field>
    </div>
  </Drawer>;
}

