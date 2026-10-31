"use client";
import {useEffect, useState} from "react";
import {CalendarDays, Check, ChevronLeft, ChevronRight, CircleCheck, Clock, Lock, Minus, Plus, Send, TriangleAlert, Wallet} from "lucide-react";
import {Avatar, PageSkeleton, Segmented, Stat, TableError} from "@/components/bh/ui";
import {Popover} from "@/components/bh/menu";
import {toast} from "@/components/bh/toast";
import {label, money, todayIso} from "@/lib/bh";
import {calcPay, daysOf, inPeriod, nextPeriod, periodOf, prevPeriod, statusOf, vaOf, type PayCalc, type Period, type VA} from "@/lib/pay";
import {C, dayLabel, dowOf, hf, usePayRun} from "./pay/store";
import {Slip} from "./pay/slip";

const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const m = (v: number) => money(v, 2), m0 = (v: number) => money(v, 0);
const fmtAt = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila"}); };
const card = "rounded-[20px] border border-[var(--border-faint)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]";
const outlineBtn = "h-10 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-5 text-[13px] font-semibold text-[var(--text-heading)] hover:border-[var(--text-heading)] disabled:opacity-45";
const inkBtn = "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--surface-inverse)] px-5 text-[13px] font-semibold text-[var(--text-inverse)] disabled:opacity-45 [&_svg]:size-4";
type Row = {v: VA; c: PayCalc; model: string; checked: boolean};
type Filter = "all" | "fix" | "unchecked" | "checked";

