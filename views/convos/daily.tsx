"use client";
import {useState} from "react";
import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from "recharts";
import {Download} from "lucide-react";
import {ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig} from "@/components/ui/chart";
import {Btn, Panel, Skeleton} from "@/components/bh/ui";
import {cn} from "@/lib/utils";
import {APP_LABEL, type CupidApp, type Funnel, ratio, toCsv} from "@/lib/convos";

export type Bucket = CupidApp | "other";
// One day: Cupid's funnel per app (undefined while loading) and real subs per first-touch bucket.
export type Day = {date: string; cupid: Partial<Record<CupidApp, Funnel>>; real: Partial<Record<Bucket, number>> | undefined};

const n = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("en-US");
const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
const config = (keys: Bucket[]): ChartConfig => Object.fromEntries(keys.map(k => [k, {label: k === "other" ? "Other / untracked" : APP_LABEL[k], color: `var(--app-${k})`}]));
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

function Stacked({days, keys, value, loading, empty}: {days: Day[]; keys: Bucket[]; value: (d: Day, k: Bucket) => number | null | undefined; loading: boolean; empty: string}) {
  if (loading) return <Skeleton className="h-[240px] w-full"/>;
  const data = days.map(d => ({date: short(d.date), ...Object.fromEntries(keys.map(k => [k, value(d, k) ?? 0]))}));
  if (!keys.length || data.every(r => keys.every(k => !(r as any)[k]))) return <p className="py-16 text-center text-[13px] text-muted-foreground">{empty}</p>;
  return <ChartContainer config={config(keys)} className="aspect-auto h-[240px] w-full">
    <BarChart data={data} margin={{left: 0, right: 4, top: 8}}>
      <CartesianGrid vertical={false} strokeDasharray="3 3"/>
      <XAxis dataKey="date" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16}/>
      <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false}/>
      <ChartTooltip cursor={{fillOpacity: .5}} content={<ChartTooltipContent/>}/>
      <ChartLegend content={<ChartLegendContent/>}/>
      {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} stroke="var(--surface-card)" strokeWidth={1}
        radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={22}/>)}
    </BarChart>
  </ChartContainer>;
}

const GRID = "grid grid-cols-[minmax(130px,1fr)_repeat(5,minmax(84px,120px))] items-center gap-2 px-6";

export function DailyCharts({days, apps, loading, subsLoading}: {days: Day[]; apps: CupidApp[]; loading: boolean; subsLoading: boolean}) {
  const realKeys: Bucket[] = [...apps, "other"];
  return <div className="grid gap-4 xl:grid-cols-3">
    <Panel title="Daily conversations used" subtitle="Charged conversations, split by platform">
      <Stacked days={days} keys={apps} value={(d, k) => d.cupid[k as CupidApp]?.charged} loading={loading} empty="No conversations yet this month."/>
    </Panel>
    <Panel title="Daily Cupid conversions" subtitle="Subs Cupid claims, split by platform">
      <Stacked days={days} keys={apps} value={(d, k) => d.cupid[k as CupidApp]?.conversions} loading={loading} empty="No Cupid conversions yet this month."/>
    </Panel>
    <Panel title="Daily real OF subs" subtitle="New subs on OnlyFans, by first-touch platform">
      <Stacked days={days} keys={realKeys} value={(d, k) => d.real?.[k]} loading={subsLoading} empty="No real subs yet this month."/>
    </Panel>
  </div>;
}

export function DailyTable({days, apps, month}: {days: Day[]; apps: CupidApp[]; month: string}) {
  const [all, setAll] = useState(false);
  const rows = [...days].reverse(), shown = all ? rows : rows.slice(0, 10);
  const used = (d: Day) => sum(apps.map(a => d.cupid[a]?.charged)), conv = (d: Day) => sum(apps.map(a => d.cupid[a]?.conversions));
  const real = (d: Day) => d.real ? sum(Object.values(d.real)) : null, fromCupid = (d: Day) => d.real ? sum(apps.map(a => d.real![a])) : null;
  const ready = (d: Day) => apps.every(a => d.cupid[a]);
  const exportCsv = () => {
    const head = ["Date", ...apps.flatMap(a => [`${APP_LABEL[a]} convos used`, `${APP_LABEL[a]} Cupid conversions`, `${APP_LABEL[a]} real subs`]), "Other / untracked real subs", "Total convos used", "Total Cupid conversions", "Total real subs"];
    const body = days.map(d => [d.date, ...apps.flatMap(a => [d.cupid[a]?.charged, d.cupid[a]?.conversions, d.real?.[a] ?? null]), d.real?.other ?? null, used(d), conv(d), real(d)]);
    const url = URL.createObjectURL(new Blob([toCsv([head, ...body])], {type: "text/csv"}));
    Object.assign(document.createElement("a"), {href: url, download: `convo-tracker-${month}.csv`}).click();
    URL.revokeObjectURL(url);
  };
  return <Panel flush title="Daily breakdown" subtitle="Every day this month, newest first. Conversions settle a day or two after the chats."
    actions={<Btn variant="outline" size="sm" onClick={exportCsv} disabled={!days.length}><Download className="size-3.5"/>Export CSV</Btn>}>
    <div className="overflow-x-auto"><div className="min-w-[760px]">
      <div className={cn(GRID, "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground")}><span>Date</span>{["Convos used", "Cupid conv.", "Conv. rate", "Real new subs", "From Cupid platforms"].map(h => <span key={h} className="text-right">{h}</span>)}</div>
      {!rows.length && <p className="px-6 py-8 text-[13px] text-muted-foreground">No days to show yet.</p>}
      {shown.map(d => <div key={d.date} className={cn(GRID, "min-h-12 border-b py-1.5 text-[13px] last:border-b-0")}>
        <span className="min-w-0"><span className="block font-semibold">{short(d.date)}</span>
          {ready(d) && <span className="block truncate text-[11.5px] text-muted-foreground">{apps.map(a => `${APP_LABEL[a]} ${n(d.cupid[a]!.charged)}·${n(d.cupid[a]!.conversions)}`).join("  ")}</span>}</span>
        {ready(d) ? <>
          <span className="num text-right font-semibold">{n(used(d))}</span>
          <span className="num text-right font-semibold">{n(conv(d))}</span>
          <span className="num text-right">{pct(ratio(conv(d), used(d)))}</span>
        </> : [0, 1, 2].map(i => <Skeleton key={i} className="ml-auto h-4 w-10"/>)}
        <span className="num text-right">{d.real ? n(real(d)) : <Skeleton className="ml-auto h-4 w-10"/>}</span>
        <span className="num text-right">{d.real ? n(fromCupid(d)) : <Skeleton className="ml-auto h-4 w-10"/>}</span>
      </div>)}
      {rows.length > 10 && <button type="button" onClick={() => setAll(!all)} className="w-full border-t py-2.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">{all ? "Show fewer days" : `Show all ${rows.length} days`}</button>}
    </div></div>
  </Panel>;
}
