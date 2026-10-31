"use client";
import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {PageSkeleton, TableError, ModelAvatar} from "@/components/bh/ui";
import {NavLink} from "@/components/bh/nav-link";
import {addDays, label, linkIds, money, num, shortDate, todayIso, weekLabel} from "@/lib/bh";
import {useAccountRevenues, useDapAccounts, useModels, useTable} from "@/lib/tables";
import {useProxyFetch} from "@/lib/datasource";
import {accountRows, dapRevenueFor, monthlyHistory} from "@/lib/finance";
import {usePayData} from "@/lib/pay-data";
import {initials} from "@/lib/team";
import {overview, type BoardTone} from "@/lib/overview";
import type {Page} from "@/lib/page-access-constants";

const MONTHLY = "https://api.creatorstaq.com/v1/computed/revenue/monthly?months=12";
const WDL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hf = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US");
const pct = (a: number | null, b: number | null) => a === null || !b ? null : Math.round((a - b) / Math.abs(b) * 100);
const arrow = (p: number) => (p >= 0 ? "↗ " : "↘ ") + Math.abs(p) + "%";

// Shared looks from the prototype, in theme tokens.
const CARD = "min-w-0 rounded-[16px] border border-[var(--border-faint)] bg-[var(--surface-card)] shadow-[0_1px_2px_#0a0a0a0a,0_8px_24px_-12px_#0a0a0a14]";
const H2 = "m-0 text-[14px] font-bold tracking-[-0.01em] text-[var(--text-heading)]";
const MUTED = "var(--text-faint)", LINE = "var(--border-faint)", HOVER = "hover:bg-[var(--surface-page)]";
const TONE: Record<BoardTone, string> = {met: "#1f7a45", pace: "var(--text-heading)", behind: "#e3a33b", missing: "var(--ink-200)", none: "var(--ink-200)"};

// A link when its page is visible to this user, otherwise plain.
function Go({href, className, style, children}: {href?: string; className?: string; style?: React.CSSProperties; children: React.ReactNode}) {
  return href ? <NavLink href={href} className={className} style={style}>{children}</NavLink> : <div className={className} style={style}>{children}</div>;
}

