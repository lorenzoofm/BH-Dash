"use client";
import {useEffect, useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {ChevronLeft, MessagesSquare} from "lucide-react";
import {Empty, ModelAvatar, Notice, PageHeader, PageSkeleton, Panel, Segmented, Skeleton, Stat, TableError, WeekStepper} from "@/components/bh/ui";
import {label, linkIds, mondayOf} from "@/lib/bh";
import {useModels, useTable} from "@/lib/tables";
import {APP_LABEL, CUPID_APPS, convoCost, cupidIds, type Funnel, ratio, shiftMonth, sourceBucket} from "@/lib/convos";
import {appSeries, type Bucket, ChartPanel} from "@/views/convos/daily";
import {FORECAST_METHOD, ForecastTable, forecastOf, get, type Grain, GRAINS, monthName, periodLabel, periodRows, periodsOf, useCupid, valuesOf} from "@/views/convos/breakdown";

type Subs = {newSubs: number | null; byDay: Record<string, Record<string, number>>};
const n = (v: number | null | undefined) => v == null ? "—" : Math.round(v).toLocaleString("en-US");
const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

// One model's convos, Cupid conversions and real OF subs per platform, by day, week or month, with its forecast.
export default function ModelConvos({id}: {id: string}) {
  const [month, setMonth] = useState<string | null>(null), [now, setNow] = useState(""), [today, setToday] = useState("");
  useEffect(() => { const d = new Date().toISOString().slice(0, 10); setToday(d); setNow(d.slice(0, 7)); setMonth(d.slice(0, 7)); }, []);
  const [grain, setGrain] = useState<Grain>("day"), [all, setAll] = useState(false);
  const models = useModels(), map = useTable("map");
  const live = models.rows.filter(m => label(m.fields.status) !== "Ended").sort((a, b) => label(a.fields.model).localeCompare(label(b.fields.model)));
  const model = models.rows.find(m => m.id === id), name = model ? label(model.fields.model) : "";
  const ids = cupidIds(model?.fields.cupidId), apps = CUPID_APPS.filter(a => ids[a]);
  const accounts = map.rows.filter(r => linkIds(r.fields.model).includes(id)), slugs = [...new Set(accounts.map(r => label(r.fields.slug)).filter(Boolean))];
  const m = month ?? "2000-01", prev = shiftMonth(m, -1);
  const cupid = useCupid(apps.map(app => ({app, creator: ids[app]})), m, grain);
  const sq = (kind: string, mm: string, account: string, enabled: boolean) => ({queryKey: [kind === "subs" ? "cs-subs" : kind, mm, account], enabled: !!month && enabled, staleTime: 300000, retry: 1, queryFn: () => get<any>({kind, month: mm, account})});
  const subsCur = useQueries({queries: slugs.map(a => sq("subs", m, a, true))});
  const subsPrev = useQueries({queries: slugs.map(a => sq("subs", prev, a, grain === "week"))});
  const subsHist = useQueries({queries: slugs.map(a => sq("subs-months", m, a, grain === "month"))});

  if (!month || models.loading || map.loading) return <PageSkeleton/>;
  const back = <a href="/convos" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4"/>Convo Tracker</a>;
  if (!model) return <div className="space-y-6">{back}{models.error ? <TableError tables={[models, map]}/> : <Empty title="Model not found">It may have been removed from Creatorstaq.</Empty>}</div>;

  const periods = periodsOf(grain, month, today);
  const cupidPending = cupid.some(s => s.pending), cupidError = cupid.find(s => s.error)?.error;
  const metricRows = (metric: keyof Funnel) => periodRows(grain, periods, Object.fromEntries(cupid.map(s => [s.app, valuesOf(s, grain, metric)])));
  const used = metricRows("charged"), conv = metricRows("conversions");

  // Real subs: by first-touch bucket per day (summed into weeks), or Creatorstaq's monthly total.
  const subsQs = grain === "month" ? subsHist : grain === "week" ? [...subsCur, ...subsPrev] : subsCur;
  const subsPending = subsQs.some(q => q.isPending), subsError = subsQs.find(q => q.error)?.error as Error | undefined;
  const buckets: Bucket[] = [...CUPID_APPS.filter(a => apps.includes(a)), "other"];
  const realByBucket: Record<string, Record<string, number>> = Object.fromEntries(buckets.map(b => [b, {}]));
  const realMonthly: Record<string, number> = {};
  if (grain === "month") for (const q of subsHist) for (const r of (q.data as {months: {month: string; newSubs: number | null}[]} | undefined)?.months ?? []) realMonthly[r.month] = (realMonthly[r.month] ?? 0) + (r.newSubs ?? 0);
  else for (const q of subsQs) for (const [d, src] of Object.entries((q.data as Subs | undefined)?.byDay ?? {})) for (const [s, c] of Object.entries(src)) {
    const b = sourceBucket(s), k = buckets.includes(b) ? b : "other"; realByBucket[k][d] = (realByBucket[k][d] ?? 0) + c;
  }
  const real = grain === "month" ? periodRows(grain, periods, {total: realMonthly}) : periodRows(grain, periods, realByBucket);
  const realTotal = (i: number) => grain === "month" ? (real[i] as any).total : buckets.reduce((a, b) => a + ((real[i] as any)[b] ?? 0), 0);

  // This month's headline numbers and forecast (forecast only while the month is running).
  const monthSum = (metric: keyof Funnel) => cupid.every(s => s.monthDays) ? cupid.reduce((a, s) => a + s.monthDays!.reduce((b, d) => b + (d[metric] ?? 0), 0), 0) : undefined;
  const usedMonth = monthSum("charged"), convMonth = monthSum("conversions");
  const realMonth = subsCur.every(q => q.data) ? subsCur.reduce((a, q) => a + ((q.data as Subs).newSubs ?? 0), 0) : undefined;
  const fcs = cupid.map(s => ({app: s.app, fc: forecastOf(s, month, today) || undefined}));
  const projected = fcs.every(p => p.fc) ? fcs.reduce((a, p) => a + (p.fc!.month ?? 0), 0) : undefined, next = fcs.every(p => p.fc) ? fcs.reduce((a, p) => a + (p.fc!.next ?? 0), 0) : undefined;
  const nextCost = fcs.every(p => p.fc) ? fcs.map(p => convoCost(p.fc!.next, p.app)) : undefined;
  const live_ = month === now;
  const tableCols = `minmax(110px,1fr) repeat(${apps.length * 2 + 4}, minmax(72px,100px))`;
  const totalAt = (rows: typeof used, i: number) => apps.reduce((a, app) => a + ((rows[i] as any)[app] ?? 0), 0);

  return <div className="space-y-6">
    {back}
    <PageHeader eyebrow="Convo Tracker · Model" title={<span className="flex items-center gap-3"><ModelAvatar name={name} src={accounts.find(r => r.fields.avatar)?.fields.avatar} index={Math.max(0, live.indexOf(model))} size={36}/>{name}</span> as any}
      subtitle={<>{apps.length ? apps.map(a => `${APP_LABEL[a]} ${ids[a]}`).join(" · ") : "No Cupid creator IDs yet"}{accounts.length > 0 && " · " + accounts.map(r => "@" + (label(r.fields.ofUsername) || label(r.fields.slug))).join(" · ")}</>}
      actions={<WeekStepper label={new Date(month + "-15").toLocaleString("en-US", {month: "long", year: "numeric", timeZone: "UTC"})} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} nextDisabled={month >= now}
        badge={live_ && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-[var(--signal-tint-fg)]">So far</span>}/>}/>
    {cupidError && <Notice tone="red">Cupid: {cupidError.message}</Notice>}
    {subsError && <Notice tone="amber">Creatorstaq: {subsError.message}</Notice>}
    {!apps.length && <Notice tone="gray">Add this model's Cupid creator IDs on the Convo Tracker to see its convos.</Notice>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Convos used" icon={MessagesSquare} value={usedMonth === undefined ? "…" : n(usedMonth)} sub={`${monthName(month)}, charged conversations`}/>
      <Stat label="Cupid conversions" value={convMonth === undefined ? "…" : n(convMonth)} sub={`${pct(ratio(convMonth, usedMonth))} of convos used`}/>
      <Stat label="Real new subs" value={!slugs.length ? "—" : realMonth === undefined ? "…" : n(realMonth)} sub={slugs.length ? "All sources, OnlyFans via Creatorstaq" : "No OnlyFans account linked"}/>
      {live_ ? <Stat label="Projected convos" value={projected === undefined ? "…" : n(projected)} sub={`${monthName(shiftMonth(month, 1))}: ${next === undefined ? "…" : n(next)}${nextCost && nextCost.every(c => c != null) ? ` · ${nextCost.reduce((a, c) => a + c!, 0).toLocaleString("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0})}` : " · Set pricing"}`}/>
        : <Stat label="Real subs per 100 convos" value={usedMonth && realMonth != null ? (realMonth / usedMonth * 100).toFixed(1) : "—"} sub="All real subs over convos used"/>}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold">By platform</h2>
      <Segmented size="sm" value={grain} options={GRAINS} onChange={setGrain}/>
    </div>
    <div className="grid gap-4 xl:grid-cols-3">
      <ChartPanel title="Convos used" subtitle="Charged conversations, split by platform" series={appSeries(apps)} rows={used} loading={cupidPending} empty="No convos in this window."/>
      <ChartPanel title="Cupid conversions" subtitle="Subs Cupid claims, split by platform" series={appSeries(apps)} rows={conv} loading={cupidPending} empty="No conversions in this window."/>
      <ChartPanel title="Real OF subs" subtitle={grain === "month" ? "Creatorstaq's monthly new subs" : "New subs by first-touch platform"} loading={!!slugs.length && subsPending} empty={slugs.length ? "No real subs in this window." : "No OnlyFans account linked."}
        series={grain === "month" ? [{key: "total", label: "Real new subs", color: "var(--app-other)"}] : appSeries(buckets)} rows={real}/>
    </div>

    <Panel flush title={`${GRAINS.find(g => g[0] === grain)![1]} breakdown`} subtitle="Newest first. Each platform shows convos used, then Cupid conversions.">
      <div className="overflow-x-auto"><div style={{minWidth: 140 + (apps.length * 2 + 4) * 84}}>
        <div className="grid h-9 items-center gap-2 bg-muted px-6 text-[11.5px] font-medium text-muted-foreground" style={{gridTemplateColumns: tableCols}}>
          <span>{grain === "month" ? "Month" : grain === "week" ? "Week" : "Day"}</span>
          {apps.flatMap(a => [<span key={a + "u"} className="text-right">{APP_LABEL[a]} used</span>, <span key={a + "c"} className="text-right">{APP_LABEL[a]} conv.</span>])}
          {["Total used", "Total conv.", "Conv. rate", "Real subs"].map(h => <span key={h} className="text-right">{h}</span>)}
        </div>
        {[...periods.keys()].reverse().slice(0, all ? undefined : 10).map(i => <div key={periods[i]} className="grid min-h-11 items-center gap-2 border-b px-6 py-1.5 text-[13px] last:border-b-0" style={{gridTemplateColumns: tableCols}}>
          <span className="font-semibold">{periodLabel(grain, periods[i])}{grain === "week" && periods[i] === mondayOf(today) && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">so far</span>}</span>
          {cupidPending ? Array.from({length: apps.length * 2 + 3}, (_, k) => <Skeleton key={k} className="ml-auto h-4 w-10"/>) : <>
            {apps.flatMap(a => [<span key={a + "u"} className="num text-right">{n((used[i] as any)[a])}</span>, <span key={a + "c"} className="num text-right">{n((conv[i] as any)[a])}</span>])}
            <span className="num text-right font-semibold">{n(totalAt(used, i))}</span>
            <span className="num text-right font-semibold">{n(totalAt(conv, i))}</span>
            <span className="num text-right">{pct(ratio(totalAt(conv, i), totalAt(used, i)))}</span></>}
          <span className="num text-right">{!slugs.length ? "—" : subsPending ? <Skeleton className="ml-auto h-4 w-10"/> : n(realTotal(i))}</span>
        </div>)}
        {periods.length > 10 && <button type="button" onClick={() => setAll(!all)} className="w-full border-t py-2.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">{all ? "Show fewer" : `Show all ${periods.length}`}</button>}
      </div></div>
    </Panel>

    {live_ && apps.length > 0 && <ForecastTable title={`${name} forecast`} subtitle={FORECAST_METHOD} month={month}
      rows={[...fcs.map(p => ({key: p.app, label: APP_LABEL[p.app], error: !!cupid.find(s => s.app === p.app)?.error, parts: [p]})), ...(apps.length > 1 ? [{key: "all", label: "All platforms", strong: true, error: !!cupidError, parts: fcs}] : [])]}/>}

    <p className="text-[12px] leading-relaxed text-[var(--text-faint)]">
      Weeks start on Monday and cover this month and last. Cupid conversions settle a day or two after the chats, so recent periods read low. Real subs by platform only count fans whose first touch was a tracking link tagged with that platform.
    </p>
  </div>;
}
