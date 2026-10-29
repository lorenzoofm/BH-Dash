"use client";
import {useEffect, useMemo, useState} from "react";
import {Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis} from "recharts";
import {AlertTriangle, ArrowRight, Banknote, CheckCircle2, Target, Trophy, Wallet} from "lucide-react";
import {ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent} from "@/components/ui/chart";
import {Avatar, Bar as Meter, Empty, PageHeader, PageSkeleton, Panel, Segmented, Stat} from "@/components/bh/ui";
import {addDays, label, linkIds, money, mondayOf, num, shortDate, todayIso, weekLabel} from "@/lib/bh";
import {useAccountRevenues, useCreators, useDapAccounts, useTable} from "@/lib/tables";
import {modelPnL} from "@/lib/finance";
import {NavLink} from "@/components/bh/nav-link";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)", "var(--chart-4)", "var(--series-muted)"];

export default function Overview({isAdmin}: {isAdmin: boolean}) {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const staff = useTable("staff"), conv = useTable("conversions"), pay = useTable("paylog"), expenses = useTable("expenses", isAdmin);
  const targets = useTable("expectations"), models = useTable("models", isAdmin), map = useTable("map", isAdmin);
  const monthStart = today ? today.slice(0, 8) + "01" : null;
  const creators = useCreators(monthStart, today, isAdmin);
  // Earnings are DAP revenue only: Model Accounts rows with "Include in P&L" on that the Creatorstaq key can read.
  // A model with no DAP account adds nothing; other accounts in the key are not DAP and are ignored.
  const liveIds = models.rows.filter(m => label(m.fields.status) !== "Ended").map(m => m.id);
  const dap = useDapAccounts(isAdmin);
  const inKey = new Set((dap.data ?? []).map(a => a.slug.toLowerCase()));
  const dapRows = map.rows.filter(r => r.fields.include !== false && inKey.has(label(r.fields.slug).toLowerCase()) && linkIds(r.fields.model).some(id => liveIds.includes(id)));
  const accounts = useAccountRevenues(isAdmin ? dapRows.map(r => label(r.fields.slug).toLowerCase()) : [], monthStart, today);
  const [mode, setMode] = useState<"va" | "total">("va");

  const d = useMemo(() => {
    if (!today || !monthStart) return null;
    const thisWeek = mondayOf(today);
    const weeks = [-21, -14, -7, 0].map(n => addDays(thisWeek, n));
    const name = new Map(staff.rows.map(s => [s.id, label(s.fields.name)]));
    const active = staff.rows.filter(s => label(s.fields.status) === "Active");

    const grid = new Map<string, Map<string, number>>(weeks.map(w => [w, new Map()]));
    for (const r of conv.rows) {
      const day = String(r.fields.week ?? "").slice(0, 10);
      const g = day && grid.get(mondayOf(day));
      if (!g) continue;
      for (const sid of linkIds(r.fields.staff)) g.set(sid, (g.get(sid) ?? 0) + num(r.fields.conversions));
    }
    const total = (w: string) => [...grid.get(w)!.values()].reduce((a, b) => a + b, 0);
    const recent = (sid: string) => (grid.get(weeks[3])!.get(sid) ?? 0) + (grid.get(weeks[2])!.get(sid) ?? 0);
    const ranked = [...new Set(weeks.flatMap(w => [...grid.get(w)!.keys()]))].sort((a, b) => recent(b) - recent(a));
    const series = ranked.slice(0, 8), rest = ranked.slice(8);
    const chart = weeks.map(w => {
      const row: Record<string, any> = {week: w, label: w === thisWeek ? "This week" : shortDate(w), total: total(w)};
      series.forEach(sid => row[sid] = grid.get(w)!.get(sid) ?? 0);
      if (rest.length) row.other = rest.reduce((s, sid) => s + (grid.get(w)!.get(sid) ?? 0), 0);
      return row;
    });
    const keys = [...series, ...(rest.length ? ["other"] : [])];
    const config: ChartConfig = {total: {label: "Conversions", color: "var(--chart-1)"}};
    keys.forEach((k, i) => config[k] = {label: k === "other" ? "Others" : name.get(k) ?? "Unknown", color: COLORS[i]});

    const weekly = (sid: string, w: string) => {
      const t = targets.rows.filter(t => linkIds(t.fields.staff).includes(sid) && String(t.fields.week ?? "").slice(0, 10) <= w && t.fields.weekly != null)
        .sort((a, b) => String(b.fields.week).localeCompare(String(a.fields.week)))[0];
      return t ? num(t.fields.weekly) : null;
    };
    const board = active.map(s => ({
      id: s.id, name: label(s.fields.name), model: label(s.fields.model?.[0]),
      now: grid.get(weeks[3])!.get(s.id) ?? null, last: grid.get(weeks[2])!.get(s.id) ?? null,
      target: weekly(s.id, weeks[3]), lastTarget: weekly(s.id, weeks[2]),
    })).sort((a, b) => (b.now ?? -1) - (a.now ?? -1) || (b.last ?? -1) - (a.last ?? -1));

    // Money, month to date. Shared (unassigned) expenses are counted once, not per model.
    const live = models.rows.filter(m => label(m.fields.status) !== "Ended");
    const opts = {staff: staff.rows, paylog: pay.rows, expenses: expenses.rows, map: map.rows, creators: creators.data ?? [], start: monthStart, end: today, includeShared: false, revenueKnown: creators.isSuccess};
    const netOf = (slug: string) => accounts.data?.[slug.toLowerCase()]?.net ?? null;
    const revenueOf = (modelId: string) => {
      if (!dap.isSuccess || (dapRows.length > 0 && !accounts.isSuccess)) return null;
      const rows = dapRows.filter(r => linkIds(r.fields.model).includes(modelId));
      // A DAP account shared by two live models can't be split, so neither gets revenue.
      if (rows.some(r => linkIds(r.fields.model).filter(id => liveIds.includes(id)).length > 1)) return null;
      // No DAP account means no DAP revenue. A DAP account that can't be read stays unknown, never 0.
      return rows.some(r => netOf(label(r.fields.slug)) === null) ? null : rows.reduce((n, r) => n + netOf(label(r.fields.slug))!, 0);
    };
    const pnls = live.map(m => modelPnL(m, {...opts, accountRevenue: revenueOf(m.id)}));
    const missingRevenue = pnls.filter(p => p.income === null).map(p => p.name);
    const shared = expenses.rows.filter(e => !linkIds(e.fields.model).length && String(e.fields.date ?? "").slice(0, 10) >= monthStart && String(e.fields.date ?? "").slice(0, 10) <= today);
    const sharedPaid = shared.filter(e => label(e.fields.status) === "Paid").reduce((s, e) => s + num(e.fields.amount), 0);
    const income = !dap.isSuccess || (dapRows.length > 0 && !accounts.isSuccess) || missingRevenue.length ? null : pnls.reduce((s, p) => s + p.income!, 0);
    const payoutKnown = pnls.every(p => p.payout !== null);
    const payout = pnls.reduce((s, p) => s + (p.payout ?? 0), 0);
    const wages = pnls.reduce((s, p) => s + p.wages, 0);
    const exp = pnls.reduce((s, p) => s + p.expenses, 0) + sharedPaid;
    const profit = income === null || !payoutKnown ? null : income - payout - wages - exp;

    const lastLogged = new Map<string, string>();
    for (const r of pay.rows) {
      const day = String(r.fields.workDate ?? "").slice(0, 10);
      for (const sid of linkIds(r.fields.staff)) if (day > (lastLogged.get(sid) ?? "")) lastLogged.set(sid, day);
    }
    const unpaidWages = pay.rows.filter(r => label(r.fields.status) !== "Paid").reduce((s, r) => s + num(r.fields.totalPay), 0);
    const alerts: {tone: "red" | "amber"; text: string; href: string}[] = [
      ...active.filter(s => (lastLogged.get(s.id) ?? "") < addDays(today, -2)).map(s => ({tone: "amber" as const, text: `${label(s.fields.name)} — no hours logged since ${lastLogged.get(s.id) ? shortDate(lastLogged.get(s.id)!) : "ever"}`, href: "/pay-hours"})),
      ...active.filter(s => !grid.get(weeks[2])!.has(s.id)).map(s => ({tone: "amber" as const, text: `${label(s.fields.name)} — last week’s conversions not entered`, href: "/conversions"})),
      ...board.filter(b => b.lastTarget !== null && b.last !== null && b.last < b.lastTarget).map(b => ({tone: "red" as const, text: `${b.name} — missed target last week (${b.last}/${b.lastTarget})`, href: "/staff"})),
      ...(isAdmin ? live.filter(m => !pnls.find(p => p.modelId === m.id)?.linked).map(m => ({tone: "amber" as const, text: map.rows.some(r => r.fields.include !== false && linkIds(r.fields.model).includes(m.id)) ? `${label(m.fields.model)} — DAP account revenue could not be read` : `${label(m.fields.model)} — no DAP account connected`, href: "/pnl"})) : []),
    ];
    const daysIn = Math.round((Date.parse(today) - Date.parse(thisWeek)) / 864e5) + 1;
    return {thisWeek, weeks, chart, keys, config, board, income, payout, wages, exp, profit, unpaidWages, alerts, daysIn, missingRevenue, dapCount: dapRows.length,
      thisTotal: total(weeks[3]), lastTotal: total(weeks[2]), activeCount: active.length};
  }, [today, staff.rows, conv.rows, pay.rows, expenses.rows, targets.rows, models.rows, map.rows, creators.data, creators.isSuccess, dap.data, dap.isSuccess, accounts.data, accounts.isSuccess, isAdmin]);

  const tables = [staff, conv, pay, expenses, targets, models, map];
  if (tables.some(t => t.error)) return <Empty icon={AlertTriangle} title="Couldn’t load data from the BH database">{tables.find(t => t.error)?.error?.message || "Refresh the page to try again."}</Empty>;
  if (!d || tables.some(t => t.loading)) return <PageSkeleton/>;
  const maxNow = Math.max(1, ...d.board.map(b => Math.max(b.now ?? 0, b.target ?? 0)));

  return <div className="space-y-6">
    <PageHeader eyebrow={`Week of ${weekLabel(d.thisWeek)} · day ${d.daysIn}/7`} title="Overview" subtitle={`${d.activeCount} active staff${isAdmin ? ` · month to date figures from ${shortDate(monthStart!)}` : ""}`}/>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {isAdmin && <><Stat accent label="Profit · this month" icon={Wallet} value={d.profit === null ? "—" : money(d.profit)} tone={d.profit === null ? "" : d.profit >= 0 ? "positive" : "negative"}
        sub={<NavLink href="/pnl" className="inline-flex items-center gap-1 hover:text-signal">Open P&amp;L <ArrowRight className="size-3"/></NavLink>}/>
      <Stat label="Earnings · this month" icon={Banknote} value={d.income === null ? "—" : money(d.income)}
        sub={dap.isError || accounts.isError ? "Creator Staq unavailable" : dap.isPending || (dapRows.length > 0 && accounts.isPending) ? "Loading DAP revenue…" : d.income === null ? `DAP revenue couldn’t be read for ${d.missingRevenue.join(", ") || "every model"}` : `${d.dapCount} DAP account${d.dapCount === 1 ? "" : "s"}${d.payout ? ` · ${money(d.payout)} to models` : ""}`}/>
      <Stat label="Costs · this month" icon={Wallet} value={money(d.wages + d.exp)} sub={`${money(d.wages)} wages · ${money(d.exp)} expenses`}/></>}
      <Stat label="Conversions · this week" icon={Target} value={d.thisTotal.toLocaleString()} delta={d.lastTotal ? d.thisTotal - d.lastTotal : null} deltaLabel="vs last week" sub={`Last week ${d.lastTotal}`}/>
    </div>

    <div className="grid gap-6 xl:grid-cols-3">
      <Panel className="xl:col-span-2" title="Conversions" subtitle="This week and the three before it. Rolls forward every Monday."
        actions={<Segmented size="sm" value={mode} onChange={setMode} options={[["va", "By VA"], ["total", "Total"]] as const}/>}>
        {d.chart.every(w => w.total === 0) ? <Empty icon={Target} title="No conversions for these weeks yet"><a href="/conversions" className="font-medium text-foreground underline">Enter this week’s numbers</a></Empty> : <>
          <ChartContainer config={d.config} className="aspect-auto h-[300px] w-full">
            <BarChart data={d.chart} margin={{top: 22, left: -18, right: 4}} barCategoryGap="28%">
              <CartesianGrid vertical={false} strokeDasharray="3 3"/>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10}/>
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={48}/>
              <ChartTooltip cursor={{fill: "var(--muted)", opacity: 0.6}} content={<ChartTooltipContent labelFormatter={(_: any, p: any) => weekLabel(p?.[0]?.payload?.week ?? d.thisWeek)}/>}/>
              {mode === "total"
                ? <Bar dataKey="total" fill="var(--color-total)" radius={[6, 6, 0, 0]}><LabelList dataKey="total" position="top" className="num fill-foreground text-[12px] font-semibold"/></Bar>
                : d.keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} radius={i === d.keys.length - 1 ? [6, 6, 0, 0] : 0}>
                  {i === d.keys.length - 1 && <LabelList dataKey="total" position="top" className="num fill-foreground text-[12px] font-semibold"/>}
                </Bar>)}
            </BarChart>
          </ChartContainer>
          {mode === "va" && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-3">
            {d.keys.map((k, i) => <span key={k} className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><span className="size-2 rounded-sm" style={{background: COLORS[i]}}/>{String(d.config[k].label)}</span>)}
          </div>}
        </>}
      </Panel>

      <Panel title="Leaderboard" icon={Trophy} subtitle="This week so far vs weekly target" bodyClass="pt-3">
        <ul className="space-y-3.5">{d.board.map((b, i) => <li key={b.id} className="flex items-center gap-3">
          <span className="num w-4 text-[12px] text-muted-foreground">{i + 1}</span>
          <Avatar name={b.name}/>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{b.name}</span>
              <span className="num text-[13px] font-semibold">{b.now ?? "—"}{b.target !== null && <span className="font-normal text-muted-foreground">/{b.target}</span>}</span>
            </div>
            <div className="mt-1.5"><Meter value={b.now ?? 0} max={b.target ?? maxNow} className={b.target !== null && (b.now ?? 0) >= b.target ? "bg-positive" : "bg-brand"}/></div>
          </div>
        </li>)}</ul>
        {!d.board.length && <Empty title="No active staff"/>}
      </Panel>
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Needs attention" icon={AlertTriangle} subtitle={d.alerts.length ? `${d.alerts.length} item${d.alerts.length === 1 ? "" : "s"}` : undefined} bodyClass="pt-3">
        {d.alerts.length ? <ul className="divide-y">{d.alerts.slice(0, 8).map((a, i) => <li key={i}>
          <NavLink href={a.href} className="group flex items-center gap-3 py-2.5 text-[13px]">
            <span className={"size-1.5 shrink-0 rounded-full " + (a.tone === "red" ? "bg-negative" : "bg-warning")}/>
            <span className="flex-1">{a.text}</span>
            <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100"/>
          </NavLink></li>)}</ul>
        : <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><CheckCircle2 className="size-4 text-positive"/>Everything is up to date.</div>}
      </Panel>
      {isAdmin && <Panel title="Month to date" subtitle="How this month’s money breaks down" bodyClass="pt-3">
        <div className="space-y-3">
          {[["Earnings", d.income, "bg-foreground"], ["Model payout", d.income === null ? null : -d.payout, "bg-chart-4"], ["Staff wages", -d.wages, "bg-brand"], ["Expenses", -d.exp, "bg-chart-2"]].map(([name, v, cls]) => {
            const max = Math.max(1, d.income ?? 0, d.wages + d.exp);
            return <div key={name as string} className="grid grid-cols-[100px_1fr_96px] items-center gap-3 text-[13px]">
              <span className="text-muted-foreground">{name as string}</span>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={"h-full rounded-full " + cls} style={{width: `${v === null ? 0 : Math.abs(v as number) / max * 100}%`}}/></div>
              <span className="num text-right">{v === null ? "—" : money(v as number)}</span>
            </div>;
          })}
          <div className="grid grid-cols-[100px_1fr_96px] items-center gap-3 border-t pt-3 text-[13px] font-semibold">
            <span>Profit</span><span/><span className={"num text-right " + (d.profit === null ? "" : d.profit >= 0 ? "text-positive" : "text-negative")}>{d.profit === null ? "—" : money(d.profit)}</span>
          </div>
          <p className="pt-1 text-[12px] text-muted-foreground">Unpaid wages outstanding (all time): <span className="num font-medium text-foreground">{money(d.unpaidWages)}</span></p>
        </div>
      </Panel>}
    </div>
  </div>;
}
