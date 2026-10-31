"use client";
import {useEffect, useRef, useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {Download, Pencil} from "lucide-react";
import {Btn, ModelAvatar, Notice, PageHeader, PageSkeleton, Panel, RolePill, Segmented, Skeleton, TableError} from "@/components/bh/ui";
import {toast} from "@/components/bh/toast";
import {cn} from "@/lib/utils";
import {label, linkIds} from "@/lib/bh";
import {useSession} from "@/lib/datasource";
import {useModels, useTable} from "@/lib/tables";
import {APP_LABEL, appOfSource, CUPID_APPS, type CupidApp, cupidIds, type CupidIds, convoCost, formatCupidIds, type Funnel, monthDays, ratio, shiftMonth, sourceBucket, toCsv} from "@/lib/convos";
import {CONVERTING, converts, roleOf, type Role} from "@/lib/team";
import {type StaffedModel, Staffing} from "@/views/convos/staffing";
import {Charts, FOOTNOTE, forecastOf, get, type Grain, GRAINS, money, monthName, MonthStepper, n, pct, realStacks, settled, subsByDay, Summary, useCupid, useSubs} from "@/views/convos/board";

// Cupid creator IDs collected on 2026-10-31. Saved once into any of these models whose field is still missing them;
// IDs already on a model win. New IDs go in through the page.
const KNOWN_IDS: Record<string, CupidIds> = {
  april: {x: "2290730", discord: "2290729"},
  ally: {x: "2978839", discord: "2978840"},
  rae: {x: "2978837", discord: "2978838"},
};
const HEAD = "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "min-h-12 border-b py-1.5 text-[13px] last:border-b-0";
const sumOf = (xs: (number | null | undefined)[]) => xs.some(x => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null;

// Agency view. One month stepper, one platform switch and one period switch drive everything below them.
export default function Convos() {
  const [month, setMonth] = useState<string | null>(null);
  const [now, setNow] = useState(""), [today, setToday] = useState("");
  useEffect(() => { const d = new Date().toISOString().slice(0, 10); setToday(d); setNow(d.slice(0, 7)); setMonth(d.slice(0, 7)); }, []);
  const [grain, setGrain] = useState<Grain>("day"), [pick, setPick] = useState<CupidApp | "all">("all"), [editing, setEditing] = useState<string[]>([]);
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
  const accountsOf = (id: string) => map.rows.filter(r => linkIds(r.fields.model).includes(id));
  const slugsOf = (id: string) => accountsOf(id).map(r => label(r.fields.slug)).filter(Boolean);
  const slugs = [...new Set(live.flatMap(m => slugsOf(m.id)))];

  // Agency month total per platform; per-model months and the daily series only for platforms that had conversations.
  const totals = useQueries({queries: CUPID_APPS.map(app => ({queryKey: ["cupid", month, app, ""], enabled: !!month, staleTime: 300000, retry: 1,
    queryFn: () => get<Funnel>({kind: "cupid", month: month!, app})}))});
  const active = CUPID_APPS.filter((_, i) => (totals[i].data?.raw ?? 0) > 0 || (totals[i].data?.charged ?? 0) > 0);
  const app = pick !== "all" && active.includes(pick) ? pick : null;
  const pairs = live.flatMap(m => { const ids = cupidIds(m.fields.cupidId); return active.filter(a => ids[a]).map(a => ({m, app: a, id: ids[a]!})); });
  const per = useQueries({queries: pairs.map(({app, id}) => ({queryKey: ["cupid", month, app, id], staleTime: 300000, retry: 1,
    queryFn: () => get<Funnel>({kind: "cupid", month: month!, app, creator: id})}))});
  // Platform picked: its linked models' daily series (charts by model, per-model forecast). Otherwise the agency's.
  const linked = app ? live.filter(m => cupidIds(m.fields.cupidId)[app]) : [];
  const agency = useCupid(active.map(a => ({app: a})), month, app ? "day" : grain);
  const perModel = useCupid(linked.map(m => ({app: app!, creator: cupidIds(m.fields.cupidId)[app!]})), month, grain);
  const subs = useSubs(slugs, month, grain);

  if (!month || models.loading || map.loading || staff.loading) return <PageSkeleton/>;
  const scope = app ? [app] : active, live_ = month === now;
  const total = (a: CupidApp) => totals[CUPID_APPS.indexOf(a)].data;
  const loadingTotals = totals.some(q => q.isPending);
  const used = loadingTotals ? undefined : sumOf(scope.map(a => total(a)?.charged)), conv = loadingTotals ? undefined : sumOf(scope.map(a => total(a)?.conversions));
  const fromApps = (s: {bySource: Record<string, number>}, apps: CupidApp[]) => Object.entries(s.bySource).reduce((a, [src, c]) => a + (apps.includes(appOfSource(src)!) ? c : 0), 0);
  const subsOfModel = (id: string) => subs.filter(s => slugsOf(id).includes(s.slug));
  const realScope = settled(subs, ms => app ? ms.reduce((a, s) => a + fromApps(s, [app]), 0) : sumOf(ms.map(s => s.newSubs)));
  const realCupid = settled(subs, ms => ms.reduce((a, s) => a + fromApps(s, active), 0));
  const capped = subs.some(s => s.month?.capped);
  const cupidError = ([...totals, ...per].find(q => q.error)?.error as Error | undefined) ?? [...agency, ...perModel].find(s => s.error)?.error;
  const subsError = subs.find(s => s.error)?.error;

  // Current roster: active staff on converting roles, per role, counted against every model they're linked to.
  const countsOf = (id: string) => {
    const counts: Partial<Record<Role, number>> = {};
    for (const s of staff.rows) if (label(s.fields.status) === "Active" && converts(s.fields.platform) && linkIds(s.fields.model).includes(id)) { const r = roleOf(s.fields.platform); counts[r] = (counts[r] ?? 0) + 1; }
    return counts;
  };
  // Model rows for the picked scope, busiest first.
  const rows = (app ? linked : live).map((m, index) => {
    const ids = cupidIds(m.fields.cupidId), apps = scope.filter(a => ids[a]);
    const qs = apps.map(a => per[pairs.findIndex(p => p.m.id === m.id && p.app === a)]);
    const ready = apps.length > 0 && qs.every(q => q?.data);
    const ms = subsOfModel(m.id), acc = accountsOf(m.id);
    return {m, ids, acc, counts: countsOf(m.id), index: live.indexOf(m), name: label(m.fields.model), avatar: acc.find(r => r.fields.avatar)?.fields.avatar,
      cupid: !apps.length ? undefined : {pending: qs.some(q => q?.isPending), error: qs.find(q => q?.error)?.error as Error | undefined, used: ready ? sumOf(qs.map(q => q!.data!.charged)) : undefined, conv: ready ? sumOf(qs.map(q => q!.data!.conversions)) : undefined},
      real: !ms.length ? null : settled(ms, xs => app ? xs.reduce((a, s) => a + fromApps(s, [app]), 0) : sumOf(xs.map(s => s.newSubs))),
      fc: app && live_ ? forecastOf(perModel[index], month, today) : null, s: app ? perModel[index] : undefined};
  }).sort((a, b) => (b.cupid?.used ?? -1) - (a.cupid?.used ?? -1) || a.name.localeCompare(b.name));
  const withFc = !!app && live_;
  const cols = `minmax(180px,1.4fr) 150px minmax(110px,1fr) repeat(${withFc ? 5 : 3}, minmax(84px,110px))`;

  // ID boxes for every platform with conversations this month, plus any platform a model already has an ID for.
  const idApps = CUPID_APPS.filter(a => active.includes(a) || live.some(m => cupidIds(m.fields.cupidId)[a]));
  const saveId = async (m: {id: string; fields: Record<string, any>}, a: CupidApp, value: string) => {
    const v = value.trim(), ids = cupidIds(m.fields.cupidId);
    if (v === (ids[a] ?? "")) return;
    if (v && !/^[A-Za-z0-9_-]{1,64}$/.test(v)) { toast.error("Cupid creator IDs are letters, numbers, - and _ only."); return; }
    try { await models.update(m.id, {cupidId: formatCupidIds({...ids, [a]: v || undefined}) || null}); toast(`${label(m.fields.model)} ${APP_LABEL[a]} ${v ? "linked to" : "unlinked from"} Cupid`); }
    catch (e: any) { toast.error(e.message); }
  };
  const cell = (c: {pending: boolean; error?: Error} | undefined, body: () => React.ReactNode) =>
    !c ? <span className="text-[var(--text-faint)]">—</span> : c.error ? <span className="text-[var(--negative-fg)]" title={c.error.message}>error</span> : c.pending ? <Skeleton className="ml-auto h-4 w-10"/> : body();

  // CSV: the agency's numbers for every day of the month, per platform.
  const dayList = monthDays(month, today), csvReady = agency.every(s => s.monthDays) && subs.every(s => s.month);
  const bucket = (src: string) => { const b = sourceBucket(src); return b !== "other" && active.includes(b) ? b : "other"; };
  const exportCsv = () => {
    const funnel = (a: CupidApp, d: string) => agency[active.indexOf(a)].monthDays!.find(x => x.date === d);
    const realOn = (d: string, k: string) => subs.reduce((a, s) => a + Object.entries(s.month!.byDay[d] ?? {}).reduce((b, [src, c]) => b + (k === "all" || bucket(src) === k ? c : 0), 0), 0);
    const head = ["Date", ...active.flatMap(a => [`${APP_LABEL[a]} convos used`, `${APP_LABEL[a]} Cupid conversions`, `${APP_LABEL[a]} real subs`]), "Other / untracked real subs", "Total convos used", "Total Cupid conversions", "Total real subs"];
    const body = dayList.map(d => [d, ...active.flatMap(a => [funnel(a, d)?.charged, funnel(a, d)?.conversions, realOn(d, a)]), realOn(d, "other"),
      sumOf(active.map(a => funnel(a, d)?.charged)), sumOf(active.map(a => funnel(a, d)?.conversions)), realOn(d, "all")]);
    const url = URL.createObjectURL(new Blob([toCsv([head, ...body])], {type: "text/csv"}));
    Object.assign(document.createElement("a"), {href: url, download: `convo-tracker-${month}.csv`}).click();
    URL.revokeObjectURL(url);
  };
  const staffed: StaffedModel[] = live.map((m, index) => ({id: m.id, name: label(m.fields.model), avatar: accountsOf(m.id).find(r => r.fields.avatar)?.fields.avatar, index, staff: countsOf(m.id),
    subsByDay: settled(subsOfModel(m.id), () => subsByDay(subsOfModel(m.id), () => true)) ?? undefined}));

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations · Cupid × Creatorstaq" title="Convo Tracker"
      subtitle="Conversations Cupid used and the conversions it claims, next to the real new subs Creatorstaq counted on OnlyFans."
      actions={<MonthStepper month={month} now={now} onChange={setMonth}/>}/>
    {(models.error || map.error || staff.error) && <TableError tables={[models, map, staff]}/>}
    {cupidError && <Notice tone="red">Cupid: {cupidError.message}</Notice>}
    {subsError && <Notice tone="amber">Creatorstaq: {subsError.message}</Notice>}

    <div className="flex flex-wrap items-center gap-2">
      <Segmented size="sm" value={app ?? "all"} options={[["all", "All platforms"] as const, ...active.map(a => [a, APP_LABEL[a]] as const)]} onChange={setPick}/>
      <Segmented size="sm" value={grain} options={GRAINS} onChange={setGrain}/>
      <Btn variant="outline" size="sm" className="ml-auto" onClick={exportCsv} disabled={!csvReady || !active.length}><Download className="size-3.5"/>Export CSV</Btn>
    </div>

    <Summary month={month} used={used} conv={conv} real={realScope}
      realSub={app ? `First touch on ${APP_LABEL[app]} · Cupid claims ${pct(ratio(conv, realScope))}` : `${realCupid === undefined ? "…" : n(realCupid)} from Cupid platforms · Cupid claims ${pct(ratio(conv, realCupid))}`}
      fc={live_ && scope.length ? scope.map(a => ({app: a, fc: forecastOf(agency[active.indexOf(a)], month, today) || undefined})) : null}/>

    {!loadingTotals && !active.length ? <Notice tone="gray">No Cupid conversations in {monthName(month)}.</Notice>
      : <Charts grain={grain} month={month} today={today} by={app ? "model" : "platform"}
        cupid={app ? rows.map((r, i) => ({key: `m${i}`, label: r.name, color: `var(--model-${i + 1})`, s: r.s!})) : agency.map(s => ({key: s.app, label: APP_LABEL[s.app], color: `var(--app-${s.app})`, s}))}
        cupidLoading={loadingTotals || (app ? perModel : agency).some(s => s.pending)}
        real={!app ? realStacks(active, subs, grain) : grain === "month" ? null
          : rows.map((r, i) => ({key: `m${i}`, label: r.name, color: `var(--model-${i + 1})`, values: subsByDay(subsOfModel(r.m.id), src => appOfSource(src) === app)}))}
        realLoading={subs.some(s => s.pending)} realEmpty={app && grain === "month" ? "Creatorstaq's monthly totals aren't split by platform. Pick Daily or Weekly." : "No real subs in this window."}/>}

    <Panel flush title={app ? `${APP_LABEL[app]} by model` : "Models"}
      subtitle={`${monthName(month)}. ${app ? `Only models with a ${APP_LABEL[app]} Cupid ID. ` : ""}${admin ? "Click the pencil to change a model's Cupid creator IDs (Cupid → Presets → pick the platform → hover the ? beside Creator)." : "Models are matched to Cupid by their creator ID."}`}>
      <div className="overflow-x-auto"><div style={{minWidth: withFc ? 980 : 820}}>
        <div className={cn("grid items-center gap-2 px-6", HEAD)} style={{gridTemplateColumns: cols}}><span>Model</span><span>Cupid creator IDs</span><span>Chatters</span>
          {["Convos used", "Cupid conv.", "Real OF subs", ...(withFc ? [`Projected ${monthName(month)}`, `Projected ${monthName(shiftMonth(month, 1))}`] : [])].map(h => <span key={h} className="text-right">{h}</span>)}</div>
        {!rows.length && <p className="px-6 py-8 text-[13px] text-muted-foreground">{app ? `No model has a ${APP_LABEL[app]} Cupid ID yet.` : "No live models."}</p>}
        {rows.map(r => <div key={r.m.id} className={cn("grid items-center gap-2 px-6", ROW)} style={{gridTemplateColumns: cols}}>
          <span className="flex min-w-0 items-center gap-2.5">
            <ModelAvatar name={r.name} src={r.avatar} index={r.index}/>
            <span className="min-w-0"><a href={`/convos/model/${encodeURIComponent(r.m.id)}`} className="block truncate font-semibold hover:underline">{r.name}</a>
              <span className="block truncate text-[11.5px] text-muted-foreground">{r.acc.length ? r.acc.map(x => "@" + (label(x.fields.ofUsername) || label(x.fields.slug))).join(" · ") : "No OnlyFans account linked"}</span></span>
          </span>
          {admin && editing.includes(r.m.id) ? <span className="flex flex-col gap-1">{idApps.map(a => <label key={a} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="w-[60px] shrink-0">{APP_LABEL[a]}</span>
              <input key={r.ids[a] ?? ""} defaultValue={r.ids[a] ?? ""} placeholder="Add ID" aria-label={`${APP_LABEL[a]} Cupid creator ID for ${r.name}`}
                className="num h-7 w-full min-w-0 rounded-[6px] border border-[var(--edge-control)] bg-card px-2 text-[12.5px] text-foreground outline-none focus:border-[var(--signal)]"
                onBlur={e => void saveId(r.m, a, e.target.value)} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}/></label>)}
              <button type="button" onClick={() => setEditing(editing.filter(x => x !== r.m.id))} className="self-start text-[11.5px] font-semibold text-muted-foreground hover:text-foreground">Done</button></span>
            : <span className="flex min-w-0 items-start gap-1.5"><span className="flex min-w-0 flex-col">
                {CUPID_APPS.filter(a => r.ids[a]).map(a => <span key={a} className="num truncate text-[12px] text-muted-foreground">{APP_LABEL[a]} <span className="text-foreground">{r.ids[a]}</span></span>)}
                {!Object.keys(r.ids).length && <span className="text-[12px] text-[var(--text-faint)]">No IDs</span>}</span>
              {admin && <button type="button" onClick={() => setEditing([...editing, r.m.id])} aria-label={`Edit Cupid IDs for ${r.name}`} title="Edit Cupid IDs"
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="size-3.5"/></button>}</span>}
          <span className="flex flex-wrap gap-1">{CONVERTING.filter(x => r.counts[x]).map(x => <span key={x} className="inline-flex items-center gap-1"><RolePill role={x}/><span className="num text-[12px]">{r.counts[x]}</span></span>)}
            {!CONVERTING.some(x => r.counts[x]) && <span className="text-[12px] text-[var(--text-faint)]">None</span>}</span>
          <span className="num text-right">{cell(r.cupid, () => <><span className="block font-semibold">{n(r.cupid!.used)}</span><span className="block text-[11px] text-muted-foreground">{pct(ratio(r.cupid!.used, used))} share</span></>)}</span>
          <span className="num text-right">{cell(r.cupid, () => <><span className="block font-semibold">{n(r.cupid!.conv)}</span><span className="block text-[11px] text-muted-foreground">{pct(ratio(r.cupid!.conv, r.cupid!.used))} rate</span></>)}</span>
          <span className="num text-right">{r.real === null ? "—" : r.real === undefined ? <Skeleton className="ml-auto h-4 w-10"/> : n(r.real)}</span>
          {withFc && <Projection fc={r.fc} pending={!!r.s?.pending} pick="month" app={app!}/>}
          {withFc && <Projection fc={r.fc} pending={!!r.s?.pending} pick="next" app={app!}/>}
        </div>)}
      </div></div>
    </Panel>

    <Staffing models={staffed} days={dayList}/>

    <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">{FOOTNOTE}{capped ? " One account hit the 5,000-sub scan limit, so platform subs are a floor." : ""}</p>
  </div>;
}

function Projection({fc, pending, pick, app}: {fc: ReturnType<typeof forecastOf> | null; pending: boolean; pick: "month" | "next"; app: CupidApp}) {
  if (pending) return <Skeleton className="ml-auto h-4 w-10"/>;
  const v = fc ? fc[pick] : null;
  return <span className="num text-right"><span className="block font-semibold">{n(v)}</span><span className="block text-[11px] text-muted-foreground">{money(convoCost(v, app))}</span></span>;
}
