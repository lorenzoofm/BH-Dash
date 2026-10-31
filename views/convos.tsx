"use client";
import {useEffect, useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {MessagesSquare} from "lucide-react";
import {ModelAvatar, Notice, PageHeader, PageSkeleton, Panel, Skeleton, Stat, TableError, WeekStepper} from "@/components/bh/ui";
import {toast} from "@/components/bh/toast";
import {cn} from "@/lib/utils";
import {label, linkIds} from "@/lib/bh";
import {useSession} from "@/lib/datasource";
import {useTable} from "@/lib/tables";
import {APP_LABEL, appOfSource, CUPID_APPS, type CupidApp, cupidIds, formatCupidIds, type Funnel, monthRange, ratio, shiftMonth} from "@/lib/convos";

type Subs = {newSubs: number | null; counted: number; bySource: Record<string, number>; capped: boolean};
const HEAD = "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "min-h-12 border-b py-1.5 text-[13px] last:border-b-0";
const PLAT = "grid grid-cols-[minmax(110px,1fr)_repeat(6,minmax(84px,110px))] items-center gap-2 px-6";
const MODEL = "grid grid-cols-[minmax(170px,1.4fr)_190px_repeat(5,minmax(84px,110px))] items-center gap-2 px-6";
const n = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("en-US");
const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const sumOf = (xs: (number | null | undefined)[]) => xs.some(x => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null;

async function get<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch("/api/convos?" + new URLSearchParams(params));
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export default function Convos() {
  const [month, setMonth] = useState<string | null>(null);
  const [now, setNow] = useState("");
  useEffect(() => { const m = new Date().toISOString().slice(0, 7); setNow(m); setMonth(m); }, []);
  const session = useSession(), admin = !!(session.data as any)?.isAdmin;
  const models = useTable("models"), map = useTable("map");
  const live = models.rows.filter(m => label(m.fields.status) !== "Ended").sort((a, b) => label(a.fields.model).localeCompare(label(b.fields.model)));
  const accountsOf = (id: string) => map.rows.filter(r => linkIds(r.fields.model).includes(id));
  const slugs = [...new Set(live.flatMap(m => accountsOf(m.id).map(r => label(r.fields.slug))).filter(Boolean))];

  // Agency totals per platform first; per-model calls only for platforms that had any conversations.
  const totals = useQueries({queries: CUPID_APPS.map(app => ({queryKey: ["cupid", month, app, ""], enabled: !!month, staleTime: 300000, retry: 1,
    queryFn: () => get<Funnel>({kind: "cupid", month: month!, app})}))});
  const active = CUPID_APPS.filter((_, i) => (totals[i].data?.raw ?? 0) > 0 || (totals[i].data?.charged ?? 0) > 0);
  const pairs = live.flatMap(m => { const ids = cupidIds(m.fields.cupidId); return active.filter(app => ids[app]).map(app => ({m, app, id: ids[app]!})); });
  const per = useQueries({queries: pairs.map(({app, id}) => ({queryKey: ["cupid", month, app, id], staleTime: 300000, retry: 1,
    queryFn: () => get<Funnel>({kind: "cupid", month: month!, app, creator: id})}))});
  const subs = useQueries({queries: slugs.map(account => ({queryKey: ["cs-subs", month, account], enabled: !!month, staleTime: 300000, retry: 1,
    queryFn: () => get<Subs>({kind: "subs", month: month!, account})}))});

  if (!month || models.loading || map.loading) return <PageSkeleton/>;
  const total = (app: CupidApp) => totals[CUPID_APPS.indexOf(app)].data;
  const cupidOf = (m: {id: string}, app: CupidApp) => { const i = pairs.findIndex(p => p.m.id === m.id && p.app === app); return i < 0 ? undefined : per[i]; };
  const subsOf = (slug: string) => subs[slugs.indexOf(slug)];
  const fromApp = (s: Subs | undefined, app: CupidApp) => s ? Object.entries(s.bySource).reduce((a, [src, c]) => a + (appOfSource(src) === app ? c : 0), 0) : undefined;
  const modelSubs = (m: {id: string}) => accountsOf(m.id).map(r => subsOf(label(r.fields.slug))).filter(Boolean);
  // undefined = still loading, null = unavailable.
  const settle = <T,>(q: {data?: Subs; error: unknown}[], f: () => T): T | null | undefined => q.some(x => x.error) ? null : q.some(x => !x.data) ? undefined : f();
  const realFor = (m: {id: string}) => { const q = modelSubs(m) as any[]; return settle(q, () => sumOf(q.map(x => x.data.newSubs))); };
  const realFromCupid = (m: {id: string}) => { const q = modelSubs(m) as any[]; return settle(q, () => q.reduce((a, x) => a + active.reduce((b, app) => b + fromApp(x.data, app)!, 0), 0)); };
  const realOnApp = (app: CupidApp) => settle(subs, () => subs.reduce((a, q) => a + fromApp(q.data, app)!, 0));

  const cupidError = totals.find(q => q.error)?.error as Error | undefined;
  const subsError = subs.find(q => q.error)?.error as Error | undefined;
  const loadingTotals = totals.some(q => q.isPending);
  const charged = sumOf(active.map(a => total(a)?.charged)), conversions = sumOf(active.map(a => total(a)?.conversions));
  const realAll = settle(subs, () => sumOf(subs.map(q => q.data!.newSubs)));
  const realCupid = settle(subs, () => active.reduce((a, app) => a + realOnApp(app)!, 0));
  const capped = subs.some(q => q.data?.capped);
  const label_ = new Date(month + "-15").toLocaleString("en-US", {month: "long", year: "numeric", timeZone: "UTC"});
  const {start, last} = monthRange(month);

  // ID boxes for every platform with conversations this month, plus any platform a model already has an ID for.
  const idApps = CUPID_APPS.filter(app => active.includes(app) || live.some(m => cupidIds(m.fields.cupidId)[app]));
  const saveId = async (m: {id: string; fields: Record<string, any>}, app: CupidApp, value: string) => {
    const v = value.trim(), ids = cupidIds(m.fields.cupidId);
    if (v === (ids[app] ?? "")) return;
    if (v && !/^[A-Za-z0-9_-]{1,64}$/.test(v)) { toast.error("Cupid creator IDs are letters, numbers, - and _ only."); return; }
    try { await models.update(m.id, {cupidId: formatCupidIds({...ids, [app]: v || undefined}) || null}); toast(`${label(m.fields.model)} ${APP_LABEL[app]} ${v ? "linked to" : "unlinked from"} Cupid`); }
    catch (e: any) { toast.error(e.message); }
  };
  const cell = (q: {data?: any; isPending: boolean; error: unknown} | undefined, pick: (d: any) => React.ReactNode) =>
    !q ? <span className="text-[var(--text-faint)]">—</span> : q.error ? <span className="text-[var(--negative-fg)]" title={(q.error as Error).message}>error</span> : q.isPending ? <Skeleton className="ml-auto h-4 w-10"/> : pick(q.data);

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations · Cupid × Creatorstaq" title="Convo Tracker"
      subtitle="Conversations Cupid used and the conversions it claims, next to the real new subs Creatorstaq counted on OnlyFans."
      actions={<WeekStepper label={label_} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} nextDisabled={month >= now}
        badge={month === now && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-[var(--signal-tint-fg)]">So far</span>}/>}/>
    {(models.error || map.error) && <TableError tables={[models, map]}/>}
    {cupidError && <Notice tone="red">{cupidError.message}</Notice>}
    {subsError && <Notice tone="amber">Creatorstaq: {subsError.message}</Notice>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Convos used" icon={MessagesSquare} value={loadingTotals ? "…" : n(charged)} sub={`Charged conversations · ${start} → ${last} UTC`}/>
      <Stat label="Cupid conversions" value={loadingTotals ? "…" : n(conversions)} sub={`${pct(ratio(conversions, charged))} of charged convos`}/>
      <Stat label="Real new subs" value={realAll === undefined ? "…" : n(realAll)} sub="All sources, from OnlyFans via Creatorstaq"/>
      <Stat label="Real subs from Cupid platforms" value={realCupid === undefined ? "…" : (capped && realCupid != null ? "≥" : "") + n(realCupid)}
        sub={`Cupid claims ${pct(ratio(conversions, realCupid))} of these`}/>
    </div>

    <Panel flush title="By platform" subtitle="Whole Cupid account. Real subs are fans whose first touch was a tracking link for that platform.">
      <div className="overflow-x-auto"><div className="min-w-[780px]">
        <div className={cn(PLAT, HEAD)}><span>Platform</span>{["Conversations", "Charged", "Shared CTA", "Cupid conv.", "Conv. rate", "Real subs"].map(h => <span key={h} className="text-right">{h}</span>)}</div>
        {loadingTotals ? <div className="p-6"><Skeleton className="h-10 w-full"/></div>
          : !active.length ? <p className="px-6 py-8 text-[13px] text-muted-foreground">{cupidError ? "Cupid isn't reachable." : `No Cupid conversations in ${label_}.`}</p>
          : active.map(app => { const t = total(app)!, real = realOnApp(app); return <div key={app} className={cn(PLAT, ROW)}>
            <span className="font-semibold">{APP_LABEL[app]}</span>
            <span className="num text-right">{n(t.raw)}</span><span className="num text-right font-semibold">{n(t.charged)}</span>
            <span className="num text-right">{n(t.ctaShared)}</span><span className="num text-right font-semibold">{n(t.conversions)}</span>
            <span className="num text-right">{pct(ratio(t.conversions, t.charged))}</span>
            <span className="num text-right">{real === undefined ? "…" : n(real)}</span>
          </div>; })}
      </div></div>
    </Panel>

    <Panel flush title="By model" subtitle={admin ? "Paste each model's Cupid creator ID per platform (Cupid → Presets → pick the platform → hover the ? beside Creator)." : "Models are matched to Cupid by their creator ID."}>
      <div className="overflow-x-auto"><div className="min-w-[900px]">
        <div className={cn(MODEL, HEAD)}><span>Model</span><span>Cupid creator IDs</span>{["Convos used", "Cupid conv.", "Conv. rate", "Real new subs", "From Cupid platforms"].map(h => <span key={h} className="text-right">{h}</span>)}</div>
        {live.map((m, i) => {
          const ids = cupidIds(m.fields.cupidId), apps = active.filter(app => ids[app]), qs = apps.map(app => cupidOf(m, app)), id = apps.length > 0, ready = id && qs.every(q => q?.data);
          const used = ready ? sumOf(qs.map(q => q!.data!.charged)) : null, conv = ready ? sumOf(qs.map(q => q!.data!.conversions)) : null;
          const real = realFor(m), fromCupid = realFromCupid(m), acc = accountsOf(m.id);
          const agg = !id ? undefined : {data: ready ? true : undefined, isPending: qs.some(q => q?.isPending), error: qs.find(q => q?.error)?.error};
          return <div key={m.id} className={cn(MODEL, ROW)}>
            <span className="flex min-w-0 items-center gap-2.5">
              <ModelAvatar name={label(m.fields.model)} src={acc.find(r => r.fields.avatar)?.fields.avatar} index={i}/>
              <span className="min-w-0"><span className="block truncate font-semibold">{label(m.fields.model)}</span>
                {ready && <span className="block truncate text-[11.5px] text-muted-foreground">{apps.map((app, k) => `${APP_LABEL[app]} ${n(qs[k]!.data!.charged)}·${n(qs[k]!.data!.conversions)}`).join("  ")}</span>}
                {!acc.length && <span className="block text-[11.5px] text-[var(--text-faint)]">No OnlyFans account linked</span>}</span>
            </span>
            <span className="flex flex-col gap-1">{idApps.map(app => admin
              ? <label key={app} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-[60px] shrink-0">{APP_LABEL[app]}</span>
                <input key={ids[app] ?? ""} defaultValue={ids[app] ?? ""} placeholder="Add ID" aria-label={`${APP_LABEL[app]} Cupid creator ID for ${label(m.fields.model)}`}
                  className="num h-7 w-full min-w-0 rounded-[6px] border border-[var(--edge-control)] bg-card px-2 text-[12.5px] text-foreground outline-none focus:border-[var(--signal)]"
                  onBlur={e => void saveId(m, app, e.target.value)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}/></label>
              : <span key={app} className="num truncate text-[12px] text-muted-foreground">{APP_LABEL[app]} {ids[app] || "—"}</span>)}</span>
            <span className="num text-right font-semibold">{cell(agg, () => n(used))}</span>
            <span className="num text-right font-semibold">{cell(agg, () => n(conv))}</span>
            <span className="num text-right">{cell(agg, () => pct(ratio(conv, used)))}</span>
            <span className="num text-right">{!acc.length ? "—" : real === undefined ? <Skeleton className="ml-auto h-4 w-10"/> : n(real)}</span>
            <span className="num text-right">{!acc.length ? "—" : fromCupid === undefined ? <Skeleton className="ml-auto h-4 w-10"/> : n(fromCupid)}</span>
          </div>;
        })}
      </div></div>
    </Panel>

    <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">
      Months are UTC on both sides so Cupid and Creatorstaq line up. Cupid detects conversions from the chat, so they are claims; real subs come from OnlyFans.
      Conversions trail conversations by a day or two, so the current month reads low until it settles. Platform subs only count fans who came in through a tracking link tagged with that platform; the rest show as untracked{capped ? "; one account hit the 5,000-sub scan limit, so platform subs are a floor" : ""}.
    </p>
  </div>;
}