export default function PayHours() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const run = usePayRun();
  const [period, setPeriod] = useState<Period | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [pop, setPop] = useState<{vid: string; d: string; el: HTMLElement} | null>(null);
  const [slip, setSlip] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setPop(null); setSlip(null); setConfirm(false); } };
    addEventListener("keydown", esc); return () => removeEventListener("keydown", esc);
  }, []);

  if (run.error) return <TableError tables={run.tables}/>;
  if (!today || run.loading) return <PageSkeleton/>;
  const {data} = run;
  const current = periodOf(today), p = period ?? current, pk = p.key;
  const status = statusOf(data, p), locked = status !== "open", days = daysOf(p);
  // Earliest period with anything in it bounds the stepper.
  let first = current.key;
  for (const h of data.hours.values()) for (const d of h.keys()) if (d < first) first = d;
  for (const k of data.status.keys()) if (k < first) first = k;
  const go = (np: Period) => { setPop(null); setFilter("all"); setPeriod(np); };

  const byId = new Map(run.staff.rows.map(r => [r.id, r]));
  const rows: Row[] = run.vas.flatMap(v => {
    const s = byId.get(v.id);
    if (!s || !inPeriod(data, p, {id: v.id, status: label(s.fields.status), payType: label(s.fields.payType), end: s.fields.end ? String(s.fields.end).slice(0, 10) : null, start: s.fields.start ? String(s.fields.start).slice(0, 10) : null})) return [];
    const c = calcPay(data, p, v, today);
    return [{v, c, model: label(s.fields.model?.[0]) || "No model", checked: c.checked}];
  });
  const N = rows.length, checkedN = rows.filter(r => r.checked).length, fixN = rows.filter(r => r.c.open > 0).length;
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const total = sum(r => r.c.total), projected = sum(r => r.c.projected), payH = sum(r => r.c.payable + r.c.heldPaid), schedTD = sum(r => r.c.schedToDate);
  const of = {gap: 0, short: 0, missed: 0, held: 0, rate: 0};
  for (const {c} of rows) { c.flags.forEach(f => { if (!f.excused) of[f.kind]++; }); if (c.held > 0 && !c.dec) of.held++; if (c.noRate) of.rate++; }
  const fixCount = of.gap + of.short + of.missed + of.held + of.rate;
  const fixParts = [of.gap && of.gap + " not logged", of.short && of.short + " short", of.missed && of.missed + " missed", of.held && of.held + " held overage", of.rate && of.rate + " pay not set"].filter(Boolean);
  const todayIn = p.start <= today && p.end >= today;
  const todayMissing = todayIn ? rows.filter(r => r.c.unloggedToday) : [];
  const todaySched = todayIn ? rows.filter(r => !r.c.off.includes(dowOf(today))).length : 0;
  const sentN = rows.filter(r => vaOf(data, p, r.v.id).sent).length;
  const futureDays = days.filter(d => d > today).length;
  const approvedAt = run.periods.rows.find(r => String(r.fields.period) === pk)?.fields.approvedAt;
  const atTxt = approvedAt ? fmtAt(String(approvedAt)) : "";

  // Four-step bar
  const stepDone = [todayMissing.length === 0 && !rows.some(r => r.c.emptyPast.length), N > 0 && checkedN === N, status !== "open", status === "paid"];
  const cur = stepDone.findIndex(x => !x);
  const steps: [string, string][] = [
    ["Log hours", todayIn ? (todayMissing.length ? `Today ${todaySched - todayMissing.length} of ${todaySched} logged` : "Up to date") : p.start > today ? "Starts " + dayLabel(p.start) : "Period complete"],
    ["Check each VA", `${checkedN} of ${N} checked` + (fixN && status === "open" ? ` · ${fixN} need a fix` : "")],
    ["Approve & lock", status === "open" ? (checkedN === N ? fixCount ? `${fixCount} to fix first` : "Ready to approve" : `Unlocks at ${N}/${N}`) : "Approved " + atTxt],
    ["Pay out", status === "paid" ? "Paid " + p.payLabel : status === "approved" ? `${sentN} of ${N} sent` : "Pays " + p.payLabel],
  ];

  const keep = (r: Row) => locked || filter === "all" || (filter === "fix" && r.c.open > 0) || (filter === "unchecked" && !r.checked) || (filter === "checked" && r.checked);
  const groups = [...new Set(rows.map(r => r.model))].map(name => {
    const all = rows.filter(r => r.model === name);
    return {name, meta: `${all.length} VAs · ${hf(all.reduce((s, r) => s + r.c.payable + r.c.heldPaid, 0))}h`, total: m(all.reduce((s, r) => s + r.c.total, 0)), rows: all.filter(keep)};
  }).filter(g => g.rows.length);
  const gridCols = `240px repeat(${days.length}, 32px) 120px 88px 100px 92px`;

  const fillRow = (r: Row) => {
    const fillable = [...r.c.emptyPast, ...(r.c.unloggedToday ? [today] : [])];
    fillable.forEach(d => run.setHours(p, r.v, d, r.c.std, null));
    toast(`${r.c.std}h logged for ${r.v.name} on ${fillable.length} day${fillable.length > 1 ? "s" : ""}`);
  };
  const fillToday = () => {
    todayMissing.forEach(r => run.setHours(p, r.v, today, r.c.std, null));
    toast("Standard day logged for " + todayMissing.map(r => r.v.name.split(" ")[0]).join(", "));
  };
  const copyList = () => {
    const txt = `20MG BH payout · ${p.label} · paid ${p.payLabel}\n` + rows.map(r => r.v.name + "\t" + m(r.c.total) + (vaOf(data, p, r.v.id).sent ? "\tsent" : "")).join("\n") + "\nTotal\t" + m(total);
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Payout list copied"), () => toast.error("Copy failed · clipboard blocked here"));
  };
  const statusPill = {open: ["Open", C.warnBg, C.warnFg], approved: ["Approved", C.signalTint, C.signalFg], paid: ["Paid", C.okBg, C.okFg]}[status];
  const popRow = pop && !locked ? rows.find(r => r.v.id === pop.vid) : null;
  const slipRow = slip ? rows.find(r => r.v.id === slip) : null;
  const vas = rows.map(r => r.v);

  return <div className="flex flex-col gap-6">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.14em] text-[var(--text-faint)]"><span className="size-1.5 rounded-full bg-[var(--signal)]"/>Operations · Pay run</div>
        <h1 className="text-[40px] font-extrabold leading-[.95] tracking-[-0.045em] text-[var(--text-heading)] sm:text-[56px]">Pay &amp; Hours</h1>
        <p className="mt-3 text-pretty text-[15px] text-[var(--text-faint)]">{p.label} · paid {p.payLabel} morning. Hours are capped at each VA&apos;s standard day; anything over is held for you to decide.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-10 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-1">
          <button type="button" onClick={() => go(prevPeriod(p))} disabled={p.key <= first} aria-label="Previous period" className="grid h-full w-8 place-items-center text-[var(--text-faint)] hover:text-[var(--text-heading)] disabled:opacity-30"><ChevronLeft className="size-4"/></button>
          <span className="flex items-center gap-2 whitespace-nowrap px-1 text-[13px] font-semibold text-[var(--text-heading)]">{p.label}
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full px-[9px] text-[11px] font-semibold" style={{background: statusPill[1], color: statusPill[2]}}><span className="size-1.5 rounded-full bg-current"/>{statusPill[0]}</span></span>
          <button type="button" onClick={() => go(nextPeriod(p))} disabled={p.key > current.key} aria-label="Next period" className="grid h-full w-8 place-items-center text-[var(--text-faint)] hover:text-[var(--text-heading)] disabled:opacity-30"><ChevronRight className="size-4"/></button>
        </div>
        {!locked && todayMissing.length > 0 && <button type="button" onClick={fillToday} className={inkBtn}><Plus/>Fill today · {todayMissing.length} VA{todayMissing.length > 1 ? "s" : ""}</button>}
      </div>
    </div>

    <div className={card + " grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] overflow-hidden"}>
      {steps.map(([title, sub], i) => {
        const done = stepDone[i], now = i === cur;
        return <div key={title} className="flex items-start gap-3 border-r border-[var(--border-faint)] px-5 py-[18px]" style={{background: done ? C.page : C.card}}>
          <span className="grid size-[26px] shrink-0 place-items-center rounded-full border text-[12px] font-bold"
            style={{background: done ? C.ink : now ? C.signal : "transparent", color: done ? C.onInk : now ? "#fff" : C.muted, borderColor: done ? C.ink : now ? C.signal : C.line}}>{done ? "✓" : i + 1}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold" style={{color: done || now ? C.head : C.muted}}>{title}</div>
            <div className="num text-[12px] text-[var(--text-faint)]">{sub}</div>
          </div>
        </div>;
      })}
    </div>

    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <Stat accent label={locked ? "Total pay" : "Payable so far"} icon={Wallet} value={m0(total)} sub={locked ? `${N} VAs · paid ${p.payLabel}` : `Projected ${m0(projected)} by ${p.endLabel} · paid ${p.payLabel}`}/>
      <Stat label="Payable hours" icon={Clock} value={hf(payH)} sub={`of ${hf(schedTD)} scheduled to date`}/>
      <Stat label="Checked for pay" icon={CircleCheck} value={`${checkedN}/${N}`} sub={locked ? "Locked at approval" : checkedN === N ? "Ready to approve" : "Approve unlocks when all are checked"}/>
      <Stat label="Needs a fix" icon={TriangleAlert} value={locked ? "0" : String(fixCount)} tone={!locked && fixCount ? "negative" : ""} sub={locked ? "Nothing open" : fixParts.join(" · ") || "Nothing to fix"}/>
    </div>

    <section className={card + " overflow-clip"}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-[-0.02em] text-[var(--text-heading)]"><CalendarDays className="size-4 text-[var(--text-faint)]"/>Timesheet</h2>
          <p className="mt-1 text-pretty text-[13px] text-[var(--text-faint)]">{locked ? `Locked at approval (${atTxt}). Changes now go into the next period as corrections.` : "Click a day to edit hours. Click a name for the payslip. Tick each VA once their period looks right."}</p>
        </div>
        <Segmented size="sm" value={locked ? "all" : filter} onChange={setFilter}
          options={(locked ? [["all", "All"]] : [["all", "All"], ["fix", "Needs a fix · " + fixN], ["unchecked", "Not checked · " + (N - checkedN)], ["checked", "Checked · " + checkedN]]) as [Filter, string][]}/>
      </header>
      <div className="flex flex-wrap items-center gap-4 px-6 pb-3.5 text-[12px] text-[var(--text-faint)]">
        {LEGEND.map(([text, s]) => <span key={text} className="inline-flex items-center gap-1.5"><span className="size-4 rounded-[4px] border" style={s}/>{text}</span>)}
      </div>

      <div className="overflow-x-auto border-t border-[var(--border-faint)]">
        <div className="min-w-max">
          <div className="grid h-11 items-center border-b border-[var(--border-faint)] bg-[var(--surface-sunken)] text-[11.5px] font-medium text-[var(--text-faint)]" style={{gridTemplateColumns: gridCols}}>
            <div className="sticky left-0 z-[2] flex h-full items-center bg-[var(--surface-sunken)] px-5">VA</div>
            {days.map(d => <div key={d} className="flex flex-col items-center leading-[1.1]">
              <span className="font-mono text-[9.5px] tracking-[.06em]" style={{color: d === today ? C.signal : C.muted}}>{WD[dowOf(d)]}</span>
              <span className="num text-[12px] font-semibold" style={{color: d === today ? C.signal : d > today ? C.muted : C.head}}>{Number(d.slice(8))}</span>
            </div>)}
            <div className="px-3 text-right">Hours</div><div className="px-3 text-right">Adjust</div><div className="px-3 text-right">Pay</div><div className="px-4 text-center">Checked</div>
          </div>

          {groups.map(g => <div key={g.name}>
            <div className="sticky left-0 flex items-center justify-between gap-3 border-b border-[var(--border-faint)] bg-[var(--surface-page)] px-5 py-2.5">
              <span className="flex items-center gap-2.5"><span className="font-mono text-[11px] uppercase tracking-[.14em] text-[var(--text-heading)]">{g.name}</span><span className="text-[12px] text-[var(--text-faint)]">{g.meta}</span></span>
              <span className="num text-[12px] font-semibold text-[var(--text-heading)]">{g.total}</span>
            </div>
            {g.rows.map(r => <GridRow key={r.v.id} r={r} p={p} days={days} today={today} locked={locked} gridCols={gridCols} busy={run.busy}
              onCell={(d, el) => setPop({vid: r.v.id, d, el})} onOpen={() => setSlip(r.v.id)} onFill={() => fillRow(r)}
              onTick={() => run.tick(p, r.v, !r.checked)}/>)}
          </div>)}
          {!groups.length && <div className="px-6 py-12 text-center text-[13px] text-[var(--text-faint)]">Nothing matches this filter.</div>}
        </div>
      </div>

      <div className="sticky bottom-0 z-[3] flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-faint)] px-6 py-4" style={{background: status === "open" && checkedN === N ? C.page : C.card}}>
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><div className="h-full rounded-full bg-[var(--surface-inverse)]" style={{width: (N ? Math.round(checkedN / N * 100) : 0) + "%"}}/></div>
          <div className="min-w-0">
            <div className="num text-[13px] font-semibold text-[var(--text-heading)]">{status === "open" ? `${checkedN} of ${N} checked · ${m(total)}` : status === "approved" ? `Approved · ${sentN} of ${N} paid out` : `Paid ${p.payLabel} · ${m(total)}`}</div>
            <div className="text-pretty text-[12px] text-[var(--text-faint)]">{run.progress ?? (status === "open"
              ? (checkedN < N ? "Tick every VA to unlock approval." + (fixN ? ` ${fixN} still need a fix.` : "") : fixCount ? `Everyone is ticked, but ${fixParts.join(", ")} still need a fix before approving.` : futureDays ? `${futureDays} days still ahead. Approving now locks pay; hours logged later go into the next period as corrections.` : "Everything is checked. Approving freezes every amount.")
              : "Amounts are frozen. Corrections land in the next open period.")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === "approved" && sentN === 0 && <button type="button" disabled={run.busy} onClick={() => run.reopen(p).then(ok => ok && toast(p.label + " reopened · amounts unlocked"))} className={outlineBtn}>Reopen</button>}
          {status === "open" && <button type="button" disabled={checkedN < N || !N || fixCount > 0 || run.busy} onClick={e => e.detail < 2 && setConfirm(true)} className={inkBtn}><Lock/>Approve {p.short} · {m0(total)}</button>}
        </div>
      </div>
    </section>

    {locked && <section className={card + " overflow-hidden"}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-[-0.02em] text-[var(--text-heading)]"><Send className="size-4 text-[var(--text-faint)]"/>Payout</h2>
          <p className="mt-1 text-[13px] text-[var(--text-faint)]">{status === "paid" ? `Everyone was paid for ${p.label}.` : "Tick each person once the money has gone out."}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copyList} className="h-8 rounded-full px-3 text-[12.5px] font-semibold text-[var(--text-heading)] hover:bg-[var(--wash)]">Copy list</button>
          {status === "approved" && <button type="button" disabled={run.busy} onClick={e => e.detail < 2 && run.setSent(p, vas, rows.filter(r => !vaOf(data, p, r.v.id).sent).map(r => r.v.id), true).then(ok => ok && toast("Everyone paid for " + p.label))}
            className="h-8 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 text-[12.5px] font-semibold text-[var(--text-heading)] hover:border-[var(--text-heading)] disabled:opacity-45">Mark all sent</button>}
        </div>
      </header>
      <div className="border-t border-[var(--border-faint)]">
        {rows.map(r => { const s = vaOf(data, p, r.v.id).sent; return <div key={r.v.id} className="grid grid-cols-[minmax(0,1fr)_auto_120px] items-center gap-4 border-b border-[var(--border-faint)] px-6 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5"><Avatar name={r.v.name} className="size-7 text-[10px]"/><span className="truncate text-[13px] font-semibold text-[var(--text-heading)]">{r.v.name}</span></div>
          <span className="num text-[14px] font-bold text-[var(--text-heading)]">{m(r.c.total)}</span>
          <div className="flex justify-end">
            <button type="button" disabled={run.busy} onClick={e => e.detail < 2 && run.setSent(p, vas, [r.v.id], !s).then(ok => ok && toast(s ? r.v.name + " marked not sent" : m(r.c.total) + " sent to " + r.v.name))}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold disabled:opacity-60"
              style={{background: s ? C.okBg : C.card, color: s ? C.okFg : C.head, borderColor: s ? "transparent" : C.line}}><Check className="size-[13px]" style={{opacity: s ? 1 : 0}}/>{s ? "Sent" : "Mark sent"}</button>
          </div>
        </div>; })}
      </div>
      <div className="num flex justify-between gap-3 px-6 py-3.5 text-[12.5px] text-[var(--text-faint)]">
        <span>{sentN} of {N} sent</span><span className="font-semibold text-[var(--text-heading)]">{m(sum(r => vaOf(data, p, r.v.id).sent ? r.c.total : 0))} of {m(total)}</span>
      </div>
    </section>}

    {popRow && pop && <Popover anchor={pop.el} open onClose={() => setPop(null)} width={256} maxHeight={420} className="p-3.5 shadow-[var(--float)]">
      <CellPop key={pop.vid + pop.d} r={popRow} d={pop.d} today={today} excused={vaOf(data, p, popRow.v.id).excused} h={data.hours.get(popRow.v.id)?.get(pop.d) ?? null}
        onSet={(h, debounce) => run.setHours(p, popRow.v, pop.d, h, `${popRow.v.name} · ${dayLabel(pop.d)} · ${h == null ? "cleared" : hf(h) + "h saved"}`, debounce)}
        onExcuse={(list, on) => run.edit(p, popRow.v, {excused: list}, `${dayLabel(pop.d)} ${on ? "excused" : "unexcused"} for ${popRow.v.name}`)}/>
    </Popover>}

    {confirm && <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className="absolute inset-0 bg-[var(--veil)]" onClick={() => setConfirm(false)}/>
      <div role="dialog" aria-modal="true" aria-label={`Approve ${p.label}`} className="relative w-full max-w-[440px] rounded-[20px] bg-[var(--surface-card)] p-7 shadow-[var(--shadow-overlay)]">
        <h2 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text-heading)]">Approve {p.label}?</h2>
        <p className="mt-2 text-pretty text-[13px] text-[var(--text-faint)]">{futureDays ? `This locks every amount. ${futureDays} days are still ahead; hours logged later go into the next period as corrections.` : "This locks every amount. Later changes go into the next period as corrections."}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[["VAs", String(N)], ["Payable hours", hf(payH)], ["Pays", p.payLabel]].map(([k, v]) => <div key={k} className="rounded-[14px] bg-[var(--surface-sunken)] px-3 py-2.5">
            <div className="text-[11.5px] text-[var(--text-faint)]">{k}</div><div className="num text-[15px] font-bold text-[var(--text-heading)]">{v}</div></div>)}
        </div>
        <div className="mt-[22px] flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(false)} className="h-10 rounded-full px-5 text-[13px] font-semibold text-[var(--text-heading)] hover:bg-[var(--wash)]">Cancel</button>
          <button type="button" disabled={run.busy} className={inkBtn} onClick={async () => {
            if (await run.approve(p, vas)) { setConfirm(false); setFilter("all"); toast(`${p.label} approved · ${m(total)} locked`); }
          }}>{run.progress ?? "Approve · " + m(total)}</button>
        </div>
      </div>
    </div>}

    {slipRow && <Slip run={run} p={p} v={slipRow.v} c={slipRow.c} model={slipRow.model} status={status} isCk={slipRow.checked} onClose={() => setSlip(null)}
      onGo={np => { setSlip(null); go(np); }} target={locked ? nextOpen(data, p) : p} prev={prevOf(data, p, slipRow.v, today)}/>}
  </div>;
}

