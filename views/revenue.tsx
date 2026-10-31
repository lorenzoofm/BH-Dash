"use client";
import {useEffect, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {AlertTriangle, Banknote, CalendarDays, Link2, RefreshCw, Trash2, TrendingUp, Trophy} from "lucide-react";
import {TableError, Btn, Notice, PageHeader, PageSkeleton, Panel, Stat} from "@/components/bh/ui";
import {Select} from "@/components/bh/menu";
import {toast} from "@/components/bh/toast";
import {cn} from "@/lib/utils";
import {label, linkIds, money, todayIso} from "@/lib/bh";
import {accountRows, isLinked, monthlyHistory, newAccounts} from "@/lib/finance";
import {useProxyFetch, useSession} from "@/lib/datasource";
import {CHOICES, linkOptions, opts, syncAccounts, useAccountRevenues, useDapAccounts, useModels, useTable} from "@/lib/tables";

const MONTHLY = "https://api.creatorstaq.com/v1/computed/revenue/monthly?months=12";
const COLORS = ["var(--text-heading)", "#ff3000", "#6e6a63", "#2166c9", "#0f7b76", "#8a3cb8", "#b8327a", "#c9c4bb"];
const STATUS_TONE: Record<string, string> = {Active: "bg-positive-soft text-[var(--positive-fg)]", Paused: "bg-warning-soft text-[var(--warning-fg)]", Ended: "bg-negative-soft text-[var(--negative-fg)]"};
const DEAL_TONE: Record<string, string> = {Managed: "bg-positive-soft text-[var(--positive-fg)]", "Chat-only": "bg-brand-soft text-[var(--signal-tint-fg)]"};
const GRID = "grid grid-cols-[minmax(130px,1fr)_minmax(300px,2.2fr)_92px_100px_60px_60px_minmax(120px,1fr)_116px] items-start gap-2 px-5";
const ACC = "grid grid-cols-[minmax(100px,1fr)_68px_40px_100px] items-center gap-2";
const HEAD = "h-9 items-center bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "border-b py-2 text-[13px] hover:bg-muted/30";
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
  const models = useModels(), map = useTable("map"), session = useSession();
  const m = useOptimistic(models), p = useOptimistic(map);
  const proxyFetch = useProxyFetch("live");
  const monthly = useQuery({queryKey: ["bh-monthly"], staleTime: 300000, retry: 1, queryFn: async () => {
    const res = await proxyFetch(MONTHLY);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Creator Staq returned ${res.status}`);
    return body.monthly_by_account as {month?: string; accounts?: Record<string, any>[] | null}[];
  }});
  const dap = useDapAccounts();
  const accounts = dap.data ?? [];
  // One row per Creatorstaq account linked to a model (Creatorstaq's id and slug); counted = switched on and model not Ended.
  const linked = accountRows(accounts, p.rows);
  const liveIds = new Set(m.rows.filter(r => label(r.fields.status) !== "Ended").map(r => r.id));
  const dapRows = linked.filter(r => r.fields.include !== false && linkIds(r.fields.model).some(id => liveIds.has(id)));
  const dapSlugs = dapRows.map(r => label(r.fields.slug));
  const accountRevenue = useAccountRevenues(linked.map(r => label(r.fields.slug)), today ? today.slice(0, 8) + "01" : null, today);
  const failed = accountRevenue.isSuccess ? dapSlugs.filter(slug => accountRevenue.data[slug]?.net == null) : [];
  const none = dap.isSuccess && dapRows.length === 0;
  const revenue = none ? 0 : !dap.isSuccess || !accountRevenue.isSuccess || failed.length ? null : dapSlugs.reduce((sum, slug) => sum + accountRevenue.data![slug].net!, 0);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if ([models, map].some(t => t.error)) return <TableError tables={[models, map]}/>;
  if (!today || models.loading || map.loading) return <PageSkeleton/>;

  const modelName = new Map(models.all.map(r => [r.id, label(r.fields.model)]));
  const shown = [...new Set(dapRows.map(r => linkIds(r.fields.model)[0]).filter(Boolean))];
  // The agency monthly endpoint lists finished months only; the chart and stats use those months.
  const {chart, missing, why} = monthlyHistory(monthly.data ?? [], dapRows, today.slice(0, 7));
  // Why the history stats are blank, shown in place of a bare dash.
  const blank = monthly.isError ? `Creatorstaq error: ${(monthly.error as Error).message}` : dap.isError ? `Creatorstaq account list error: ${(dap.error as Error).message}`
    : monthly.isPending || dap.isPending ? "Loading…" : why;
  const full = blank ? [] : chart;
  const last = full.at(-1), prev = full.at(-2);
  const best = [...full].sort((a, b) => b.total - a.total)[0];
  const delta = last && prev ? Math.round(last.total - prev.total) : null;
  const nice = Math.ceil(Math.max(1, ...chart.map(r => r.total)) / 5000) * 5000;
  const ticks = [4, 3, 2, 1, 0].map(k => { const v = nice * k / 4; return v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`; });
  const fmtMonth = (mo: string) => new Date(mo + "-01T00:00:00Z").toLocaleDateString("en-GB", {month: "short", year: "2-digit", timeZone: "UTC"});
  const edit = (r: Row, key: string, value: any) => m.save(r.id, {[key]: value}, `${label(r.fields.model)} · saved`);
  const isAdmin = !!(session.data as any)?.isAdmin;
  // Deleted accounts keep their Model Accounts row with no model, so Sync never brings them back.
  const deleted = accounts.flatMap(a => { const r = p.rows.find(r => isLinked(r, a)); return r && !linkIds(r.fields.model).length ? [{a, r}] : []; });
  const moveOptions = linkOptions(models.all, "model");
  const fresh = newAccounts(accounts, p.rows).length;

  const run = async (job: () => Promise<string>) => { setBusy(true); try { toast(await job()); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const sync = () => run(async () => { const n = await syncAccounts(accounts, map.rows, models.create, map.create); return n ? `${n} new account${n === 1 ? "" : "s"} added` : "Already up to date"; });
  const restore = (a: {slug: string; of_username: string}, r: Row) => run(async () => {
    const model = await models.create({model: a.of_username || a.slug});
    await map.update(r.id, {model: [model.id], include: true});
    return `${a.slug} restored`;
  });
  // Deleting a model unlinks its accounts (they stay deleted) and removes its links on staff, expenses and conversions.
  const remove = async (r: Row) => { setConfirmDel(null); try { await models.remove(r.id); toast(`${label(r.fields.model) || "Model"} deleted`); } catch (e: any) { toast.error(e.message); } };
  const del = (r: Row) => confirmDel === r.id
    ? <button type="button" onClick={() => remove(r)} onBlur={() => setConfirmDel(null)} autoFocus title="Deletes the model; its accounts stay out of revenue and Sync won't add them back" className="h-7 rounded-full bg-[#f4dad7] px-3 text-[12px] font-semibold text-[var(--negative-fg)]">Delete</button>
    : <button type="button" onClick={() => setConfirmDel(r.id)} aria-label={`Delete ${label(r.fields.model)}`} title="Delete model" className="grid size-8 place-items-center rounded-[8px] text-[var(--text-faint)] hover:bg-[#f4dad7] hover:text-[var(--negative-fg)]"><Trash2 className="size-4"/></button>;
  const gone = models.all.filter(r => !m.rows.some(x => x.id === r.id));

  return <div className="space-y-6">
    <PageHeader eyebrow="Finance" title="Revenue" subtitle="Creatorstaq accounts, model deals and which accounts count toward revenue and P&L."/>

    {monthly.isError && <Notice tone="red" icon={AlertTriangle}>Creator Staq monthly history is unavailable: {(monthly.error as Error).message}</Notice>}
    {dap.isError && <Notice tone="red" icon={AlertTriangle}>The Creatorstaq account list could not be loaded: {(dap.error as Error).message}</Notice>}
    {failed.length > 0 && <Notice tone="red" icon={AlertTriangle}>This month couldn’t be read for {failed.join(", ")}. Try again later, or switch those accounts off below.</Notice>}
    {none && <Notice icon={AlertTriangle}>No accounts are switched on, so revenue counts as $0 here and on P&L and Overview. Switch on the accounts that should count in the table below.</Notice>}

    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <Stat accent label="This month so far" icon={Banknote} value={money(revenue)} sub={none ? "No accounts counted" : `${dapRows.length} counted account${dapRows.length === 1 ? "" : "s"}`}/>
      <Stat label="Last full month" icon={CalendarDays} value={last ? money(last.total) : "—"}
        sub={blank ?? <>{!!delta && <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", delta > 0 ? "bg-positive-soft text-[var(--positive-fg)]" : "bg-negative-soft text-[var(--negative-fg)]")}>{delta > 0 ? "↗ " : "↘ "}{money(Math.abs(delta))} vs prior</span>}{last ? fmtMonth(last.month) : ""}</>}/>
      <Stat label="Last 6 months" icon={TrendingUp} value={full.length ? money(full.slice(-6).reduce((s, r) => s + r.total, 0)) : "—"} sub={blank ?? "Full months only"}/>
      <Stat label="Best month" icon={Trophy} value={best ? money(best.total) : "—"} sub={blank ?? (best && fmtMonth(best.month))}/>
    </div>

    <Panel title="Monthly net revenue" subtitle="Finished months, counted accounts only.">
      {blank === "Loading…" ? <div className="h-[280px] animate-pulse rounded-lg bg-muted"/> : blank ? <Notice icon={Link2}>{blank}.</Notice> : <>
        {missing.length > 0 && <p className="mb-3 text-[12.5px] text-muted-foreground">No finished-month history yet for {missing.join(", ")}; counted as $0 until Creatorstaq lists them.</p>}
        <div className="grid h-[280px] grid-cols-[52px_1fr]">
          <div className="flex flex-col justify-between pb-7 font-mono text-[11px] text-muted-foreground">{ticks.map(t => <span key={t} className="num">{t}</span>)}</div>
          <div className="grid gap-2.5" style={{gridTemplateColumns: `repeat(${chart.length},1fr)`}}>
            {chart.map(r => <div key={r.month} className="flex min-w-0 flex-col justify-end">
              <div title={`${fmtMonth(r.month)} · ${money(r.total)}`} className="flex flex-col-reverse overflow-hidden rounded-t-[5px]" style={{height: `${r.total / nice * 100}%`}}>
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

    <TableCard title="Models & accounts" subtitle="Synced from Creatorstaq. Switch on the accounts that count toward revenue and P&L. Managed: we keep page revenue and pay the model her cut. Chat-only: we earn our cut." minWidth={1060}
      actions={isAdmin && <Btn size="sm" onClick={sync} loading={busy} disabled={!dap.isSuccess}><RefreshCw className="!size-3.5"/>Sync from Creatorstaq{fresh ? ` (${fresh} new)` : ""}</Btn>}
      footer={deleted.length > 0 && <details className="border-t px-5 py-3 text-[12.5px]">
        <summary className="cursor-pointer text-muted-foreground">Deleted accounts ({deleted.length})</summary>
        <div className="mt-2 flex flex-wrap gap-2">{deleted.map(({a, r}) => <span key={a.id} className="inline-flex h-8 items-center gap-2 rounded-full border pl-3 pr-1">{a.slug}{a.of_username && <span className="text-muted-foreground">@{a.of_username}</span>}
          {isAdmin && <Btn size="sm" variant="ghost" onClick={() => restore(a, r)} disabled={busy}>Restore</Btn>}</span>)}</div>
      </details>}>
      <div className={cn(GRID, HEAD)}><span>Model</span><div className={ACC}><span>Account</span><span className="text-right">This month</span><span>Counts</span><span>Model</span></div><span>Status</span><span>Deal</span><span className="text-right">Model %</span><span className="text-right">Our %</span><span>Payout basis</span><span>Started</span></div>
      {[...m.rows].sort((a, b) => label(a.fields.model).localeCompare(label(b.fields.model))).map(r => {
        const status = label(r.fields.status), deal = label(r.fields.dealType);
        const own = linked.filter(x => linkIds(x.fields.model)[0] === r.id);
        return <div key={r.id} className={cn(GRID, ROW)}>
          <span className="flex min-w-0 items-center gap-1"><EditInput value={label(r.fields.model)} onCommit={v => v.trim() && edit(r, "model", v.trim())} className={ghost + " min-w-0 flex-1 px-1.5 font-medium"} aria-label="Model name"/>{del(r)}</span>
          <div className="grid gap-1">{own.map(x => {
            const slug = label(x.fields.slug), on = x.fields.include !== false, net = accountRevenue.data?.[slug]?.net, of = label(x.fields.ofUsername);
            return <div key={x.id} className={ACC}>
              <span className="min-w-0 truncate"><span className="font-medium">{slug}</span> <span className="text-muted-foreground">{of ? "@" + of : ""}</span></span>
              <span className={cn("num text-right", on ? "text-foreground" : "text-muted-foreground")}>{money(net ?? null)}</span>
              <Toggle on={on} label={`${slug} counts toward revenue`} onClick={() => p.save(x.id, {include: !on}, `${slug} ${on ? "no longer counts" : "now counts"} toward revenue`)}/>
              <Select variant="cell" value={r.id} options={moveOptions} className="px-1 text-[12.5px]" ariaLabel={`Model for ${slug}`} searchable
                onChange={v => { if (v === r.id) return; const name = modelName.get(v) ?? "model"; p.save(x.id, {model: [v]}, `${slug} moved to ${name}`, {model: [{id: v, label: name}]}); }}/>
            </div>;
          })}</div>
          <Select variant="pill" value={status} options={opts(CHOICES.modelStatus)} onChange={v => edit(r, "status", v)} className={cn("h-[26px] w-max px-2 text-[11px]", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")} ariaLabel="Status"/>
          <Select variant="pill" value={deal} options={[{value: "", label: "—"}, ...opts(CHOICES.dealType)]} onChange={v => edit(r, "dealType", v || null)} className={cn("h-[26px] w-max px-2 text-[11px]", DEAL_TONE[deal] ?? "bg-muted text-muted-foreground")} ariaLabel="Deal"/>
          <EditInput type="number" min="0" max="100" placeholder="—" value={r.fields.modelCut ?? ""} onCommit={v => cut(v, x => edit(r, "modelCut", x))} className={ghost + " num px-2 text-right"} aria-label="Model’s cut %"/>
          <EditInput type="number" min="0" max="100" placeholder="—" value={r.fields.ourCut ?? ""} onCommit={v => cut(v, x => edit(r, "ourCut", x))} className={ghost + " num px-2 text-right"} aria-label="Our cut %"/>
          <Select variant="cell" value={label(r.fields.basis) || null} options={opts(CHOICES.basis)} onChange={v => edit(r, "basis", v)} className="max-w-full px-1 text-[12.5px]" ariaLabel="Payout basis"/>
          <EditInput type="date" value={r.fields.start ?? ""} onCommit={v => edit(r, "start", v || null)} className={ghost + " num px-1 text-[12.5px]"} aria-label="Started"/>
        </div>;
      })}
    </TableCard>

    {gone.length > 0 && <Panel title="Not in Creatorstaq" subtitle="These models have no Creatorstaq account linked (for example after you moved their accounts), so they're hidden everywhere. Delete them to remove them for good.">
      <div className="flex flex-wrap gap-2">{gone.map(r => <span key={r.id} className="inline-flex h-9 items-center gap-2 rounded-full border pl-3.5 pr-1 text-[13px] font-medium">{label(r.fields.model) || "Untitled"}{del(r)}</span>)}</div>
    </Panel>}
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
