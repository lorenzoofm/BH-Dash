"use client";
import {useEffect, useRef, useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {MessagesSquare, Pencil} from "lucide-react";
import {ModelAvatar, Notice, PageHeader, PageSkeleton, Panel, Skeleton, Stat, TableError, WeekStepper} from "@/components/bh/ui";
import {toast} from "@/components/bh/toast";
import {cn} from "@/lib/utils";
import {label, linkIds} from "@/lib/bh";
import {useSession} from "@/lib/datasource";
import {useModels, useTable} from "@/lib/tables";
import {APP_LABEL, appOfSource, CUPID_APPS, type CupidApp, cupidIds, type CupidIds, formatCupidIds, type Funnel, monthDays, monthRange, ratio, shiftMonth, sourceBucket} from "@/lib/convos";
import {converts, roleOf, type Role} from "@/lib/team";
import {type Bucket, type Day, DailyCharts, DailyTable} from "@/views/convos/daily";
import {type StaffedModel, Staffing} from "@/views/convos/staffing";

// Cupid creator IDs collected on 2026-10-31. Saved once into any of these models whose field is still missing them;
// IDs already on a model win. New IDs go in through the page.
const KNOWN_IDS: Record<string, CupidIds> = {
  april: {x: "2290730", discord: "2290729"},
  ally: {x: "2978839", discord: "2978840"},
  rae: {x: "2978837", discord: "2978838"},
};
type Subs = {newSubs: number | null; counted: number; bySource: Record<string, number>; byDay: Record<string, Record<string, number>>; capped: boolean};
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
  const [now, setNow] = useState(""), [today, setToday] = useState("");
  useEffect(() => { const d = new Date().toISOString().slice(0, 10); setToday(d); setNow(d.slice(0, 7)); setMonth(d.slice(0, 7)); }, []);
  const session = useSession(), admin = !!(session.data as any)?.isAdmin;
  const models = useModels(), map = useTable("map"), staff = useTable("staff");
  const live = models.rows.filter(m => label(m.fields.status) !== "Ended").sort((a, b) => label(a.fields.model).localeCompare(label(b.fields.model)));
  const backfilled = useRef(false);
  useEffect(() => {
    if (backfilled.current || !admin || models.loading || models.error) return;
    backfilled.current = true;
    for (const m of models.rows) {
      const known = KNOWN_IDS[label(m.fields.model).trim().toLowerCase()], have = cupidIds(m.fields.cupidId);
      if (known && Object.keys(known).some(app => !have[app as CupidApp]))
        models.update(m.id, {cupidId: formatCupidIds({...known, ...have})}).catch((e: any) => toast.error(e.message));
    }
  }, [admin, models.loading, models.error, models.rows]);
  const [editing, setEditing] = useState<string[]>([]);
  const accountsOf = (id: string) => map.rows.filter(r => linkIds(r.fields.model).includes(id));
  const slugs = [...new Set(live.flatMap(m => accountsOf(m.id).map(r => label(r.fields.slug))).filter(Boolean))];

  // Agency totals per platform first; per-model calls only for platforms that had any conversations.
  const totals = useQueries({queries: CUPID_APPS.map(app => ({queryKey: ["cupid", month, app, ""], enabled: !!month, staleTime: 300000, retry: 1,
    queryFn: () => get<Funnel>({kind: "cupid", month: month!, app})}))});
  const active = CUPID_APPS.filter((_, i) => (totals[i].data?.raw ?? 0) > 0 || (totals[i].data?.charged ?? 0) > 0);
  const pairs = live.flatMap(m => { const ids = cupidIds(m.fields.cupidId); return active.filter(app => ids[app]).map(app => ({m, app, id: ids[app]!})); });
  const per = useQueries({queries: pairs.map(({app, id}) => ({queryKey: ["cupid", month, app, id], staleTime: 300000, retry: 1,
    queryFn: () => get<Funnel>({kind: "cupid", month: month!, app, creator: id})}))});
  const daily = useQueries({queries: active.map(app => ({queryKey: ["cupid-daily", month, app], staleTime: 300000, retry: 1,
    queryFn: () => get<{days: ({date: string} & Funnel)[]}>({kind: "cupid-daily", month: month!, app})}))});
  const subs = useQueries({queries: slugs.map(account => ({queryKey: ["cs-subs", month, account], enabled: !!month, staleTime: 300000, retry: 1,
    queryFn: () => get<Subs>({kind: "subs", month: month!, account})}))});

  if (!month || models.loading || map.loading || staff.loading) return <PageSkeleton/>;
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

  // Day by day: Cupid per active app, and real subs summed across every live account and bucketed by first touch.
  const dayList = monthDays(month, today), subsReady = subs.every(q => q.data);
  const days: Day[] = dayList.map(date => {
    const cupid: Day["cupid"] = {};
    active.forEach((app, i) => { const hit = daily[i]?.data?.days.find(d => d.date === date); if (hit) cupid[app] = hit; });
    let real: Day["real"];
    if (subsReady) { real = {}; for (const q of subs) for (const [src, c] of Object.entries(q.data!.byDay?.[date] ?? {})) { const b: Bucket = sourceBucket(src); real[b] = (real[b] ?? 0) + c; } }
    return {date, cupid, real};
  });
  const dailyError = daily.find(q => q.error)?.error as Error | undefined;
  // Current roster: active staff on converting roles, counted against every model they're linked to.
  const staffed: StaffedModel[] = live.map((m, index) => {
    const counts: Partial<Record<Role, number>> = {};
    for (const s of staff.rows) if (label(s.fields.status) === "Active" && converts(s.fields.platform) && linkIds(s.fields.model).includes(m.id)) { const r = roleOf(s.fields.platform); counts[r] = (counts[r] ?? 0) + 1; }
    const q = modelSubs(m) as any[];
    const subsByDay = q.length && q.every(x => x.data) ? q.reduce<Record<string, number>>((acc, x) => { for (const [d, src] of Object.entries(x.data.byDay ?? {})) acc[d] = (acc[d] ?? 0) + Object.values(src as Record<string, number>).reduce((a, c) => a + c, 0); return acc; }, {}) : q.length ? undefined : {};
    return {id: m.id, name: label(m.fields.model), avatar: accountsOf(m.id).find(r => r.fields.avatar)?.fields.avatar, index, staff: counts, subsByDay};
  });

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
    {(models.error || map.error || staff.error) && <TableError tables={[models, map, staff]}/>}
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

    {dailyError && <Notice tone="amber">Daily Cupid numbers: {dailyError.message}</Notice>}
    <DailyCharts days={days} apps={active} loading={loadingTotals || daily.some(q => q.isPending)} subsLoading={!subsReady && !subsError}/>
    <DailyTable days={days} apps={active} month={month}/>

    <Panel flush title="By model" subtitle={admin ? "Each model's Cupid creator IDs. Click the pencil to change them (Cupid → Presets → pick the platform → hover the ? beside Creator)." : "Models are matched to Cupid by their creator ID."}>
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
              <span className="min-w-0"><span className="block truncate font-semibold">{label(m.fields.model)}
                {acc.length > 0 && <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">{acc.map(r => "@" + (label(r.fields.ofUsername) || label(r.fields.slug))).join(" · ")}</span>}</span>
                {ready && <span className="block truncate text-[11.5px] text-muted-foreground">{apps.map((app, k) => `${APP_LABEL[app]} ${n(qs[k]!.data!.charged)}·${n(qs[k]!.data!.conversions)}`).join("  ")}</span>}
                {!acc.length && <span className="block text-[11.5px] text-[var(--text-faint)]">No OnlyFans account linked</span>}</span>
            </span>
            {admin && editing.includes(m.id) ? <span className="flex flex-col gap-1">{idApps.map(app => <label key={app} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-[60px] shrink-0">{APP_LABEL[app]}</span>
                <input key={ids[app] ?? ""} defaultValue={ids[app] ?? ""} placeholder="Add ID" aria-label={`${APP_LABEL[app]} Cupid creator ID for ${label(m.fields.model)}`}
                  className="num h-7 w-full min-w-0 rounded-[6px] border border-[var(--edge-control)] bg-card px-2 text-[12.5px] text-foreground outline-none focus:border-[var(--signal)]"
                  onBlur={e => void saveId(m, app, e.target.value)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}/></label>)}
                <button type="button" onClick={() => setEditing(editing.filter(x => x !== m.id))} className="self-start text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">Done</button></span>
              : <span className="flex min-w-0 items-start gap-1.5"><span className="flex min-w-0 flex-col">
                  {CUPID_APPS.filter(app => ids[app]).map(app => <span key={app} className="num truncate text-[12px] text-muted-foreground">{APP_LABEL[app]} <span className="text-foreground">{ids[app]}</span></span>)}
                  {!Object.keys(ids).length && <span className="text-[12px] text-[var(--text-faint)]">No IDs</span>}</span>
                {admin && <button type="button" onClick={() => setEditing([...editing, m.id])} aria-label={`Edit Cupid IDs for ${label(m.fields.model)}`} title="Edit Cupid IDs"
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5"/></button>}</span>}
            <span className="num text-right font-semibold">{cell(agg, () => n(used))}</span>
            <span className="num text-right font-semibold">{cell(agg, () => n(conv))}</span>
            <span className="num text-right">{cell(agg, () => pct(ratio(conv, used)))}</span>
            <span className="num text-right">{!acc.length ? "—" : real === undefined ? <Skeleton className="ml-auto h-4 w-10"/> : n(real)}</span>
            <span className="num text-right">{!acc.length ? "—" : fromCupid === undefined ? <Skeleton className="ml-auto h-4 w-10"/> : n(fromCupid)}</span>
          </div>;
        })}
      </div></div>
    </Panel>

    <Staffing models={staffed} days={dayList} subsReady={subsReady}/>

    <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">
      Months are UTC on both sides so Cupid and Creatorstaq line up. Cupid detects conversions from the chat, so they are claims; real subs come from OnlyFans.
      Conversions trail conversations by a day or two, so the current month reads low until it settles. Platform subs only count fans who came in through a tracking link tagged with that platform; the rest show as untracked{capped ? "; one account hit the 5,000-sub scan limit, so platform subs are a floor" : ""}.
    </p>
  </div>;
}