// Next period after p that is still open (where corrections for a locked period land).
function nextOpen(data: ReturnType<typeof usePayRun>["data"], p: Period) {
  for (let n = nextPeriod(p), i = 0; i < 48; n = nextPeriod(n), i++) if (statusOf(data, n) === "open") return n;
  return null;
}
function prevOf(data: ReturnType<typeof usePayRun>["data"], p: Period, v: VA, today: string) {
  const pp = prevPeriod(p), H = data.hours.get(v.id);
  return H && [...H.keys()].some(d => d >= pp.start && d <= pp.end) ? {label: pp.label, total: calcPay(data, pp, v, today).total} : null;
}

const LEGEND: [string, React.CSSProperties][] = [
  ["Standard day", {background: C.ink, borderColor: C.ink}],
  ["Over · held", {background: C.ink, borderColor: C.ink, boxShadow: `0 0 0 1.5px ${C.card}, 0 0 0 3px ${C.signal}`}],
  ["Short", {background: C.warnBg, borderColor: C.warnLine}],
  ["Missed", {background: C.badBg, borderColor: C.badLine}],
  ["Excused", {background: C.sand, borderColor: C.hair}],
  ["Not logged", {background: "transparent", borderColor: C.warnLine, borderStyle: "dashed"}],
];

function GridRow({r, p, days, today, locked, gridCols, busy, onCell, onOpen, onFill, onTick}: {
  r: Row; p: Period; days: string[]; today: string; locked: boolean; gridCols: string; busy: boolean;
  onCell: (d: string, el: HTMLElement) => void; onOpen: () => void; onFill: () => void; onTick: () => void;
}) {
  const {v, c} = r, blocked = !locked && c.open > 0 && !r.checked;
  const fillable = [...c.emptyPast, ...(c.unloggedToday ? [today] : [])];
  const H = new Map(c.days.map(x => [x.d, x.logged]));
  return <div className="grid min-h-14 items-center border-b border-[var(--border-faint)] bg-[var(--surface-card)]" style={{gridTemplateColumns: gridCols}}>
    <div className="sticky left-0 z-[1] flex h-full items-center gap-2.5 bg-[var(--surface-card)] pl-5 pr-3">
      <Avatar name={v.name}/>
      <button type="button" onClick={onOpen} title="Open payslip" className="group min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-semibold text-[var(--text-heading)] group-hover:underline">{v.name}</div>
        <div className="num whitespace-nowrap text-[11.5px] text-[var(--text-faint)]">{(c.rate ? m(c.rate) + "/h" : "Pay not set") + ` · ${c.std}h × ${7 - c.off.length}d`}</div>
      </button>
      {!locked && fillable.length > 0 && <button type="button" onClick={onFill} title={`Log ${c.std}h on ${fillable.map(dayLabel).join(", ")}`}
        className="h-[26px] whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-[9px] text-[11px] font-semibold text-[var(--text-heading)] hover:border-[var(--text-heading)]">Fill</button>}
    </div>
    {days.map(d => <Cell key={d} d={d} h={H.get(d) ?? null} std={c.off.includes(dowOf(d)) ? 0 : c.std} sched={!c.off.includes(dowOf(d))}
      ex={c.flags.some(f => f.d === d && f.excused)} today={today} locked={locked} onClick={el => onCell(d, el)}/>)}
    <div className="num px-3 text-right">
      <div className="text-[13px] font-semibold text-[var(--text-heading)]">{hf(c.payable + c.heldPaid)} / {hf(c.sched)}</div>
      <div className="text-[11px]" style={{color: c.held > 0 && !c.dec ? C.signalFg : C.muted}}>{c.held > 0 ? (c.dec === "pay" ? `+${hf(c.held)}h extra paid` : c.dec === "no" ? `${hf(c.held)}h over · not paid` : `${hf(c.held)}h held`) : "payable / sched."}</div>
    </div>
    <div className="num px-3 text-right text-[12.5px]" style={{color: c.adjs.length ? C.head : "color-mix(in srgb, var(--text-faint) 50%, transparent)"}}>{c.adjs.length ? (c.adjSum >= 0 ? "+" : "") + m(c.adjSum) : "—"}</div>
    <div className="num px-3 text-right text-[13px] font-bold text-[var(--text-heading)]">{m(c.total)}</div>
    <div className="flex justify-center px-4">
      {blocked
        ? <button type="button" onClick={onOpen} className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold" style={{background: C.badBg, color: C.badFg}}><span className="size-1.5 rounded-full bg-current"/>{c.open} to fix</button>
        : <button type="button" role="checkbox" aria-checked={r.checked} aria-label={`Checked for pay: ${v.name}`} onClick={onTick} disabled={locked}
          className="grid size-6 place-items-center rounded-[7px] border-[1.5px] disabled:cursor-default" style={{background: r.checked ? C.ink : C.card, borderColor: r.checked ? C.ink : C.line, color: C.onInk}}>
          <Check className="size-3.5" strokeWidth={2.5} style={{opacity: r.checked ? 1 : 0}}/></button>}
    </div>
  </div>;
}

