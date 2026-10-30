"use client";
import {useEffect, useMemo, useState} from "react";
import {ArrowRight, Clock, DollarSign, Plus, Target, Trash2, UserCheck} from "lucide-react";
import {toast} from "@/components/bh/toast";
import {Select} from "@/components/bh/menu";
import {Btn, Drawer, Field, LinkBtn, PageHeader, PageSkeleton, Segmented, TableError, inputClass} from "@/components/bh/ui";
import {addDays, label, linkIds, money, mondayOf, num, todayIso, weekLabel} from "@/lib/bh";
import {CHOICES, linkOptions, useTable} from "@/lib/tables";
import {ROLE_STYLE, ROLES, converts, hasTarget, dayOfWeek, initials, roleOf, targetOf, type Role} from "@/lib/team";
import {DEFAULT_OFF, daysPerWeek, offForDays, parseOff} from "@/lib/pay";
import {cn} from "@/lib/utils";

type Period = "this" | "last" | "4w";
type Row = {id: string; fields: Record<string, any>};

// Channel colours on the ink card (X's ink would vanish on ink, so it uses the signal orange there).
const RC: Record<Role, string> = {X: "#ff3000", Discord: "#7b5cf5", IG: "#ff5c93", "IG MR": "#f08a3e", VPS: "#2a9d96"};
const ST: Record<string, string> = {Active: "bg-[#dce7dc] text-[#1d7341]", Setup: "bg-[#f2e6d3] text-[#8f5a00]", Inactive: "bg-[#f4dad7] text-[#c01d1d]"};
const card = "flex min-w-0 flex-col rounded-[20px] border border-[var(--ink-100)] bg-[var(--surface-card)] p-6 text-[var(--ink)] shadow-[var(--shadow-card)]";
const section = "overflow-hidden rounded-[20px] border border-[var(--ink-100)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]";
const head = "items-center bg-[var(--ink-100)] text-[11.5px] font-medium text-[var(--text-faint)]";
const cellIn = "h-8 w-full rounded-[6px] border border-transparent bg-transparent text-[13px] outline-none hover:border-[var(--ink-100)] focus:border-[var(--signal)] focus:bg-[var(--surface-card)]";
const hf = (n: number) => n.toLocaleString("en-US", {maximumFractionDigits: 1});
const off = (r: Row) => parseOff(r.fields.daysOff) ?? DEFAULT_OFF;

// Inline-edit input: looks like text, saves on blur or Enter, Esc reverts. onCommit returning false resets it.
function Cell({value, onCommit, className, ...rest}: {value: unknown; onCommit: (v: string) => boolean | void} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value">) {
  const v = value == null ? "" : String(value);
  return <input key={v} defaultValue={v} {...rest} className={cn(cellIn, className)}
    onBlur={e => { const t = e.target.value.trim(); if (t !== v && onCommit(t) === false) e.target.value = v; }}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = v; e.currentTarget.blur(); } }}/>;
}

function Face({name, className}: {name: string; className?: string}) {
  return <span className={cn("grid shrink-0 place-items-center rounded-full bg-[var(--ink-100)] font-bold text-[var(--ink)]", className)}>{initials(name)}</span>;
}

