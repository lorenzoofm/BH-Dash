"use client";
// Building blocks shared by the Convo Tracker and its model pages: data hooks, the month stepper, the four
// headline stats and the three charts. Both pages compose these and nothing else repeats a number.
import {useState} from "react";
import {useQueries} from "@tanstack/react-query";
import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from "recharts";
import {MessagesSquare} from "lucide-react";
import {ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig} from "@/components/ui/chart";
import {Panel, Skeleton, Stat, WeekStepper} from "@/components/bh/ui";
import {mondayOf} from "@/lib/bh";
import {APP_LABEL, type CupidApp, CONVO_PRICE, convoCost, type Forecast, forecast, type Funnel, monthDays, ratio, shiftMonth, sourceBucket} from "@/lib/convos";

export async function get<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch("/api/convos?" + new URLSearchParams(params));
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export type Grain = "day" | "week" | "month";
export const GRAINS = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] as const;
export const n = (v: number | null | undefined) => v == null ? "—" : Math.round(v).toLocaleString("en-US");
export const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
export const money = (v: number | null) => v == null ? (Object.keys(CONVO_PRICE).length ? "—" : "Set pricing") : v.toLocaleString("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
export const monthName = (m: string) => new Date(m + "-15").toLocaleString("en-US", {month: "short", year: "numeric", timeZone: "UTC"});
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
const STALE = {staleTime: 300000, retry: 1};

// Periods shown for a grain: the month's days; Monday weeks across this and last month; the six months up to this one.
function periodsOf(grain: Grain, month: string, today: string) {
  if (grain === "month") return Array.from({length: 6}, (_, i) => shiftMonth(month, i - 5));
  if (grain === "day") return monthDays(month, today);
  const prev = shiftMonth(month, -1);
  return [...new Set([...monthDays(prev, today), ...monthDays(month, today)].map(mondayOf))].filter(w => w >= prev + "-01");
}

// Cupid by day for the month (always: stats and the forecast need it), plus last month for weeks or six monthly totals.
type Target = {app: CupidApp; creator?: string};
export function useCupid(targets: Target[], month: string | null, grain: Grain) {
  const m = month ?? "";
  const q = <T,>(kind: string, mm: string, t: Target, enabled: boolean) => ({queryKey: [kind, mm, t.app, t.creator ?? ""], enabled: !!month && enabled, ...STALE,
    queryFn: () => get<T>({kind, month: mm, app: t.app, ...(t.creator ? {creator: t.creator} : {})})});
  const cur = useQueries({queries: targets.map(t => q<{days: ({date: string} & Funnel)[]}>("cupid-daily", m, t, true))});
  const before = useQueries({queries: targets.map(t => q<{days: ({date: string} & Funnel)[]}>("cupid-daily", m && shiftMonth(m, -1), t, grain === "week"))});
  const hist = useQueries({queries: targets.map(t => q<{months: ({month: string} & Funnel)[]}>("cupid-months", m, t, grain === "month"))});
  return targets.map((t, i) => {
    const needed = [cur[i], ...(grain === "week" ? [before[i]] : []), ...(grain === "month" ? [hist[i]] : [])];
    return {...t, monthDays: cur[i].data?.days, pending: needed.some(x => x.isPending), error: needed.find(x => x.error)?.error as Error | undefined,
      days: Object.fromEntries([...(before[i].data?.days ?? []), ...(cur[i].data?.days ?? [])].map(d => [d.date, d])) as Record<string, Funnel>,
      months: Object.fromEntries((hist[i].data?.months ?? []).map(r => [r.month, r])) as Record<string, Funnel>};
  });
}
export type CupidSeries = ReturnType<typeof useCupid>[number];
export const forecastOf = (s: CupidSeries | undefined, month: string, today: string) => s?.monthDays && forecast(s.monthDays.map(d => ({date: d.date, v: d.charged})), month, today);
// Sum of one metric over the month, undefined while any series is loading.
export const monthTotal = (all: CupidSeries[], metric: keyof Funnel) => all.every(s => s.monthDays) ? all.reduce((a, s) => a + s.monthDays!.reduce((b, d) => b + (d[metric] ?? 0), 0), 0) : undefined;

// Creatorstaq new subs per OF account: this month by first-touch source and day, plus last month for weeks or six monthly totals.
type SubsMonth = {newSubs: number | null; bySource: Record<string, number>; byDay: Record<string, Record<string, number>>; capped: boolean};
export function useSubs(slugs: string[], month: string | null, grain: Grain) {
  const m = month ?? "";
  const q = (kind: string, mm: string, account: string, enabled: boolean) => ({queryKey: [kind, mm, account], enabled: !!month && enabled, ...STALE, queryFn: () => get<any>({kind, month: mm, account})});
  const cur = useQueries({queries: slugs.map(a => q("subs", m, a, true))});
  const before = useQueries({queries: slugs.map(a => q("subs", m && shiftMonth(m, -1), a, grain === "week"))});
  const hist = useQueries({queries: slugs.map(a => q("subs-months", m, a, grain === "month"))});
  return slugs.map((slug, i) => {
    const needed = [cur[i], ...(grain === "week" ? [before[i]] : []), ...(grain === "month" ? [hist[i]] : [])];
    return {slug, month: cur[i].data as SubsMonth | undefined, monthError: cur[i].error as Error | null, pending: needed.some(x => x.isPending), error: needed.find(x => x.error)?.error as Error | undefined,
      byDay: {...(before[i].data as SubsMonth | undefined)?.byDay, ...(cur[i].data as SubsMonth | undefined)?.byDay},
      months: Object.fromEntries(((hist[i].data?.months ?? []) as {month: string; newSubs: number | null}[]).map(r => [r.month, r.newSubs ?? 0]))};
  });
}
export type SubsSeries = ReturnType<typeof useSubs>[number];
// undefined while loading, null when Creatorstaq failed.
export const settled = <T,>(subs: SubsSeries[], f: (months: SubsMonth[]) => T): T | null | undefined =>
  subs.some(s => s.monthError) ? null : subs.some(s => !s.month) ? undefined : f(subs.map(s => s.month!));
export const subsByDay = (subs: SubsSeries[], keep: (source: string) => boolean) => {
  const out: Record<string, number> = {};
  for (const s of subs) for (const [d, src] of Object.entries(s.byDay)) for (const [k, c] of Object.entries(src)) if (keep(k)) out[d] = (out[d] ?? 0) + c;
  return out;
};
export const subsByMonth = (subs: SubsSeries[]) => subs.reduce<Record<string, number>>((a, s) => { for (const [k, v] of Object.entries(s.months)) a[k] = (a[k] ?? 0) + v; return a; }, {});

export type Stack = {key: string; label: string; color: string};
// Real subs stacked by first-touch platform (sources outside `apps` fold into Other), or Creatorstaq's monthly total.
export function realStacks(apps: CupidApp[], subs: SubsSeries[], grain: Grain): (Stack & {values: Record<string, number>})[] {
  if (grain === "month") return [{key: "total", label: "Real new subs", color: "var(--app-other)", values: subsByMonth(subs)}];
  const bucket = (src: string) => { const b = sourceBucket(src); return b !== "other" && apps.includes(b) ? b : "other"; };
  return [...apps, "other" as const].map(k => ({key: k, label: k === "other" ? "Other / untracked" : APP_LABEL[k], color: `var(--app-${k})`, values: subsByDay(subs, src => bucket(src) === k)}));
}

export function MonthStepper({month, now, onChange}: {month: string; now: string; onChange: (m: string) => void}) {
  return <WeekStepper label={new Date(month + "-15").toLocaleString("en-US", {month: "long", year: "numeric", timeZone: "UTC"})}
    onPrev={() => onChange(shiftMonth(month, -1))} onNext={() => onChange(shiftMonth(month, 1))} nextDisabled={month >= now}
    badge={month === now && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-[var(--signal-tint-fg)]">So far</span>}/>;
}

// The month's headline numbers. `fc` is one forecast per platform while the month is running, else null.
export function Summary({month, used, conv, real, realSub, fc}: {month: string; used: number | null | undefined; conv: number | null | undefined; real: number | null | undefined; realSub: React.ReactNode; fc: {app: CupidApp; fc: Forecast | undefined}[] | null}) {
  const ready = fc?.every(p => p.fc), add = (pick: (f: Forecast) => number | null) => ready ? fc!.reduce<number | null>((a, p) => a == null || pick(p.fc!) == null ? null : a + pick(p.fc!)!, 0) : undefined;
  const cost = (pick: (f: Forecast) => number | null) => { const c = fc!.map(p => convoCost(pick(p.fc!), p.app)); return c.some(x => x == null) ? null : c.reduce<number>((a, x) => a + x!, 0); };
  const show = (v: number | null | undefined) => v === undefined ? "…" : n(v), next = shiftMonth(month, 1);
  return <div className={`grid gap-4 sm:grid-cols-2 ${fc ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
    <Stat label="Convos used" icon={MessagesSquare} value={show(used)} sub={`${monthName(month)}, charged conversations`}/>
    <Stat label="Cupid conversions" value={show(conv)} sub={`${pct(ratio(conv, used))} conversion rate`}/>
    <Stat label="Real OF subs" value={show(real)} sub={realSub}/>
    {fc && <Stat label={`Projected ${monthName(month)}`} value={show(add(f => f.month))}
      sub={!ready ? "…" : `${monthName(next)}: ${n(add(f => f.next))} · ${Object.keys(CONVO_PRICE).length ? `Cost ${money(cost(f => f.month))} / ${money(cost(f => f.next))}` : "Set pricing for cost"}`}/>}
  </div>;
}

// A stacked bar chart with a Chart / Table switch. Rows are periods ({label, [series key]: value}).
function ChartPanel({title, subtitle, rows, series, loading, empty}: {title: string; subtitle: string; rows: ({label: string} & Record<string, any>)[]; series: Stack[]; loading: boolean; empty: string}) {
  const [table, setTable] = useState(false);
  const config: ChartConfig = Object.fromEntries(series.map(s => [s.key, {label: s.label, color: s.color}]));
  const blank = !series.length || rows.every(r => series.every(s => !r[s.key]));
  return <Panel title={title} subtitle={subtitle}
    actions={!loading && !blank && <button type="button" onClick={() => setTable(!table)} className="text-[12px] font-semibold text-muted-foreground hover:text-foreground">{table ? "Chart" : "Table"}</button>}>
    {loading ? <Skeleton className="h-[240px] w-full"/>
      : blank ? <p className="py-16 text-center text-[13px] text-muted-foreground">{empty}</p>
      : table ? <div className="max-h-[240px] overflow-auto"><table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="py-1 pr-3 text-left font-medium">Period</th>{series.map(s => <th key={s.key} className="whitespace-nowrap px-2 py-1 text-right font-medium">{s.label}</th>)}<th className="py-1 pl-2 text-right font-medium">Total</th></tr></thead>
          <tbody>{[...rows].reverse().map(r => <tr key={r.label} className="border-t"><td className="whitespace-nowrap py-1 pr-3">{r.label}</td>{series.map(s => <td key={s.key} className="num px-2 py-1 text-right">{n(r[s.key])}</td>)}<td className="num py-1 pl-2 text-right font-semibold">{n(series.reduce((a, s) => a + (r[s.key] ?? 0), 0))}</td></tr>)}</tbody>
        </table></div>
      : <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
        <BarChart data={rows} margin={{left: 0, right: 4, top: 8}}>
          <CartesianGrid vertical={false} strokeDasharray="3 3"/>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16}/>
          <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false}/>
          <ChartTooltip cursor={{fillOpacity: .5}} content={<ChartTooltipContent/>}/>
          {series.length > 1 && <ChartLegend content={<ChartLegendContent/>}/>}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} stackId="a" fill={`var(--color-${s.key})`} stroke="var(--surface-card)" strokeWidth={1}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={22}/>)}
        </BarChart>
      </ChartContainer>}
  </Panel>;
}

// One chart per metric for the chosen grain. Stacks past the seventh fold into "Other" (the palette has seven).
type Values = Stack & {values: Record<string, number | null | undefined>};
export function Charts({grain, month, today, by, cupid, cupidLoading, real, realLoading, realEmpty}: {grain: Grain; month: string; today: string; by: string;
  cupid: (Stack & {s: CupidSeries})[]; cupidLoading: boolean; real: Values[] | null; realLoading: boolean; realEmpty: string}) {
  const periods = periodsOf(grain, month, today);
  const label = (p: string) => grain === "month" ? monthName(p) : grain === "week" ? "Wk " + short(p) : short(p);
  const chart = (stacks: Values[]) => {
    const keep = stacks.length > 8 ? stacks.slice(0, 7) : stacks, rest = stacks.slice(keep.length);
    const all: Values[] = rest.length ? [...keep, {key: "other", label: "Other", color: "var(--app-other)", values: subsSum(rest)}] : keep;
    return {series: all as Stack[], rows: periods.map(p => ({label: label(p), ...Object.fromEntries(all.map(s => [s.key,
      grain === "week" ? Object.entries(s.values).reduce((a, [d, v]) => a + (mondayOf(d) === p ? v ?? 0 : 0), 0) : s.values[p] ?? 0]))}))};
  };
  const metric = (m: keyof Funnel) => chart(cupid.map(c => ({...c, values: Object.fromEntries(Object.entries(grain === "month" ? c.s.months : c.s.days).map(([k, f]) => [k, f[m]]))})));
  const sub = `${grain === "month" ? `${monthName(periods[0])} – ${monthName(month)}` : grain === "week" ? `Weeks since ${short(periods[0] ?? month + "-01")}` : monthName(month)} · by ${by}`;
  return <div className="grid gap-4 xl:grid-cols-3">
    <ChartPanel title="Convos used" subtitle={sub} {...metric("charged")} loading={cupidLoading} empty="No convos in this window."/>
    <ChartPanel title="Cupid conversions" subtitle={sub} {...metric("conversions")} loading={cupidLoading} empty="No conversions in this window."/>
    <ChartPanel title="Real OF subs" subtitle={grain === "month" ? `${sub.split(" · ")[0]} · all sources` : sub} {...chart(real ?? [])} loading={!!real && realLoading} empty={realEmpty}/>
  </div>;
}
const subsSum = (xs: Values[]) => xs.reduce<Record<string, number>>((a, x) => { for (const [k, v] of Object.entries(x.values)) a[k] = (a[k] ?? 0) + (v ?? 0); return a; }, {});

export const FOOTNOTE = "Months are UTC on both sides so Cupid and Creatorstaq line up. Cupid detects conversions from the chat, so they are claims, and they settle a day or two after the chats; recent days read low. Real subs by platform only count fans whose first touch was a tracking link tagged with that platform. Weeks start on Monday. Forecast: rate = average convos used per day over the last 7 complete days (month to date early on); this month = complete days + rate × days left; next month = rate × its days.";