// One day cell; h = logged hours or null when not logged.
function Cell({d, h, std, sched, ex, today, locked, onClick}: {d: string; h: number | null; std: number; sched: boolean; ex: boolean; today: string; locked: boolean; onClick: (el: HTMLElement) => void}) {
  let bg = "transparent", fg = C.muted, border = C.hair, bs = "solid", ring = "none", text = "", title = dayLabel(d);
  if (d > today) { text = sched ? "" : "·"; border = sched ? C.hair : "transparent"; title += sched ? ` · ${std}h scheduled` : " · day off"; }
  else if (h == null) { if (!sched) { text = "·"; border = "transparent"; title += " · day off"; } else if (d === today) { border = C.head; bs = "dashed"; title += " · today, not logged"; } else if (ex) { bg = C.sand; text = "–"; title += " · not logged, excused"; } else { border = C.warnLine; bs = "dashed"; title += " · not logged, needs a fix"; } }
  else if (!sched && h === 0) { text = "·"; border = "transparent"; title += " · day off"; }
  else if (h > std) { bg = C.ink; fg = C.onInk; border = C.ink; ring = `0 0 0 2px ${C.card}, 0 0 0 3.5px ${C.signal}`; text = String(h); title += ` · ${h}h logged, ${h - std}h over ${sched ? "standard" : "(day off)"} held`; }
  else if (h === std) { bg = C.ink; fg = C.onInk; border = C.ink; text = String(h); title += ` · ${h}h`; }
  else if (ex) { bg = C.sand; text = String(h); title += ` · ${h} of ${std}h, excused`; }
  else if (h === 0 && d < today) { bg = C.badBg; fg = C.badFg; border = C.badLine; text = "0"; title += " · missed"; }
  else if (d < today) { bg = C.warnBg; fg = C.warnFg; border = C.warnLine; text = String(h); title += ` · short, ${h} of ${std}h`; }
  else { bg = C.sand; fg = C.head; border = C.line; text = String(h); title += ` · ${h} of ${std}h so far`; }
  const off = locked || d > today;
  return <div className="grid place-items-center">
    <button type="button" title={title} aria-label={title} onClick={e => !off && onClick(e.currentTarget)}
      className="num grid size-[26px] place-items-center rounded-[6px] p-0 text-[11px] font-bold" style={{background: bg, color: fg, border: `1px ${bs} ${border}`, boxShadow: ring, cursor: off ? "default" : "pointer"}}>{text}</button>
  </div>;
}