export default function Staff() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const staff = useTable("staff"), models = useTable("models"), conv = useTable("conversions"), pay = useTable("paylog");
  const tables = [staff, models, conv, pay];
  const [period, setPeriod] = useState<Period>("last");
  const [q, setQ] = useState(""), [fStatus, setFStatus] = useState("");
  const [adding, setAdding] = useState(false), [confirmDel, setConfirmDel] = useState<string | null>(null);
  // Optimistic overrides per staff record until the write lands (or rolls back).
  const [ov, setOv] = useState<Record<string, Record<string, any>>>({});
  // Rows deleted on this screen disappear at once; a failed delete brings them back.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const rows = useMemo<Row[]>(() => staff.rows.filter(r => !gone.has(r.id)).map(r => ov[r.id] ? {...r, fields: {...r.fields, ...ov[r.id]}} : r), [staff.rows, ov, gone]);

  async function save(r: Row, fields: Record<string, any>, msg: string, shown: Record<string, any> = fields) {
    setOv(o => ({...o, [r.id]: {...o[r.id], ...shown}}));
    try { await staff.update(r.id, fields); toast(msg); } catch (e: any) { toast.error(e.message); }
    finally { setOv(o => { const f = {...o[r.id]}; for (const k in shown) delete f[k]; return {...o, [r.id]: f}; }); }
  }

  // Only rows with no pay or conversion history can go; the server refuses the rest.
  async function remove(r: Row) {
    setConfirmDel(null);
    setGone(g => new Set(g).add(r.id));
    try { await staff.remove(r.id); toast(`${label(r.fields.name) || "Blank row"} deleted`); }
    catch (e: any) { setGone(g => { const n = new Set(g); n.delete(r.id); return n; }); toast.error(e.message); }
  }

  const sumWeek = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of conv.rows) for (const sid of linkIds(c.fields.staff)) { const k = sid + "|" + String(c.fields.week ?? "").slice(0, 10); m.set(k, (m.get(k) ?? 0) + num(c.fields.conversions)); }
    return (sid: string, w: string) => m.get(sid + "|" + w) ?? null;
  }, [conv.rows]);

  if (tables.some(t => t.error)) return <TableError tables={tables}/>;
  if (!today || tables.some(t => t.loading)) return <PageSkeleton/>;

  const thisWeek = mondayOf(today), day = dayOfWeek(today), status = (r: Row) => label(r.fields.status);
  const act = rows.filter(r => status(r) === "Active"), live = rows.filter(r => status(r) !== "Inactive");
  const name = (r: Row) => label(r.fields.name);

  // KPI 1: active staff by role.
  const roles = ROLES.map(role => ({role, n: act.filter(s => roleOf(s.fields.platform) === role).length})).filter(x => x.n);
  // KPI 2: pace this week.
  const pv = act.filter(s => converts(s.fields.platform)).map(s => { const m = targetOf(s), now = sumWeek(s.id, thisWeek); return {s, k: m == null ? "none" : now == null ? "missing" : now >= m ? "met" : now >= m * day / 7 ? "pace" : "behind"}; });
  const good = pv.filter(x => x.k === "met" || x.k === "pace").length, judged = pv.filter(x => x.k !== "none").length;
  const segs = ([["met", "Hit", "#1f7a45", ""], ["pace", "On pace", "var(--ink)", ""], ["behind", "Behind", "#e3a33b", ""], ["missing", "Not entered", "var(--surface-card)", "inset 0 0 0 1.5px var(--ink-200)"]] as const)
    .map(([k, l, bg, ring]) => { const who = pv.filter(x => x.k === k); return {k, l, bg, ring, n: who.length, title: l + ": " + (who.map(x => name(x.s).split(" ")[0]).join(", ") || "nobody")}; }).filter(g => g.n);
  // KPI 3: hours this week from the Pay Log.
  const week = Array.from({length: 7}, (_, i) => addDays(thisWeek, i));
  const hrs = week.map(d => pay.rows.filter(r => String(r.fields.workDate ?? "").slice(0, 10) === d).reduce((t, r) => t + num(r.fields.hours), 0));
  const std = (s: Row) => num(s.fields.hours);
  const sched = act.reduce((t, s) => t + std(s) * daysPerWeek(off(s)), 0);
  const maxH = Math.max(1, ...hrs, ...week.map(d => act.filter(s => !off(s).includes(new Date(d + "T00:00:00Z").getUTCDay())).reduce((t, s) => t + std(s), 0)));
  const hTot = hrs.reduce((a, b) => a + b, 0);
  // KPI 4: hourly rates.
  const rated = act.filter(s => num(s.fields.rate) > 0), rs = rated.map(s => num(s.fields.rate));
  const lo = Math.min(...rs), hi = Math.max(...rs), avg = rs.reduce((a, b) => a + b, 0) / (rs.length || 1);
  const pos = (v: number) => (0.12 + 0.76 * (rs.length > 1 && hi > lo ? (v - lo) / (hi - lo) : 0.5)) * 100 + "%";
  const wkCost = rated.reduce((t, s) => t + num(s.fields.rate) * std(s) * daysPerWeek(off(s)), 0);

  // Performance: conversions vs weekly minimum over the chosen weeks.
  const weeks = period === "this" ? [thisWeek] : period === "last" ? [addDays(thisWeek, -7)] : [-28, -21, -14, -7].map(n => addDays(thisWeek, n));
  const perf = live.filter(s => converts(s.fields.platform)).map(s => {
    const vals = weeks.map(w => sumWeek(s.id, w)).filter((v): v is number => v != null), min = targetOf(s);
    const actual = vals.length ? vals.reduce((a, b) => a + b, 0) : null, goal = min == null ? null : min * weeks.length;
    return {s, actual, goal, pct: goal ? (actual ?? 0) / goal : null};
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || (b.actual ?? -1) - (a.actual ?? -1));
  const range = weeks.length === 1 ? weekLabel(weeks[0]) : `${weekLabel(weeks[0]).split(" – ")[0]} – ${weekLabel(weeks[3]).split(" – ")[1]}`;

  const ql = q.trim().toLowerCase();
  const team = rows.filter(s => (!fStatus || status(s) === fStatus) && (!ql || `${name(s)} ${label(s.fields.email)} ${label(s.fields.staffId)}`.toLowerCase().includes(ql))).sort((a, b) => name(a).localeCompare(name(b)));
  const modelOpts = [{value: "", label: "—"}, ...linkOptions(models.rows, "model")];
  const mins = live.filter(s => hasTarget(s.fields.platform)).sort((a, b) => ROLES.indexOf(roleOf(a.fields.platform)) - ROLES.indexOf(roleOf(b.fields.platform)) || name(a).localeCompare(name(b)));
  const teamCols = "grid-cols-[60px_minmax(160px,1.4fr)_110px_110px_110px_90px_90px_100px_minmax(150px,1fr)_76px]";
  const minCols = "grid-cols-[minmax(180px,1fr)_150px_minmax(220px,1.6fr)_120px]";
  const perfCols = "grid-cols-[minmax(0,1.4fr)_110px_90px_minmax(0,1fr)_130px]";

  return <div className="flex flex-col gap-6">
    <PageHeader eyebrow="Operations · Live records" title="Staff" subtitle="Team directory, weekly targets and performance from the existing BH staff base."
      actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus/>Add staff</Btn>}/>

    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
      <div className="flex min-w-0 flex-col rounded-[20px] border border-surface-inverse bg-surface-inverse p-6 text-text-inverse shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between text-[13px] font-medium text-text-inverse/60">Active staff<UserCheck className="size-4 text-signal" strokeWidth={1.75}/></div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <span className="num text-[40px] font-bold leading-none tracking-[-0.05em]">{act.length}</span>
          <span className="flex pl-2">{act.slice(0, 5).map(s => <span key={s.id} title={name(s)} className="-ml-2 grid size-7 place-items-center rounded-full border-2 border-surface-inverse text-[9.5px] font-bold text-white" style={{background: RC[roleOf(s.fields.platform)]}}>{initials(name(s))}</span>)}</span>
        </div>
        <div className="mt-[18px] flex h-1.5 gap-[3px] overflow-hidden rounded-full">{roles.map(x => <span key={x.role} title={`${x.role}: ${x.n} VAs`} className="rounded-full" style={{flex: `${x.n} 1 0`, background: RC[x.role]}}/>)}</div>
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-inverse/60">{roles.map(x => <span key={x.role} className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{background: RC[x.role]}}/>{x.role} {x.n}</span>)}</div>
        <div className="mt-auto pt-3 text-[12px] text-text-inverse/50">{rows.filter(s => status(s) === "Setup").length} in setup · {rows.filter(s => status(s) === "Inactive").length} inactive</div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between text-[13px] font-medium text-[var(--text-faint)]">On pace this week<Target className="size-4 opacity-70" strokeWidth={1.75}/></div>
        <div className="mt-5 flex items-baseline gap-2"><span className="num text-[40px] font-bold leading-none tracking-[-0.05em]">{good}</span><span className="text-[13px] text-[var(--text-faint)]">of {judged} · day {day}/7</span></div>
        <div className="mt-5 flex h-2.5 gap-[3px]">{segs.map(g => <span key={g.k} title={g.title} className="min-w-1.5 rounded-full" style={{flex: `${g.n} 1 0`, background: g.bg, boxShadow: g.ring || undefined}}/>)}</div>
        <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 pt-3.5">{segs.map(g => <span key={g.k} title={g.title} className="flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
          <span className="size-2 shrink-0 rounded-full" style={{background: g.bg, boxShadow: g.ring || undefined}}/>{g.l}<span className="num ml-auto font-bold text-[var(--ink)]">{g.n}</span></span>)}</div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between text-[13px] font-medium text-[var(--text-faint)]">Hours this week<Clock className="size-4 opacity-70" strokeWidth={1.75}/></div>
        <div className="mt-5 flex items-baseline gap-2"><span className="num text-[40px] font-bold leading-none tracking-[-0.05em]">{hf(hTot)}</span><span className="text-[13px] text-[var(--text-faint)]">of {hf(sched)} scheduled</span></div>
        <div className="mt-4 grid h-14 grid-cols-7 items-end gap-1.5">{week.map((d, i) => { const fut = d > today, now = d === today; return <div key={d} title={`${weekLabel(d).split(" – ")[0]} · ${hf(hrs[i])}h${fut ? " (upcoming)" : ""}`}
          className="flex h-full flex-col justify-end overflow-hidden rounded-[6px]" style={{background: fut ? "repeating-linear-gradient(135deg, var(--ink-100) 0 4px, var(--paper) 4px 8px)" : "var(--ink-100)"}}>
          <div className="rounded-[6px]" style={{height: hrs[i] / maxH * 100 + "%", background: now ? "var(--signal)" : "var(--ink)"}}/></div>; })}</div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">{week.map((d, i) => <span key={d} className={cn("text-center font-mono text-[10px]", d === today ? "text-signal" : "text-[var(--text-faint)]")}>{"MTWTFSS"[i]}</span>)}</div>
        <div className="mt-auto pt-2.5 text-[12px] text-[var(--text-faint)]">{Math.round(hTot / Math.max(1, sched) * 100)}% of the week logged · today in orange</div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between text-[13px] font-medium text-[var(--text-faint)]">Average hourly rate<DollarSign className="size-4 opacity-70" strokeWidth={1.75}/></div>
        <div className="num mt-5 text-[40px] font-bold leading-none tracking-[-0.05em]">{rs.length ? money(avg, 2) : "—"}</div>
        <div className="relative mt-[22px] h-1.5 rounded-full bg-[var(--ink-100)]">
          {rs.length > 0 && <>
            <div className="absolute inset-y-0 rounded-full bg-[var(--ink)]" style={{left: pos(lo), right: `calc(100% - ${pos(hi)})`}}/>
            {[...new Set(rs)].map(v => <span key={v} title={`${money(v, 2)}/h · ${rs.filter(x => x === v).length} VAs`} className="absolute top-1/2 -ml-[5px] -mt-[5px] size-2.5 rounded-full border-2 border-[var(--ink)] bg-[var(--surface-card)]" style={{left: pos(v)}}/>)}
            <span className="absolute top-1/2 -ml-1.5 -mt-1.5 size-3 rounded-full bg-signal shadow-[0_0_0_2px_var(--surface-card)]" style={{left: pos(avg)}}/>
          </>}
        </div>
        <div className="num mt-2 flex justify-between text-[11.5px] text-[var(--text-faint)]"><span>{rs.length ? "Low " + money(lo, 2) : ""}</span><span>{rs.length ? "High " + money(hi, 2) : ""}</span></div>
        <div className="mt-auto pt-2.5 text-[12px] text-[var(--text-faint)]">≈ {money(wkCost)} a week at standard hours</div>
      </div>
    </div>

    <section className={section}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div><h2 className="text-[18px] font-bold tracking-[-0.02em]">Performance</h2><p className="mt-1 text-[13px] text-[var(--text-faint)]">Conversions against weekly minimum · {range}</p></div>
        <Segmented size="sm" value={period} onChange={setPeriod} options={[["this", "This week"], ["last", "Last week"], ["4w", "Last 4 weeks"]] as const}/>
      </header>
      <div className="overflow-x-auto border-t border-[var(--ink-100)]"><div className="min-w-[640px]">
        <div className={cn("grid h-9 gap-3 px-5", perfCols, head)}><span>VA</span><span className="text-right">Conversions</span><span className="text-right">Target</span><span>Achievement</span><span className="text-right">Status</span></div>
        {perf.map(({s, actual, goal, pct}) => {
          const [txt, cls] = actual === null ? ["Not reported", "text-[var(--text-faint)] ring-1 ring-inset ring-[var(--ink-200)]"] : pct === null ? ["No target", "text-[var(--text-faint)] ring-1 ring-inset ring-[var(--ink-200)]"]
            : pct >= 1 ? ["● On target", "bg-[#dce7dc] text-[#1d7341]"] : [`● ${goal! - actual} short`, pct >= 0.8 ? "bg-[#f2e6d3] text-[#8f5a00]" : "bg-[#f4dad7] text-[#c01d1d]"];
          return <div key={s.id} className={cn("grid items-center gap-3 border-b border-[var(--ink-100)] px-5 py-2.5 text-[13px]", perfCols)}>
            <div className="flex min-w-0 items-center gap-2.5"><Face name={name(s)} className="size-8 text-[11px]"/><div className="min-w-0"><div className="truncate font-medium">{name(s)}</div><div className="text-[12px] text-[var(--text-faint)]">{label(s.fields.model?.[0]) || "No model"}</div></div></div>
            <span className="num text-right">{actual ?? "—"}</span>
            <span className="num text-right text-[var(--text-faint)]">{goal ?? "—"}</span>
            <div className="flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-100)]"><div className="h-full rounded-full" style={{width: Math.min(100, (actual ?? 0) / (goal || 1) * 100) + "%", background: pct === null ? "#0a0a0a4d" : pct >= 1 ? "#1f7a45" : pct >= 0.8 ? "#b77400" : "#c81e1e"}}/></div>
              <span className="num w-11 text-right text-[12px]">{pct === null ? "" : Math.round(pct * 100) + "%"}</span></div>
            <div className="text-right"><span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold", cls)}>{txt}</span></div>
          </div>;
        })}
      </div></div>
    </section>

    <section className={section}>
      <header className="px-6 pb-4 pt-6"><h2 className="text-[18px] font-bold tracking-[-0.02em]">Team</h2><p className="mt-1 text-[13px] text-[var(--text-faint)]">Click any cell to edit. Set Status to Inactive instead of deleting. Rates and schedules here drive the pay run.</p></header>
      <div className="flex flex-wrap items-center gap-2 border-y border-[var(--ink-100)] px-5 py-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search staff" className="h-8 min-w-[200px] max-w-[320px] flex-1 rounded-[8px] border border-[var(--ink-100)] bg-[var(--surface-card)] px-3 text-[13px] outline-none focus:border-[var(--signal)]"/>
        <Select variant="none" value={fStatus} onChange={setFStatus} ariaLabel="Filter by status" className="h-8 rounded-[8px] border border-[var(--ink-100)] bg-[var(--surface-card)] px-2.5 text-[12.5px]"
          options={[{value: "", label: "Status: All"}, ...CHOICES.staffStatus.map(s => ({value: s, label: "Status: " + s}))]}/>
      </div>
      <div className="overflow-x-auto"><div className="min-w-[1240px]">
        <div className={cn("grid h-9 gap-2 px-5", teamCols, head)}><span>ID</span><span>Name</span><span>Status</span><span>Model</span><span>Role</span><span className="text-right">Rate /h</span><span className="text-right">Std hours</span><span className="text-right">Days / week</span><span>Email</span><span/></div>
        {team.map(s => { const n = name(s), st = status(s) || "Active", days = daysPerWeek(off(s)), rate = s.fields.rate;
          return <div key={s.id} className={cn("grid min-h-11 items-center gap-2 border-b border-[var(--ink-100)] px-5 py-0.5 text-[13px] hover:bg-[#e7e3dc4d]", teamCols)}>
            <span className="num text-[12px] text-[var(--text-faint)]">{label(s.fields.staffId)}</span>
            <span className="flex min-w-0 items-center gap-2"><Face name={n} className="size-6 text-[9.5px]"/>
              <Cell value={n} aria-label="Name" className="min-w-0 flex-1 px-1.5 font-medium" onCommit={v => v ? void save(s, {name: v}, `${v} · saved`) : false}/></span>
            <Select variant="none" value={st} onChange={v => v !== st && save(s, {status: v}, `${n} set to ${v}`)} ariaLabel={`Status for ${n}`}
              className={cn("h-[26px] w-max rounded-full px-2 text-[11px] font-semibold", ST[st])} options={CHOICES.staffStatus.map(v => ({value: v, label: v}))}/>
            <Select variant="cell" value={linkIds(s.fields.model)[0] ?? ""} options={modelOpts} ariaLabel={`Model for ${n}`} className="px-1"
              onChange={v => save(s, {model: v ? [v] : []}, `${n} · model saved`, {model: v ? [{id: v, label: modelOpts.find(o => o.value === v)?.label}] : []})}/>
            <Select variant="cell" value={roleOf(s.fields.platform)} options={ROLES.map(r => ({value: r, label: r}))} ariaLabel={`Role for ${n}`} className="px-1"
              onChange={v => save(s, {platform: v}, `${n} · now under ${v} on Conversions`)}/>
            <Cell type="number" min={0} step={0.25} value={rate} placeholder="Not set" aria-label={`Rate for ${n}`} className={cn("num px-2 text-right hover:border-[var(--ink-200)]", !num(rate) && "border-[#e5a59e]")}
              onCommit={v => void save(s, {rate: v === "" ? null : Number(v)}, "Rate saved · applies to unlocked pay periods")}/>
            <Cell type="number" min={0} max={24} value={s.fields.hours} aria-label={`Standard hours for ${n}`} className="num px-2 text-right"
              onCommit={v => void save(s, {hours: Number(v) || 0}, "Standard day saved")}/>
            <Cell type="number" min={1} max={7} step={1} value={days} aria-label={`Working days per week for ${n}`} title={`${days} working days a week`} className="num px-2 text-right"
              onCommit={raw => { const v = Math.round(Number(raw)); if (!raw || v < 1 || v > 7) { toast.error("Enter 1 to 7 days"); return false; }
                save(s, {daysOff: JSON.stringify(offForDays(v))}, `${n} now works ${v} day${v > 1 ? "s" : ""} a week`); }}/>
            <Cell type="email" value={s.fields.email} placeholder="—" aria-label={`Email for ${n}`} className="px-1.5 text-[var(--text-faint)]"
              onCommit={v => void save(s, {email: v || null}, `${n} · email saved`)}/>
            <span className="flex justify-end">{confirmDel === s.id
              ? <button type="button" onClick={() => remove(s)} onBlur={() => setConfirmDel(null)} autoFocus className="h-7 rounded-full bg-[#f4dad7] px-3 text-[12px] font-semibold text-[var(--negative-fg)]">Delete</button>
              : <button type="button" onClick={() => setConfirmDel(s.id)} aria-label={`Delete ${n || "this blank row"}`} title="Delete" className="grid size-8 place-items-center rounded-[8px] text-[var(--text-faint)] hover:bg-[#f4dad7] hover:text-[var(--negative-fg)]"><Trash2 className="size-4"/></button>}</span>
          </div>; })}
      </div></div>
      <div className="px-5 py-3 text-[12.5px] text-[var(--text-faint)]">{team.length} staff</div>
    </section>

    <section className={section}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div><h2 className="text-[18px] font-bold tracking-[-0.02em]">Weekly minimums</h2><p className="mt-1 text-[13px] text-[var(--text-faint)]">One number per VA. It&apos;s the target on Conversions, the leaderboard and performance, checked against each week&apos;s count.</p></div>
        <LinkBtn size="sm" href="/conversions">Enter this week&apos;s counts<ArrowRight className="!size-[13px]"/></LinkBtn>
      </header>
      <div className="overflow-x-auto border-t border-[var(--ink-100)]"><div className="min-w-[720px]">
        <div className={cn("grid h-9 gap-4 px-6", minCols, head)}><span>VA</span><span className="text-right">Weekly minimum</span><span>This week so far · day {day}/7</span><span className="text-right">Last week</span></div>
        {mins.map(s => {
          const n = name(s), role = roleOf(s.fields.platform), m = targetOf(s), now = sumWeek(s.id, thisWeek), last = sumWeek(s.id, addDays(thisWeek, -7));
          const ok = !!m && now != null && now >= m * day / 7, met = !!m && (now ?? 0) >= m;
          return <div key={s.id} className={cn("grid min-h-[52px] items-center gap-4 border-b border-[var(--ink-100)] px-6 py-1 text-[13px]", minCols)}>
            <span className="flex min-w-0 items-center gap-2.5"><Face name={n} className="size-7 text-[10.5px]"/><span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--ink)]">{n}</span>
              <span className="inline-flex h-[18px] items-center rounded-full px-[7px] text-[10.5px] font-semibold" style={{background: ROLE_STYLE[role].pillBg, color: ROLE_STYLE[role].pillFg}}>{role}</span></span></span>
            <span className="flex items-center justify-end gap-1.5">
              <input key={String(m)} type="number" min={0} step={1} defaultValue={m ?? ""} placeholder="—" aria-label={`Weekly minimum for ${n}`}
                className={cn("num h-9 w-[84px] rounded-[8px] border bg-[var(--surface-card)] px-2.5 text-right text-[14px] font-bold outline-none focus:border-[var(--ink)] focus:shadow-[0_0_0_3px_#ff300026]", m == null ? "border-[#e5a59e]" : "border-[var(--ink-100)]")}
                onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = m == null ? "" : String(m); e.currentTarget.blur(); } }}
                onBlur={e => { const raw = e.target.value.trim(), v = raw === "" ? null : Math.round(Number(raw)); if (v === m) return;
                  if (v !== null && (!Number.isFinite(v) || v < 0)) { toast.error("Enter a whole number"); e.target.value = m == null ? "" : String(m); return; }
                  save(s, {weeklyMin: v}, v == null ? `${n}: no weekly minimum` : `${n}: ${v} a week · synced to Conversions`); }}/>
              <span className="text-[12px] text-[var(--text-faint)]">/ wk</span></span>
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--ink-100)]">
                <div className="absolute inset-y-0 left-0 bg-[#0a0a0a1a]" style={{width: m ? day / 7 * 100 + "%" : 0}}/>
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]" style={{width: m ? Math.min(100, (now ?? 0) / m * 100) + "%" : 0, background: !m ? "#0a0a0a4d" : met ? "#1f7a45" : ok ? "var(--ink)" : "#c98a1c"}}/>
              </div>
              <span className="num w-[120px] whitespace-nowrap text-right text-[12px] font-semibold" style={{color: now == null ? "var(--text-faint)" : !m ? "var(--ink)" : met ? "#1d7341" : ok ? "var(--ink)" : "#8f5a00"}}>
                {now == null ? "Not entered" : m ? `${now} of ${m}${met ? " ✓" : ok ? " · on pace" : " · behind"}` : now}</span>
            </div>
            <span className="num whitespace-nowrap text-right text-[12.5px] font-semibold" style={{color: last == null || !m ? "var(--text-faint)" : last >= m ? "#1d7341" : "#c01d1d"}}>{last == null ? "—" : m ? `${last} / ${m}` : last}</span>
          </div>;
        })}
      </div></div>
    </section>

    <AddStaff open={adding} onClose={() => setAdding(false)} create={staff.create} rows={staff.rows} models={models.rows} today={today}/>
  </div>;
}