export default function Overview({pages}: {pages: Page[]}) {
  const can = (p: Page) => pages.includes(p);
  const fin = can("pnl"), convOn = can("conversions"), payOn = fin || can("pay-hours"), expOn = fin || can("expenses");
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const [all, setAll] = useState(false);

  const staff = useTable("staff"), conv = useTable("conversions", convOn), pay = usePayData(payOn), expenses = useTable("expenses", expOn);
  const models = useModels(fin), map = useTable("map", fin);
  // Earnings are DAP revenue only: Model Accounts rows with "Include in P&L" on that the Creatorstaq key can read.
  const dap = useDapAccounts(fin);
  const liveIds = models.rows.filter(m => label(m.fields.status) !== "Ended").map(m => m.id);
  const dapRows = accountRows(dap.data ?? [], map.rows).filter(r => r.fields.include !== false && linkIds(r.fields.model).some(id => liveIds.includes(id)));
  const slugs = fin ? dapRows.map(r => label(r.fields.slug).toLowerCase()) : [];
  const mStart = today ? today.slice(0, 8) + "01" : null;
  const lmStart = mStart ? addDays(mStart, -1).slice(0, 8) + "01" : null;
  const lmSame = today && lmStart ? lmStart.slice(0, 8) + String(Math.min(Number(today.slice(8)), Number(addDays(mStart!, -1).slice(8)))).padStart(2, "0") : null;
  const mtdRev = useAccountRevenues(slugs, mStart, today), lmRev = useAccountRevenues(slugs, lmStart, lmSame);
  const proxyFetch = useProxyFetch("live");
  // Same query as the Revenue page, so the cache is shared.
  const monthly = useQuery({queryKey: ["bh-monthly"], enabled: fin, staleTime: 300000, retry: 1, queryFn: async () => {
    const res = await proxyFetch(MONTHLY);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Creator Staq returned ${res.status}`);
    return (body.monthly_by_account ?? []) as {month: string; accounts: {account_id: number; name: string; net: number | string}[]}[];
  }});

  const tables = [staff, conv, expenses, models, map, ...pay.tables];
  const loading = tables.some(t => t.loading);
  const D = useMemo(() => {
    if (!today || loading) return null;
    const ready = (q: {isSuccess: boolean}) => dap.isSuccess && (dapRows.length === 0 || q.isSuccess);
    const months = monthlyHistory(monthly.data ?? [], dapRows, today.slice(0, 7)).chart.slice(-6).map(m => m.total);
    return overview({today, can, staff: staff.rows, conversions: conv.rows, pay, expenses: expenses.rows, models: models.rows, map: map.rows, revenue: {
      mtd: id => dapRevenueFor(id, dapRows, liveIds, ready(mtdRev), mtdRev.data), lm: id => dapRevenueFor(id, dapRows, liveIds, ready(lmRev), lmRev.data),
      ready: ready(mtdRev) && !mtdRev.isFetching, months}});
  }, [today, loading, staff.rows, conv.rows, pay.data, pay.vas, expenses.rows, models.rows, map.rows, dap.data, dap.isSuccess, mtdRev.data, mtdRev.isSuccess, mtdRev.isFetching, lmRev.data, lmRev.isSuccess, monthly.data, pages]);

  if (tables.some(t => t.error)) return <TableError tables={tables}/>;
  if (!D) return <PageSkeleton/>;
  const M = D.mtd, wt = D.weekTotals, mxW = Math.max(1, ...wt);
  const href = (p: Page) => can(p) ? "/" + p : undefined;

  const dp = M.profit === null || D.lm.profit === null ? null : pct(M.profit, D.lm.profit);
  const di = pct(M.income, D.lm.income);
  const costs = M.payout + M.wages + M.exp;
  const maxSched = Math.max(1, ...D.hours.map(y => y.sched)), maxRev = Math.max(1, ...D.months);
  const strip = [
    fin && {k: "Earnings · MTD", v: money(M.income), d: di === null ? "" : arrow(di), dc: (di ?? 0) >= 0 ? "var(--positive-fg)" : "var(--negative-fg)", href: href("revenue") ?? href("pnl"),
      sp: D.months.map((v, i, a) => ({h: Math.max(10, v / maxRev * 100), c: i === a.length - 1 ? "var(--signal)" : "var(--ink-200)"}))},
    fin && {k: "Costs · MTD", v: money(costs), href: href("pnl")},
    fin && {k: "Margin", v: M.income && M.profit !== null ? Math.round(M.profit / M.income * 100) + "%" : "—", href: href("pnl")},
    payOn && {k: "Hours · this week", v: hf(D.hoursTotal), d: "of " + hf(D.hoursSched), href: href("pay-hours"),
      sp: D.hours.map(x => ({h: Math.max(10, (x.future ? 0 : x.h) / maxSched * 100), c: x.today ? "var(--signal)" : "var(--ink-200)"}))},
    payOn && {k: "Wages unpaid", v: money(D.unpaid), d: "pays " + D.run.payDate, href: href("pay-hours")},
    expOn && {k: "Expenses outstanding", v: money(D.openTotal), d: D.open.length + " items", dc: D.open.length ? "var(--warning-fg)" : undefined, href: href("expenses")},
  ].filter(Boolean) as {k: string; v: string; d?: string; dc?: string; href?: string; sp?: {h: number; c: string}[]}[];

  const behind = D.board.filter(b => b.tone === "behind").map(b => b.first);
  const paceBars = (["met", "pace", "behind", "missing"] as const).map(k => ({k, n: D.board.filter(b => b.tone === k).length, c: TONE[k]}));
  const mxP = Math.max(1, ...paceBars.map(p => p.n));
  const minis = [
    convOn && {label: "Conversions this week", value: String(wt[3]), of: `vs ${wt[2]} last`, href: "/conversions",
      bars: wt.map((v, i) => ({h: Math.max(8, v / mxW * 100), c: i === 3 ? "var(--signal)" : "var(--text-heading)", t: weekLabel(D.weeks[i]) + ": " + v})),
      sub: D.lwMissing.length ? "Last week missing " + D.lwMissing.join(", ") : "Last week complete", sc: D.lwMissing.length ? "var(--warning-fg)" : "var(--positive-fg)"},
    convOn && {label: `On pace · day ${D.day}/7`, value: `${D.onPace}/${D.judged}`, of: "VAs", href: "/conversions",
      bars: paceBars.map(p => ({h: Math.max(8, p.n / mxP * 100), c: p.c, t: p.k + ": " + p.n})),
      sub: behind.length ? "Behind: " + behind.join(", ") : "Nobody behind", sc: behind.length ? "var(--warning-fg)" : "var(--positive-fg)"},
    can("pay-hours") && {label: "Pay run · " + D.run.label, value: money(D.run.total), of: "so far", href: "/pay-hours",
      bars: Array.from({length: D.run.n}, (_, i) => ({h: 100, c: i < D.run.checked ? "var(--text-heading)" : LINE, t: ""})),
      sub: `${D.run.checked} of ${D.run.n} checked · pays ${D.run.payDate}`, sc: D.run.fix ? "var(--negative-fg)" : MUTED},
  ].filter(Boolean) as {label: string; value: string; of: string; href: string; bars: {h: number; c: string; t: string}[]; sub: string; sc: string}[];

  const split = ([["Model payout", M.payout, "#6e6a63"], ["Wages", M.wages, "#ff3000"], ["Expenses", M.exp, "#c9c4bb"], ["Profit", Math.max(0, M.profit ?? 0), "#f4f1ea"]] as const)
    .map(([k, v, c]) => ({k, v, c}));
  const limit = all ? Infinity : 7;

  return <div className="flex flex-col gap-3">
    <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
      <div>
        <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.14em]" style={{color: MUTED}}><span className="size-1.5 rounded-full bg-[var(--signal)]"/>
          {WDL[new Date(D.T + "T00:00:00Z").getUTCDay()]} {shortDate(D.T)} · week of {weekLabel(D.wk)} · day {D.day}/7</div>
        <h1 className="m-0 text-[40px] font-extrabold leading-[.95] tracking-[-0.045em] text-[var(--text-heading)]">Overview</h1>
      </div>
      {fin && <a href="/detailed/overview" className="text-[12px] font-semibold hover:text-[var(--signal)]" style={{color: MUTED}}>Detailed reports →</a>}
    </div>

    {strip.length > 0 && <div className="grid overflow-hidden rounded-[12px] border border-[var(--border-faint)] bg-[var(--surface-card)]" style={{gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))"}}>
      {strip.map(k => <Go key={k.k} href={k.href} className={"min-w-0 border-r px-3 py-2 text-[var(--text-heading)] " + (k.href ? HOVER : "")} style={{borderColor: LINE}}>
        <div className="truncate text-[11px]" style={{color: MUTED}}>{k.k}</div>
        <div className="mt-[3px] flex items-baseline gap-1.5">
          <span className="num text-[16px] font-bold tracking-[-0.03em]">{k.v}</span>
          {k.d && <span className="num whitespace-nowrap text-[11px] font-semibold" style={{color: k.dc ?? MUTED}}>{k.d}</span>}
          <span className="ml-auto flex h-4 items-end gap-0.5">{k.sp?.map((b, i) => <span key={i} className="w-[3px] rounded-[1px]" style={{height: b.h + "%", background: b.c}}/>)}</span>
        </div>
      </Go>)}
    </div>}

    {(fin || minis.length > 0) && <div className="flex flex-wrap gap-3">
      {fin && <div className="flex min-w-0 flex-col justify-between gap-3 rounded-[16px] px-[18px] py-4 shadow-[0_8px_24px_-12px_#0a0a0a66]" style={{flex: "7 1 460px", background: "var(--ink)", color: "var(--paper)"}}>
        <div className="flex items-center justify-between text-[13px] font-medium text-[#f4f1ea99]">Profit this month
          {href("pnl") && <NavLink href="/pnl" className="text-[12px] font-semibold text-[#f4f1ea] hover:text-[var(--signal)]">Open P&amp;L →</NavLink>}</div>
        <div className="flex flex-wrap items-baseline gap-3.5">
          <span className="num text-[40px] font-extrabold leading-[.9] tracking-[-0.06em]" style={{color: (M.profit ?? 0) >= 0 ? "#f4f1ea" : "#ff8a73"}}>{money(M.profit)}</span>
          {M.profit !== null && D.lm.profit !== null && <span className="num inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold"
            style={{background: (dp ?? 0) >= 0 ? "#1f7a4533" : "#c01d1d33", color: (dp ?? 0) >= 0 ? "#7fd3a0" : "#ff8a73"}}>{dp === null ? "First month" : arrow(dp) + " vs same day last month"}</span>}
        </div>
        <div>
          <div className="flex h-2.5 gap-[3px]">{split.map(s => <span key={s.k} title={`${s.k} ${money(s.v)}`} className="rounded-full" style={{flex: `${Math.max(0.001, s.v)} 1 0`, background: s.c}}/>)}</div>
          <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">{split.map(s => <div key={s.k} className="min-w-0">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-[#f4f1ea99]"><span className="size-2 shrink-0 rounded-[3px]" style={{background: s.c}}/>{s.k}</div>
            <div className="num mt-1 text-[16px] font-bold">{s.k === "Profit" ? money(M.profit) : money(s.v)}</div>
          </div>)}</div>
        </div>
      </div>}
      {minis.length > 0 && <div className={CARD + " flex flex-col"} style={{flex: "5 1 320px"}}>
        {minis.map((m, i) => <NavLink key={m.label} href={m.href} className={"grid flex-1 items-center gap-4 px-4 py-[9px] text-[var(--text-heading)] " + HOVER}
          style={{gridTemplateColumns: "minmax(0,1fr) 96px", borderBottom: `1px solid ${i === minis.length - 1 ? "transparent" : LINE}`}}>
          <div className="min-w-0">
            <div className="text-[12px] font-medium" style={{color: MUTED}}>{m.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5"><span className="num text-[19px] font-bold leading-[1.05] tracking-[-0.04em]">{m.value}</span><span className="num whitespace-nowrap text-[12px]" style={{color: MUTED}}>{m.of}</span></div>
            <div className="mt-1 truncate text-[11.5px] font-semibold" style={{color: m.sc}}>{m.sub}</div>
          </div>
          <div className="flex h-8 items-end gap-[3px]">{m.bars.map((b, j) => <span key={j} title={b.t || undefined} className="flex-1 rounded-[4px]" style={{height: b.h + "%", background: b.c}}/>)}</div>
        </NavLink>)}
      </div>}
    </div>}

    {convOn && <div className="flex flex-wrap gap-3">
      <section className={CARD + " flex flex-col"} style={{flex: "7 1 460px"}}>
        <header className="flex flex-wrap items-start justify-between gap-3 px-[18px] pt-4">
          <div><h2 className={H2}>Conversions by channel</h2><p className="mt-1 mb-0 text-[12.5px]" style={{color: MUTED}}>Four weeks · this one in progress</p></div>
          <div className="flex gap-[18px]">{D.roleWeeks.map(r => <div key={r.role}>
            <div className="flex items-center gap-1.5 text-[11.5px]" style={{color: MUTED}}><span className="size-2 rounded-[3px]" style={{background: r.c}}/>{r.role}</div>
            <div className="num text-[17px] font-bold tracking-[-0.03em] text-[var(--text-heading)]">{r.vals[3]}</div>
          </div>)}</div>
        </header>
        <div className="grid min-h-[150px] flex-1 grid-cols-4 gap-5 px-[18px] pt-2.5 pb-3">
          {D.weeks.map((w, i) => <div key={w} className="flex min-w-0 flex-col justify-end">
            <div className="num mb-1.5 text-center text-[12.5px] font-bold text-[var(--text-heading)]">{wt[i]}</div>
            <div className="flex flex-col-reverse gap-0.5 overflow-hidden rounded-[8px]" style={{height: wt[i] / mxW * 100 + "%"}}>
              {D.roleWeeks.filter(r => wt[i] && r.vals[i] > 0).map(r => <div key={r.role} title={`${r.role}: ${r.vals[i]}`} style={{height: r.vals[i] / wt[i] * 100 + "%", background: r.c, opacity: i === 3 ? .7 : 1}}/>)}
            </div>
            <div className="pt-2 text-center font-mono text-[10.5px]" style={{color: i === 3 ? "var(--signal)" : MUTED}}>{i === 3 ? "This week" : shortDate(w)}</div>
          </div>)}
        </div>
      </section>

      <section className={CARD} style={{flex: "5 1 320px"}}>
        <header className="flex items-baseline justify-between px-[18px] pt-4 pb-1"><h2 className={H2}>Leaderboard</h2><span className="font-mono text-[11px]" style={{color: MUTED}}>3 WKS AGO → NOW</span></header>
        <div className="flex flex-col gap-[7px] px-[18px] pt-1.5 pb-3.5">
          {D.board.slice(0, 8).map((b, i) => <div key={b.id} className="grid items-center gap-2" style={{gridTemplateColumns: "14px 22px minmax(0,1fr) 78px 48px"}}>
            <span className="num text-[11.5px]" style={{color: MUTED}}>{i + 1}</span>
            <span className="grid size-[22px] place-items-center rounded-full text-[8.5px] font-bold text-white" style={{background: b.roleC}}>{initials(b.name)}</span>
            <div className="min-w-0"><div className="truncate text-[12.5px] font-semibold text-[var(--text-heading)]">{b.name}</div>
              <div className="relative mt-[5px] h-[5px] rounded-full" style={{background: LINE}}>
                <div className="h-full rounded-full" style={{width: b.pct * 100 + "%", background: TONE[b.tone]}}/>
                <span className="absolute -top-0.5 h-[9px] w-0.5 rounded-[2px] bg-[#0a0a0a59]" style={{left: D.day / 7 * 100 + "%"}}/>
              </div></div>
            <span className="grid grid-cols-3 gap-0.5">{b.vals.slice(0, 3).map((v, k) => {
              const met = b.min != null && v != null && v >= b.min, low = b.min != null && v != null && v < b.min * .8;
              return <span key={k} title={`${weekLabel(D.weeks[k])}: ${v ?? "not entered"}`} className="num grid h-[18px] place-items-center rounded-[4px] text-[10px] font-semibold"
                style={{background: v == null ? "var(--surface-page)" : met ? "var(--text-heading)" : low ? "#f4dad7" : "#f2e6d3", color: v == null ? MUTED : met ? "var(--surface-page)" : low ? "#c01d1d" : "#8f5a00"}}>{v ?? "·"}</span>;
            })}</span>
            <span className="num text-right text-[12.5px] font-bold text-[var(--text-heading)]">{b.now ?? "—"}<span className="font-normal" style={{color: MUTED}}>{b.min != null ? "/" + b.min : ""}</span></span>
          </div>)}
          {!D.board.length && <p className="py-4 text-[13px]" style={{color: MUTED}}>No active staff.</p>}
        </div>
      </section>
    </div>}

    <div className="flex flex-wrap gap-3">
      {fin && <section className={CARD + " overflow-hidden"} style={{flex: "7 1 460px"}}>
        <header className="flex items-baseline justify-between px-[18px] pt-4 pb-2.5"><h2 className={H2}>Models this month</h2>
          <NavLink href="/pnl" className="text-[12px] font-semibold hover:text-[var(--signal)]" style={{color: MUTED}}>Profit &amp; Loss →</NavLink></header>
        {D.models.map(m => {
          const pc = m.profit == null ? MUTED : m.profit >= 0 ? "var(--positive-fg)" : "var(--negative-fg)";
          return <div key={m.id} className="grid items-center gap-3 border-t px-4 py-[7px]" style={{gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 92px", borderColor: LINE}}>
            <div className="flex min-w-0 items-center gap-3"><ModelAvatar name={m.name} src={m.avatar} index={m.index} size={28} className="!text-[12px]"/>
              <div className="min-w-0"><div className="truncate text-[13px] font-bold text-[var(--text-heading)]">{m.handle}</div><div className="truncate text-[11.5px]" style={{color: MUTED}}>{m.name} · {m.deal || "No deal"}</div></div></div>
            <div className="min-w-0">
              <div className="h-1.5 overflow-hidden rounded-full" style={{background: LINE}}><div className="h-full rounded-full" style={{width: (m.margin == null ? 0 : Math.max(0, Math.min(100, m.margin * 100))) + "%", background: pc}}/></div>
              <div className="num mt-1.5 flex justify-between gap-2 whitespace-nowrap text-[11.5px]" style={{color: MUTED}}><span>{money(m.income)} in</span><span>{m.margin == null ? "—" : Math.round(m.margin * 100) + "% margin"}</span></div>
            </div>
            <div className="text-right"><div className="num text-[18px] font-bold tracking-[-0.03em]" style={{color: pc}}>{money(m.profit)}</div><div className="text-[11px]" style={{color: MUTED}}>profit</div></div>
          </div>;
        })}
        {!D.models.length && <p className="border-t px-[18px] py-4 text-[13px]" style={{color: MUTED, borderColor: LINE}}>No live models.</p>}
      </section>}

      <section className={CARD + " overflow-hidden"} style={{flex: "5 1 320px"}}>
        <header className="flex items-baseline justify-between px-[18px] pt-4 pb-2.5"><h2 className={H2}>Today</h2><span className="text-[12px]" style={{color: MUTED}}>{D.alerts.length ? D.alerts.length + " to action" : "Nothing waiting"}</span></header>
        {D.alerts.slice(0, limit).map((a, i) => <NavLink key={i} href={a.href} className={"grid min-h-8 items-center gap-3 border-t px-4 py-[5px] text-[var(--text-body)] hover:text-[var(--text-heading)] " + HOVER} style={{gridTemplateColumns: "8px minmax(0,1fr) auto", borderColor: LINE}}>
          <span className="size-2 rounded-full" style={{background: a.sev === "high" ? "#c01d1d" : a.sev === "mid" ? "#e3a33b" : "#c9c4bb"}}/>
          <span className="text-[12.5px] leading-[1.35]">{a.text}</span>
          <span className="whitespace-nowrap text-[12px] font-semibold text-[var(--text-heading)]">{a.cta} →</span>
        </NavLink>)}
        {D.alerts.length > limit && <button type="button" onClick={() => setAll(true)} className="block w-full border-t px-[18px] py-[9px] text-left text-[12px] font-semibold hover:text-[var(--text-heading)]" style={{color: MUTED, borderColor: LINE}}>Show {D.alerts.length - limit} more</button>}
        {!D.alerts.length && <div className="border-t px-6 py-4 text-[13px] text-[var(--positive-fg)]" style={{borderColor: LINE}}>Everything is up to date.</div>}
      </section>
    </div>
  </div>;
}