function CellPop({r, d, h, today, excused, onSet, onExcuse}: {r: Row; d: string; h: number | null; today: string; excused: string[]; onSet: (h: number | null, debounce?: boolean) => void; onExcuse: (list: string[], on: boolean) => void}) {
  const {v, c} = r, sched = !c.off.includes(dowOf(d)), std = sched ? c.std : 0, ex = excused.includes(d);
  const [draft, setDraft] = useState(h == null ? "" : String(h));
  const set = (n: number | null) => { const x = n == null ? null : Math.max(0, Math.min(24, n)); setDraft(x == null ? "" : String(x)); onSet(x); };
  const val = h ?? 0, isShort = d < today && sched && (h == null || h < std);
  let note = "", noteBg = C.sand, noteFg = C.muted;
  if (h != null && h > std) { note = `${h - std}h over ${sched ? "the standard day" : "(day off)"} are held. Decide in the payslip.`; noteBg = C.signalTint; noteFg = C.signalFg; }
  else if (isShort && !ex) { note = h == null ? "Nothing logged. Log the hours or excuse the day." : h === 0 ? "Missed a scheduled day. Fix the hours or excuse it." : `Short by ${std - h!}h. Fix the hours or excuse it.`; noteBg = h === 0 ? C.badBg : C.warnBg; noteFg = h === 0 ? C.badFg : C.warnFg; }
  else if (isShort && ex) note = h == null ? "Excused. Nothing to pay." : "Excused. Paid as logged.";
  const round = "grid size-9 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--text-heading)]";
  return <div>
    <div className="text-[13px] font-semibold text-[var(--text-heading)]">{v.name} · {dayLabel(d)}</div>
    <div className="text-[12px] text-[var(--text-faint)]">{sched ? `Standard ${c.std}h · ${c.rate ? m(c.rate) + "/h" : "pay not set"}` : "Day off · any hours are held"}</div>
    <div className="mt-3 flex items-center justify-between gap-2">
      <button type="button" onClick={() => set(val - 0.5)} aria-label="Less" className={round}><Minus className="size-3.5"/></button>
      <input type="number" min={0} max={24} step={0.5} value={draft} placeholder="—" aria-label="Hours" autoFocus
        onChange={e => { const t = e.target.value; setDraft(t); if (t === "") onSet(null, true); else if (Number.isFinite(Number(t))) onSet(Math.max(0, Math.min(24, Number(t))), true); }}
        className="num h-11 w-24 rounded-[10px] border border-[var(--border-faint)] bg-[var(--surface-card)] text-center text-[26px] font-bold tracking-[-0.04em] text-[var(--text-heading)] outline-none focus:border-[var(--text-heading)]"/>
      <button type="button" onClick={() => set(val + 0.5)} aria-label="More" className={round}><Plus className="size-3.5"/></button>
    </div>
    <div className="mt-2.5 flex gap-1.5">
      {([["0", 0], [sched ? c.std + "h" : "4h", sched ? c.std : 4], ["Clear", null]] as const).map(([t, n]) =>
        <button key={t} type="button" onClick={() => set(n)} className="h-7 flex-1 rounded-full border border-[var(--border-faint)] bg-[var(--surface-page)] text-[11.5px] font-semibold text-[var(--text-heading)] hover:border-[var(--text-heading)]">{t}</button>)}
    </div>
    {note && <div className="mt-2.5 rounded-[10px] px-2.5 py-2 text-[12px]" style={{background: noteBg, color: noteFg}}>{note}</div>}
    {isShort && <button type="button" onClick={() => onExcuse(ex ? excused.filter(x => x !== d) : [...excused, d], !ex)}
      className="mt-2 h-8 w-full rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] text-[12.5px] font-semibold text-[var(--text-heading)] hover:border-[var(--text-heading)]">{ex ? "Remove excuse" : "Excuse"}</button>}
  </div>;
}
