"use client";
import {useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {ModelAvatar, Panel, Segmented, Skeleton} from "@/components/bh/ui";
import {cn} from "@/lib/utils";
import {mondayOf} from "@/lib/bh";
import {APP_LABEL, type CupidApp, type CupidIds, CONVO_PRICE, convoCost, type Forecast, forecast, type Funnel, monthDays, ratio, shiftMonth} from "@/lib/convos";
import {ChartPanel, type Series, short} from "@/views/convos/daily";

export async function get<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch("/api/convos?" + new URLSearchParams(params));
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export type Grain = "day" | "week" | "month";
export const GRAINS = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] as const;
const n = (v: number | null | undefined) => v == null ? "—" : Math.round(v).toLocaleString("en-US");
const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const money = (v: number | null) => v == null ? (Object.keys(CONVO_PRICE).length ? "—" : <span className="text-[var(--text-faint)]">Set pricing</span>) : v.toLocaleString("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
export const monthName = (m: string) => new Date(m + "-15").toLocaleString("en-US", {month: "short", year: "numeric", timeZone: "UTC"});
const HEAD = "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "min-h-12 border-b py-1.5 text-[13px] last:border-b-0";

// Periods shown for a grain: the month's days; Monday weeks across this and last month; the six months up to this one.
export function periodsOf(grain: Grain, month: string, today: string) {
  if (grain === "month") return Array.from({length: 6}, (_, i) => shiftMonth(month, i - 5));
  if (grain === "day") return monthDays(month, today);
  const prev = shiftMonth(month, -1);
  return [...new Set([...monthDays(prev, today), ...monthDays(month, today)].map(mondayOf))].filter(w => w >= prev + "-01");
}
export const periodLabel = (grain: Grain, p: string) => grain === "month" ? monthName(p) : grain === "week" ? "Wk " + short(p) : short(p);
// One chart row per period; values are by day (summed into weeks) or by month.
export function periodRows(grain: Grain, periods: string[], data: Record<string, Record<string, number | null | undefined>>) {
  return periods.map(p => ({label: periodLabel(grain, p), period: p, ...Object.fromEntries(Object.entries(data).map(([k, rec]) =>
    [k, grain === "week" ? Object.entries(rec).reduce((a, [d, v]) => a + (mondayOf(d) === p ? v ?? 0 : 0), 0) : rec[p] ?? 0]))}));
}

// Cupid by day for the month (always: the forecast needs it), plus last month for weeks or six monthly totals.
export type Target = {app: CupidApp; creator?: string};
type DailyRes = {days: ({date: string} & Funnel)[]};
type MonthsRes = {months: ({month: string} & Funnel)[]};
export function useCupid(targets: Target[], month: string, grain: Grain) {
  const q = <T,>(kind: string, m: string, t: Target, enabled: boolean) => ({queryKey: [kind, m, t.app, t.creator ?? ""], enabled, staleTime: 300000, retry: 1,
    queryFn: () => get<T>({kind, month: m, app: t.app, ...(t.creator ? {creator: t.creator} : {})})});
  const cur = useQueries({queries: targets.map(t => q<DailyRes>("cupid-daily", month, t, true))});
  const before = useQueries({queries: targets.map(t => q<DailyRes>("cupid-daily", shiftMonth(month, -1), t, grain === "week"))});
  const hist = useQueries({queries: targets.map(t => q<MonthsRes>("cupid-months", month, t, grain === "month"))});
  return targets.map((t, i) => {
    const needed = [cur[i], ...(grain === "week" ? [before[i]] : []), ...(grain === "month" ? [hist[i]] : [])];
    const days: Record<string, Funnel> = Object.fromEntries([...(before[i].data?.days ?? []), ...(cur[i].data?.days ?? [])].map(d => [d.date, d]));
    const months: Record<string, Funnel> = Object.fromEntries((hist[i].data?.months ?? []).map(m => [m.month, m]));
    return {...t, days, months, monthDays: cur[i].data?.days, pending: needed.some(x => x.isPending), error: needed.find(x => x.error)?.error as Error | undefined};
  });
}
export type CupidSeries = ReturnType<typeof useCupid>[number];
// A metric by period key (day or month) for one series.
export const valuesOf = (s: CupidSeries, grain: Grain, metric: keyof Funnel) =>
  Object.fromEntries(Object.entries(grain === "month" ? s.months : s.days).map(([k, f]) => [k, f[metric]]));
export const forecastOf = (s: CupidSeries, month: string, today: string) => s.monthDays && forecast(s.monthDays.map(d => ({date: d.date, v: d.charged})), month, today);
// Several series summed day by day, then forecast as one.
export const forecastSum = (all: CupidSeries[], month: string, today: string) => all.every(s => s.monthDays) ? forecast(monthDays(month, today).map(date =>
  ({date, v: all.reduce((a, s) => a + (s.monthDays!.find(d => d.date === date)?.charged ?? 0), 0)})), month, today) : undefined;

export const FORECAST_METHOD = "Rate = average convos used per day over the last 7 complete days (month to date early on). This month = complete days + rate × days left; next month = rate × its days. Ranges use the slowest and busiest of those days.";
export type ForecastRow = {key: string; label: React.ReactNode; parts: {app: CupidApp; fc: Forecast | undefined}[]; strong?: boolean; error?: boolean};
const FC = "grid grid-cols-[minmax(150px,1.4fr)_repeat(6,minmax(84px,120px))] items-center gap-2 px-6";

export function ForecastTable({title = "Forecast", subtitle, rows, month}: {title?: string; subtitle?: string; rows: ForecastRow[]; month: string}) {
  const nextName = monthName(shiftMonth(month, 1));
  return <Panel flush title={title} subtitle={subtitle ?? FORECAST_METHOD}>
    <div className="overflow-x-auto"><div className="min-w-[860px]">
      <div className={cn(FC, HEAD)}><span/>{["Used so far", "Per day", `${monthName(month)} projected`, `${nextName} projected`, `Cost ${monthName(month)}`, `Cost ${nextName}`].map(h => <span key={h} className="text-right">{h}</span>)}</div>
      {!rows.length && <p className="px-6 py-8 text-[13px] text-muted-foreground">Nothing to forecast yet.</p>}
      {rows.map(r => {
        const ready = r.parts.every(p => p.fc), fcs = r.parts.map(p => p.fc!), add = (pick: (f: Forecast) => number | null) => fcs.some(f => pick(f) == null) ? null : fcs.reduce((a, f) => a + pick(f)!, 0);
        const cost = (pick: (f: Forecast) => number | null) => { const c = r.parts.map(p => convoCost(pick(p.fc!), p.app)); return c.some(x => x == null) ? null : c.reduce<number>((a, x) => a + x!, 0); };
        const band = (lo: number | null, hi: number | null) => lo != null && hi != null && <span className="block text-[11px] text-muted-foreground">{n(lo)}–{n(hi)}</span>;
        return <div key={r.key} className={cn(FC, ROW, r.strong && "bg-muted/40")}>
          <span className={cn("min-w-0", r.strong && "font-semibold")}>{r.label}</span>
          {r.error ? <span className="col-span-6 text-right text-[12px] text-[var(--negative-fg)]">Could not load</span>
            : !ready ? [0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="ml-auto h-4 w-10"/>) : <>
            <span className="num text-right">{n(add(f => f.actual))}</span>
            <span className="num text-right">{n(add(f => f.rate))}</span>
            <span className="num text-right font-semibold">{n(add(f => f.month))}{band(add(f => f.monthLow), add(f => f.monthHigh))}</span>
            <span className="num text-right font-semibold">{n(add(f => f.next))}{band(add(f => f.nextLow), add(f => f.nextHigh))}</span>
            <span className="num text-right">{money(cost(f => f.month))}</span>
            <span className="num text-right">{money(cost(f => f.next))}</span>
          </>}
        </div>;
      })}
    </div></div>
  </Panel>;
}

export type ModelRef = {id: string; name: string; avatar?: string | null; index: number; ids: CupidIds};
const MODELS = "grid grid-cols-[minmax(170px,1.4fr)_repeat(4,minmax(84px,120px))] items-center gap-2 px-6";

// Which models use a platform's convos: per-model share, stacked by model, any grain, plus each model's forecast.
export function PlatformModels({apps, models, month, today, now}: {apps: CupidApp[]; models: ModelRef[]; month: string; today: string; now: string}) {
  const [pick, setPick] = useState<CupidApp | null>(null), [grain, setGrain] = useState<Grain>("day");
  const app = pick && apps.includes(pick) ? pick : apps[0];
  const linked = app ? models.filter(m => m.ids[app]) : [];
  const data = useCupid(linked.map(m => ({app: app!, creator: m.ids[app!]})), month, grain);
  if (!app) return null;
  const periods = periodsOf(grain, month, today), inWindow = (k: string) => grain === "month" ? periods.includes(k) : grain === "week" ? periods.includes(mondayOf(k)) : k.startsWith(month);
  const totalOf = (s: CupidSeries, metric: keyof Funnel) => Object.entries(valuesOf(s, grain, metric)).reduce((a, [k, v]) => a + (inWindow(k) ? v ?? 0 : 0), 0);
  const ranked = linked.map((m, i) => ({m, s: data[i], used: totalOf(data[i], "charged"), conv: totalOf(data[i], "conversions")})).sort((a, b) => b.used - a.used || a.m.name.localeCompare(b.m.name));
  const all = ranked.reduce((a, r) => a + r.used, 0), allConv = ranked.reduce((a, r) => a + r.conv, 0);
  const pending = data.some(s => s.pending), error = data.find(s => s.error)?.error;
  // Fixed order by rank: the top seven get their own colour, the rest fold into "Other models".
  const top = ranked.slice(0, 7), rest = ranked.slice(7);
  const series: Series[] = [...top.map((r, i) => ({key: `m${i}`, label: r.m.name, color: `var(--model-${i + 1})`})), ...(rest.length ? [{key: "other", label: "Other models", color: "var(--app-other)"}] : [])];
  const chartData = (metric: keyof Funnel) => {
    const byKey: Record<string, Record<string, number | null | undefined>> = Object.fromEntries(top.map((r, i) => [`m${i}`, valuesOf(r.s, grain, metric)]));
    if (rest.length) { const o: Record<string, number> = {}; for (const r of rest) for (const [k, v] of Object.entries(valuesOf(r.s, grain, metric))) o[k] = (o[k] ?? 0) + (v ?? 0); byKey.other = o; }
    return periodRows(grain, periods, byKey);
  };
  const window = grain === "month" ? `${monthName(periods[0])} – ${monthName(month)}` : grain === "week" ? `Weeks since ${short(periods[0] ?? month + "-01")}` : monthName(month);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-[17px] font-semibold">Models by platform</h2><p className="text-[13px] text-muted-foreground">Which models use each platform's convos. Only models with a Cupid ID for the platform are counted.</p></div>
      <div className="flex flex-wrap gap-2"><Segmented size="sm" value={app} options={apps.map(a => [a, APP_LABEL[a]] as const)} onChange={setPick}/><Segmented size="sm" value={grain} options={GRAINS} onChange={setGrain}/></div>
    </div>
    {error && <p className="text-[13px] text-[var(--negative-fg)]">{APP_LABEL[app]} by model: {error.message}</p>}
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartPanel title={`${APP_LABEL[app]} convos used by model`} subtitle={window} series={series} rows={chartData("charged")} loading={pending} empty={linked.length ? "No convos in this window." : `No model has a ${APP_LABEL[app]} Cupid ID.`}/>
      <ChartPanel title={`${APP_LABEL[app]} Cupid conversions by model`} subtitle={window} series={series} rows={chartData("conversions")} loading={pending} empty={linked.length ? "No conversions in this window." : `No model has a ${APP_LABEL[app]} Cupid ID.`}/>
    </div>
    <Panel flush title={`${APP_LABEL[app]} share by model`} subtitle={`${window}. Share is of all linked models' ${APP_LABEL[app]} convos.`}>
      <div className="overflow-x-auto"><div className="min-w-[680px]">
        <div className={cn(MODELS, HEAD)}><span>Model</span>{["Convos used", "Share", "Cupid conv.", "Conv. rate"].map(h => <span key={h} className="text-right">{h}</span>)}</div>
        {!linked.length && <p className="px-6 py-8 text-[13px] text-muted-foreground">No model has a {APP_LABEL[app]} Cupid ID yet.</p>}
        {ranked.map(r => <div key={r.m.id} className={cn(MODELS, ROW)}>
          <a href={`/convos/model/${encodeURIComponent(r.m.id)}`} className="flex min-w-0 items-center gap-2.5 font-semibold hover:underline"><ModelAvatar name={r.m.name} src={r.m.avatar} index={r.m.index}/><span className="truncate">{r.m.name}</span></a>
          {r.s.pending ? [0, 1, 2, 3].map(i => <Skeleton key={i} className="ml-auto h-4 w-10"/>) : r.s.error ? <span className="col-span-4 text-right text-[12px] text-[var(--negative-fg)]">Could not load</span> : <>
            <span className="num text-right font-semibold">{n(r.used)}</span>
            <span className="flex items-center justify-end gap-2"><span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full" style={{width: `${(ratio(r.used, all) ?? 0) * 100}%`, background: `var(--app-${app})`}}/></span><span className="num">{pct(ratio(r.used, all))}</span></span>
            <span className="num text-right">{n(r.conv)}</span>
            <span className="num text-right">{pct(ratio(r.conv, r.used))}</span></>}
        </div>)}
        {ranked.length > 1 && !pending && <div className={cn(MODELS, ROW, "bg-muted/40 font-semibold")}><span>All linked models</span><span className="num text-right">{n(all)}</span><span className="num text-right">100%</span><span className="num text-right">{n(allConv)}</span><span className="num text-right">{pct(ratio(allConv, all))}</span></div>}
      </div></div>
    </Panel>
    {month === now && linked.length > 0 && <ForecastTable title={`${APP_LABEL[app]} forecast by model`} month={month}
      rows={[...ranked.map(r => ({key: r.m.id, label: r.m.name, error: !!r.s.error, parts: [{app, fc: forecastOf(r.s, month, today) || undefined}]})),
        ...(ranked.length > 1 ? [{key: "all", label: "All linked models", strong: true, error: !!error, parts: [{app, fc: forecastSum(data, month, today)}]}] : [])]}/>}
  </section>;
}