function AddStaff({open, onClose, create, rows, models, today}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>; rows: Row[]; models: Row[]; today: string}) {
  const next = "VA" + (Math.max(0, ...rows.map(r => /^VA\d+$/i.test(label(r.fields.staffId)) ? parseInt(label(r.fields.staffId).slice(2)) : 0)) + 1);
  const blank = {name: "", model: "", platform: "X", payType: "Hourly", rate: "", hours: "8", off: "[0]", weeklyMin: "", email: "", start: today};
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (v: any) => setF(x => ({...x, [k]: typeof v === "string" ? v : v.target.value}));
  const modelOpts = [{value: "", label: "—"}, ...linkOptions(models.filter(m => label(m.fields.status) !== "Ended"), "model")];
  const name = f.name.trim();
  async function submit() {
    if (!name) return;
    setBusy(true);
    try {
      await create({staffId: next, name, status: "Active", model: f.model ? [f.model] : [], platform: f.platform, payType: f.payType, currency: "USD",
        rate: f.rate === "" ? null : Number(f.rate), hours: f.hours === "" ? null : Number(f.hours), daysOff: f.off,
        weeklyMin: f.weeklyMin === "" || !hasTarget(f.platform) ? null : Math.round(Number(f.weeklyMin)), email: f.email || null, start: f.start || null});
      toast(`${name} added as ${next} · now on Conversions under ${f.platform}`); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const opt = (a: readonly string[]) => a.map(v => ({value: v, label: v}));
  return <Drawer open={open} onClose={onClose} title="Add staff member" subtitle={`Will be created as ${next}. No rate = flagged "Pay not set" in the pay run.`}
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!name}>Add staff</Btn></>}>
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Full name" className="col-span-2"><input className={inputClass} value={f.name} onChange={set("name")} autoFocus/></Field>
      <Field label="Model" className="col-span-2"><Select value={f.model} options={modelOpts} onChange={set("model")} ariaLabel="Model"/></Field>
      <Field label="Marketing role"><Select value={f.platform} options={opt(ROLES)} onChange={set("platform")} ariaLabel="Marketing role"/></Field>
      <Field label="Pay type"><Select value={f.payType} options={opt(CHOICES.payType)} onChange={set("payType")} ariaLabel="Pay type"/></Field>
      <Field label="Hourly rate (USD)"><input type="number" min={0} step="0.01" className={inputClass + " num"} value={f.rate} onChange={set("rate")}/></Field>
      <Field label="Standard daily hours"><input type="number" min={0} max={24} className={inputClass + " num"} value={f.hours} onChange={set("hours")}/></Field>
      {hasTarget(f.platform) && <Field label="Weekly conversion minimum" className="col-span-2" hint="Shows as their target on Conversions"><input type="number" min={0} step={1} className={inputClass + " num"} value={f.weeklyMin} onChange={set("weeklyMin")}/></Field>}
      <Field label="Days off" className="col-span-2"><Select value={f.off} onChange={set("off")} ariaLabel="Days off"
        options={[{value: "[0]", label: "Sunday"}, {value: "[0,6]", label: "Saturday + Sunday"}, {value: "[]", label: "None (7 days)"}]}/></Field>
      <Field label="Email" className="col-span-2"><input type="email" className={inputClass} value={f.email} onChange={set("email")}/></Field>
      <Field label="Start date" className="col-span-2"><input type="date" className={inputClass} value={f.start} onChange={set("start")}/></Field>
    </div>
  </Drawer>;
}
