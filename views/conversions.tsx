"use client";
import {useEffect, useRef, useState} from "react";
import {ChevronLeft, ChevronRight, CornerDownRight, TriangleAlert} from "lucide-react";
import {PageHeader, PageSkeleton, Segmented, TableError} from "@/components/bh/ui";
import {Select} from "@/components/bh/menu";
import {toast} from "@/components/bh/toast";
import {addDays, label, linkIds, mondayOf, num, shortDate, todayIso, weekLabel} from "@/lib/bh";
import {useModels, useTable} from "@/lib/tables";
import {CONVERTING, dayOfWeek, initials, paceFor, ROLE_STYLE, ROLES, roleOf, targetOf, toneOf, type Role} from "@/lib/team";

type Row = {id: string; fields: Record<string, any>};
type Hover = {w: string; x: number; y: number; week: string; value: number; name: string; note: string; c: string};

const DOT: Record<Role, string> = {X: "var(--text-heading)", Discord: "#2166c9", IG: "#b8327a", "IG MR": ROLE_STYLE["IG MR"].c, VPS: ROLE_STYLE.VPS.c};
const TONE_FG = {met: "var(--positive-fg)", short: "var(--warning-fg)", low: "var(--negative-fg)", missing: "var(--text-faint)", none: "var(--text-faint)"};
const TIP_C = {met: "#7fd3a0", short: "#f2c46b", low: "#ff8a73", missing: "#f4f1ea99", none: "#f4f1ea99"};
const RANGES = [["this", "This week"], ["last", "Last week"], ["2w", "Last 2 weeks"], ["lastMonth", "Last month"], ["thisMonth", "This month"]] as const;
type Range = typeof RANGES[number][0];
const E_COLS = "minmax(170px,1.3fr) 96px minmax(80px,.8fr) 96px 64px 64px minmax(120px,1fr)";
const T_COLS = "minmax(180px,1fr) minmax(280px,3fr) 72px 72px 112px";
const first = (n: string) => n.split(" ")[0];
const wk = (r: Row) => String(r.fields.week ?? "").slice(0, 10);
const card = "overflow-hidden rounded-[20px] border border-[var(--border-faint)] bg-[var(--surface-card)] shadow-[0_1px_2px_#0a0a0a0a,0_8px_24px_-12px_#0a0a0a14]";

// Weeks (Mondays) covered by a running-totals range. Months use the weeks whose Monday falls inside the month.
export function weeksFor(range: Range, today: string) {
  const cur = mondayOf(today);
  if (range === "this") return [cur];
  if (range === "last") return [addDays(cur, -7)];
  if (range === "2w") return [addDays(cur, -14), addDays(cur, -7)];
  const m0 = today.slice(0, 7), mon = range === "lastMonth" ? addDays(m0 + "-01", -1).slice(0, 7) : m0, out: string[] = [];
  for (let w = mondayOf(mon + "-01"); w.slice(0, 7) <= mon && w <= cur; w = addDays(w, 7)) if (w.slice(0, 7) === mon) out.push(w);
  return out.length ? out : [cur];
}

function focusSel(sel: string) {
  setTimeout(() => { const el = document.querySelector<HTMLInputElement>(sel); el?.focus(); el?.select(); }, 40);
}

export default function Conversions() {
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => setWeek(mondayOf(todayIso())), []);
  const staff = useTable("staff"), conv = useTable("conversions"), models = useModels(), subs = useTable("paidSubs");
  // Unsaved input text. The ref mirrors it synchronously so blur/Esc handlers never read a stale draft.
  const [draft, setDraftState] = useState<Record<string, string>>({});
  const draftRef = useRef(draft);
  const setDraft = (d: Record<string, string>) => { draftRef.current = d; setDraftState(d); };
  // Optimistic values while a write is in flight: "c|staff|week", "s|model|week", "r|staff".
  const [opt, setOpt] = useState<Record<string, {v: any}>>({});
  const [range, setRange] = useState<Range>("thisMonth");
  const [hover, setHover] = useState<Hover | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const tables = [staff, conv, models, subs];
  if (tables.some(t => t.error)) return <TableError tables={tables}/>;
  if (!week || tables.some(t => t.loading)) return <PageSkeleton/>;

  const today = todayIso(), cur = mondayOf(today), lw = addDays(cur, -7), isCurrent = week === cur, dayN = dayOfWeek(today);

  async function persist(key: string, v: any, msg: string, write: () => Promise<unknown>) {
    const box = {v};
    setOpt(o => ({...o, [key]: box}));
    toast(msg);
    try { await write(); } catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setOpt(o => { if (o[key] !== box) return o; const n = {...o}; delete n[key]; return n; }); }
  }

  const entriesOf = (sid: string, w: string) => conv.rows.filter(c => wk(c) === w && linkIds(c.fields.staff).includes(sid));
  const sumFor = (sid: string, w: string): number | null => {
    const o = opt[`c|${sid}|${w}`]; if (o) return o.v;
    const e = entriesOf(sid, w); return e.length ? e.reduce((t, c) => t + num(c.fields.conversions), 0) : null;
  };
  const role = (s: Row): Role => opt[`r|${s.id}`]?.v ?? roleOf(s.fields.platform);
  const status = (s: Row) => label(s.fields.status);
  const modelName = (s: Row) => label(s.fields.model?.[0]) || "No model";
  const valueOf = (s: Row) => { const d = draft[s.id]; return d !== undefined ? (d === "" ? null : Number(d)) : sumFor(s.id, week); };
  const counted = staff.rows.filter(s => role(s) !== "VPS");
  const roles = CONVERTING.filter(r => counted.some(s => role(s) === r));

  // Save one VA's count for the selected week: one row per staff per week, empty deletes.
  function commit(s: Row) {
    const raw = draftRef.current[s.id]; if (raw === undefined) return true;
    const saved = sumFor(s.id, week!), w = week!, entries = entriesOf(s.id, w), name = first(label(s.fields.name));
    const drop = () => { const d = {...draftRef.current}; delete d[s.id]; setDraft(d); };
    if (raw.trim() === "") {
      drop();
      if (saved !== null) persist(`c|${s.id}|${w}`, null, `${name} cleared for ${weekLabel(w)}`, () => Promise.all(entries.map(e => conv.remove(e.id))));
      return true;
    }
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v < 0) { toast.error(`${name}: enter a whole number`); return false; }
    drop();
    if (v === saved) return true;
    const modelId = linkIds(s.fields.model)[0];
    if (!entries.length && !modelId) { toast.error(`${name} has no model assigned. Set one on the Staff page.`); return true; }
    const t = targetOf(s);
    const msg = `${name} · ${v}${t != null && w !== cur ? (v >= t ? " · on target" : ` · ${t - v} short`) : ""} · saved`;
    persist(`c|${s.id}|${w}`, v, msg, async () => {
      if (!entries.length) return conv.create({week: w, staff: [s.id], model: [modelId], conversions: v, source: "Weekly entry"});
      await conv.update(entries[0].id, {conversions: v});
      await Promise.all(entries.slice(1).map(e => conv.remove(e.id)));
    });
    return true;
  }

  // Entry rows, grouped by role.
  const entryStaff = counted.filter(s => status(s) !== "Inactive" || sumFor(s.id, week) !== null);
  const order: Row[] = [];
  const groups = roles.map(r => ({r, vs: entryStaff.filter(s => role(s) === r).sort((a, b) => label(a.fields.name).localeCompare(label(b.fields.name)))})).filter(g => g.vs.length);
  groups.forEach(g => order.push(...g.vs));
  const active = entryStaff.filter(s => status(s) !== "Inactive");
  const missingCount = active.filter(s => valueOf(s) === null).length;
  const nextMiss = order.findIndex(s => status(s) !== "Inactive" && valueOf(s) === null);
  const weekTotal = entryStaff.reduce((t, s) => t + (valueOf(s) ?? 0), 0);
  const prevTotal = counted.reduce((t, s) => t + (sumFor(s.id, addDays(week, -7)) ?? 0), 0);
  const delta = prevTotal ? weekTotal - prevTotal : null;
  const lwMissing = counted.filter(s => status(s) === "Active" && sumFor(s.id, lw) === null);
  const liveModels = models.rows.filter(m => label(m.fields.status) !== "Ended");

  const goWeek = (w: string, sid?: string) => { setDraft({}); setHover(null); setWeek(w); if (sid) focusSel(`[data-conv-sid="${sid}"]`); };

  // Running totals.
  const weeks = weeksFor(range, today);
  const rowsAll = counted.filter(s => status(s) !== "Inactive" || weeks.some(w => sumFor(s.id, w) !== null)).map(s => {
    const vals = weeks.map(w => sumFor(s.id, w)), t = targetOf(s);
    const total = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
    const tsum = t == null ? 0 : weeks.reduce((a, w) => a + paceFor(t, w, today), 0);
    const judged = t == null ? [] : weeks.filter(w => w !== cur);
    const hit = judged.filter(w => (sumFor(s.id, w) ?? -1) >= t!).length;
    return {s, vals, t, total, tsum, hit, judged: judged.length, reported: vals.filter(v => v !== null).length};
  });
  const scale = Math.max(1, ...rowsAll.map(r => Math.max(r.total, r.tsum))) * 1.04;
  const allTotal = rowsAll.reduce((a, r) => a + r.total, 0);
  const tableGroups = roles.map(r => ({r, rs: rowsAll.filter(x => role(x.s) === r).sort((a, b) => b.total - a.total)})).filter(g => g.rs.length);
  const rangeHead = weeks.length === 1 ? weekLabel(weeks[0]) + (weeks[0] === cur ? " · in progress" : "")
    : `${shortDate(weeks[0])} → ${shortDate(addDays(weeks[weeks.length - 1], 6))} · ${weeks.length} weeks`;

  const weekPill = isCurrent ? ["This week · day " + dayN + "/7", "var(--signal-tint)", "var(--signal-tint-fg)"] : week === lw ? ["Last week", "var(--surface-sunken)", "var(--ink-600)"] : ["Past week", "var(--surface-sunken)", "var(--ink-600)"];
  const head = "grid items-center bg-[var(--surface-thead)] px-6 text-[11.5px] font-medium text-[var(--text-faint)]";

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations · Counted weekly" title="Conversions" subtitle="Enter each VA's weekly count. It adds to their running total below, split by marketing role."/>

    {isCurrent && lwMissing.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-[#f2e6d3] px-4 py-3 text-[13px] text-[#8f5a00]">
      <span className="flex items-center gap-2.5"><TriangleAlert className="size-4 shrink-0"/>Last week ({weekLabel(lw)}) is missing {lwMissing.map(s => first(label(s.fields.name))).join(", ")}.</span>
      <button type="button" onClick={() => goWeek(lw, lwMissing[0].id)} className="h-[30px] rounded-full border border-[#dcbf8f] bg-[#fbf9f5] px-3 text-[12.5px] font-semibold text-[#8f5a00]">Enter last week</button>
    </div>}

    <section className={card}>
      <header className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-[18px] font-bold tracking-[-0.02em]">Enter weekly counts</h2>
          <p className="mt-1 text-[13px] text-[var(--text-faint)]">Type a number and press Enter. It saves and moves to the next VA.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex h-10 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-card)] px-1">
            <button type="button" onClick={() => goWeek(addDays(week, -7))} aria-label="Previous week" className="grid h-full w-8 place-items-center text-[var(--text-faint)] hover:text-[var(--text-heading)]"><ChevronLeft className="size-4"/></button>
            <span className="flex items-center gap-2 whitespace-nowrap px-1 text-[13px] font-semibold text-[var(--text-heading)]">{weekLabel(week)}
              <span className="inline-flex h-[22px] items-center rounded-full px-[9px] text-[11px] font-semibold" style={{background: weekPill[1], color: weekPill[2]}}>{weekPill[0]}</span></span>
            <button type="button" onClick={() => !isCurrent && goWeek(addDays(week, 7))} disabled={isCurrent} aria-label="Next week" className="grid h-full w-8 place-items-center text-[var(--text-faint)] hover:text-[var(--text-heading)] disabled:opacity-30"><ChevronRight className="size-4"/></button>
          </div>
          {nextMiss >= 0 && <button type="button" onClick={() => focusSel(`[data-conv-idx="${nextMiss}"]`)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--surface-inverse)] px-4 text-[13px] font-semibold text-[var(--text-inverse)]">
            <CornerDownRight className="size-3.5"/>Next: {first(label(order[nextMiss].fields.name))}</button>}
        </div>
      </header>

      <div className="flex flex-wrap items-baseline gap-6 px-6 pb-5">
        <div className="flex items-baseline gap-2.5"><span className="num text-[40px] font-bold leading-none tracking-[-0.05em] text-[var(--text-heading)]">{weekTotal.toLocaleString()}</span><span className="text-[13px] text-[var(--text-faint)]">this week</span></div>
        {[
          {v: `${active.length - missingCount}/${active.length}`, k: "entered", c: missingCount ? "var(--text-heading)" : "var(--positive-fg)"},
          {v: delta === null ? "—" : (delta > 0 ? "+" : delta < 0 ? "−" : "±") + Math.abs(delta), k: "vs prior week", c: delta && delta > 0 ? "var(--positive-fg)" : delta && delta < 0 ? "var(--negative-fg)" : "var(--text-heading)"},
          {v: String(groups.length), k: "roles", c: "var(--text-heading)"},
        ].map(s => <div key={s.k} className="flex items-baseline gap-1.5 text-[13px] text-[var(--text-faint)]"><span className="num text-[15px] font-bold" style={{color: s.c}}>{s.v}</span>{s.k}</div>)}
      </div>

      <div className="overflow-x-auto border-t border-[var(--border-faint)]">
        <div className="min-w-[840px]">
          <div className={head + " h-[34px] gap-3"} style={{gridTemplateColumns: E_COLS}}><span>VA</span><span>Role</span><span>Model</span><span className="text-center">{isCurrent ? "This week" : shortDate(week)}</span><span className="text-right">Target</span><span className="text-right">Last wk</span><span>Status</span></div>
          {groups.map(g => {
            const done = g.vs.filter(s => sumFor(s.id, week) !== null).length;
            return <div key={g.r}>
              <div className="flex h-[30px] items-center justify-between border-b border-[var(--border-faint)] bg-[var(--surface-page)] px-6">
                <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[.12em] text-[var(--ink-600)]"><span className="size-1.5 rounded-full" style={{background: DOT[g.r]}}/>{g.r}</span>
                <span className="num text-[11.5px] font-semibold" style={{color: done === g.vs.length ? "var(--positive-fg)" : "var(--text-faint)"}}>{done === g.vs.length ? "All in" : `${done} of ${g.vs.length} in`}</span>
              </div>
              {g.vs.map(s => {
                const i = order.indexOf(s), name = label(s.fields.name), saved = sumFor(s.id, week), t = targetOf(s), v = valueOf(s), r = role(s);
                const d = draft[s.id], dirty = d !== undefined && (d === "" ? saved !== null : Number(d) !== saved);
                const pace = t == null ? null : paceFor(t, week, today), tone = v === null ? "missing" : toneOf(v, pace);
                const last = sumFor(s.id, addDays(week, -7));
                const statusText = v === null ? "Not entered" : t == null ? "No target" : tone === "met" ? (isCurrent ? "On pace" : "On target") : Math.ceil(pace! - v) + (isCurrent ? " behind pace" : " short");
                return <div key={s.id} className="grid h-11 items-center gap-3 border-b border-[var(--border-faint)] px-6 hover:bg-[var(--surface-page)]" style={{gridTemplateColumns: E_COLS, background: focusId === s.id ? "var(--surface-card)" : undefined}}>
                  <span className="flex min-w-0 items-center gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[9.5px] font-bold text-[var(--text-heading)]">{initials(name)}</span><span className="truncate text-[13px] font-semibold text-[var(--text-heading)]">{name}</span></span>
                  <span className="w-max rounded-full" style={{background: ROLE_STYLE[r].pillBg, color: ROLE_STYLE[r].pillFg}}><Select variant="none" value={r} ariaLabel={`Role for ${name}`} options={ROLES.map(x => ({value: x, label: x}))}
                    className="h-6 w-[74px] rounded-full px-2 text-[11.5px] font-semibold" display={r}
                    onChange={(nr: Role) => nr !== r && persist(`r|${s.id}`, nr, `${first(name)} moved to ${nr} · Staff updated`, () => staff.update(s.id, {platform: nr}))}/></span>
                  <span className="truncate text-[12.5px] text-[var(--text-faint)]">{modelName(s)}{status(s) === "Setup" ? " · Setup" : ""}</span>
                  <input type="number" min={0} inputMode="numeric" placeholder="—" data-conv-idx={i} data-conv-sid={s.id} aria-label={`Conversions for ${name}, ${weekLabel(week)}`}
                    value={d ?? (saved ?? "")}
                    onChange={e => setDraft({...draftRef.current, [s.id]: e.target.value})}
                    onFocus={() => setFocusId(s.id)}
                    onBlur={() => { commit(s); setFocusId(null); }}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); if (commit(s)) focusSel(`[data-conv-idx="${Math.min(i + 1, order.length - 1)}"]`); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); if (commit(s)) focusSel(`[data-conv-idx="${Math.max(0, i - 1)}"]`); }
                      else if (e.key === "Escape") { const n = {...draftRef.current}; delete n[s.id]; setDraft(n); e.currentTarget.blur(); }
                    }}
                    className="num h-8 w-[84px] justify-self-center rounded-[8px] bg-[var(--surface-card)] px-2.5 text-center text-[14px] font-bold text-[var(--text-heading)] outline-none focus:!border-solid focus:!border-[var(--text-heading)] focus:shadow-[0_0_0_3px_#ff300026] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    style={{border: `1.5px ${saved === null && !dirty ? "dashed" : "solid"} ${dirty ? "var(--signal)" : saved === null ? "var(--border-subtle)" : "var(--border-faint)"}`}}/>
                  <span className="num text-right text-[12.5px] text-[var(--text-faint)]">{t ?? "—"}</span>
                  <span className="num text-right text-[12.5px] text-[var(--text-faint)]">{last ?? "—"}</span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold" style={{color: v === null ? TONE_FG.missing : TONE_FG[tone]}}><span className="size-1.5 rounded-full bg-current"/>{statusText}</span>
                </div>;
              })}
            </div>;
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--border-faint)] bg-[color-mix(in_srgb,var(--surface-page)_50%,transparent)] px-6 py-4">
        <span className="text-[13px] font-semibold text-[var(--text-heading)]">Paid subscribers this week</span>
        {liveModels.map(m => {
          const name = label(m.fields.model), key = `s|${m.id}|${week}`;
          const recs = subs.rows.filter(r => wk(r) === week && linkIds(r.fields.model).includes(m.id));
          const saved: number | null = opt[key] ? opt[key].v : recs.length ? num(recs[0].fields.paidSubs) : null;
          const dk = "sub:" + m.id, sd = draft[dk];
          const commitSubs = () => {
            const raw = draftRef.current[dk]; if (raw === undefined) return;
            const n = {...draftRef.current}; delete n[dk]; const w = week;
            if (raw.trim() === "") { setDraft(n); if (recs.length) persist(key, null, `Paid subs cleared for ${name}`, () => Promise.all(recs.map(r => subs.remove(r.id)))); return; }
            const v = Number(raw);
            if (!Number.isSafeInteger(v) || v < 0) { toast.error("Enter a whole number of subs"); return; }
            setDraft(n);
            if (v !== saved) persist(key, v, `${v} paid subs saved for ${name}`, () => recs.length ? subs.update(recs[0].id, {paidSubs: v}) : subs.create({name: `${name} · ${w}`, week: w, model: [m.id], paidSubs: v}));
          };
          return <label key={m.id} className="flex items-center gap-2 text-[12.5px] text-[var(--text-faint)]">{name}
            <input type="number" min={0} placeholder="—" aria-label={`Paid subscribers for ${name}`} value={sd ?? (saved ?? "")}
              onChange={e => setDraft({...draftRef.current, [dk]: e.target.value})} onBlur={commitSubs}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              className="num h-8 w-[68px] rounded-[8px] border bg-[var(--surface-card)] px-2 text-right text-[13px] font-semibold text-[var(--text-heading)] outline-none focus:!border-[var(--text-heading)]"
              style={{borderColor: sd !== undefined && (sd === "" ? saved !== null : Number(sd) !== saved) ? "var(--signal)" : "var(--border-faint)"}}/>
          </label>;
        })}
      </div>
    </section>

    <section className={card}>
      <header className="flex flex-wrap items-start justify-between gap-4 px-6 pb-3 pt-6">
        <div className="max-w-[560px]">
          <h2 className="text-[18px] font-bold tracking-[-0.02em]">Running totals</h2>
          <p className="mt-1 text-pretty text-[13px] text-[var(--text-faint)]">Each bar adds up the weeks, one block per week, in the VA&apos;s channel colour. Hover a block for its count and how it did against target; that week lights up for every VA. Click a block to edit it.</p>
        </div>
        <Segmented size="sm" value={range} options={RANGES} onChange={setRange}/>
      </header>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-6 pb-4 text-[12px] text-[var(--text-faint)]">
        {CONVERTING.map(r => <span key={r} className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[4px]" style={{background: ROLE_STYLE[r].bar}}/>{r}</span>)}
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[4px]" style={{background: "#0a0a0a1f", border: "1.5px dashed var(--text-heading)"}}/>This week, in progress</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--text-heading)]"/>Combined target</span>
      </div>

      <div className="overflow-x-auto border-t border-[var(--border-faint)]">
        <div className="min-w-[880px]">
          <div className={head + " h-9 gap-4"} style={{gridTemplateColumns: T_COLS}}><span>VA</span><span>{rangeHead}</span><span className="text-right">Total</span><span className="text-right">Avg / wk</span><span className="text-right">Weeks on target</span></div>
          {tableGroups.map(g => <div key={g.r}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-faint)] bg-[var(--surface-page)] px-6 py-3">
              <span className="flex items-center gap-2.5"><span className="size-2 rounded-full" style={{background: DOT[g.r]}}/><span className="text-[13px] font-bold text-[var(--text-heading)]">{g.r}</span><span className="text-[12px] text-[var(--text-faint)]">{g.rs.length} VA{g.rs.length > 1 ? "s" : ""}</span></span>
              <span className="num text-[13px] font-bold text-[var(--text-heading)]">{g.rs.reduce((a, r) => a + r.total, 0).toLocaleString()}</span>
            </div>
            {g.rs.map(r => {
              const st = ROLE_STYLE[g.r], name = label(r.s.fields.name);
              return <div key={r.s.id} className="grid min-h-[60px] items-center gap-4 border-b border-[var(--border-faint)] px-6 py-2" style={{gridTemplateColumns: T_COLS}}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[11px] font-bold text-[var(--text-heading)]">{initials(name)}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[var(--text-heading)]">{name}</div>
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-[var(--text-faint)]"><span className="inline-flex h-[18px] items-center rounded-full bg-[var(--surface-sunken)] px-[7px] text-[10.5px] font-semibold text-[var(--ink-600)]">{g.r}</span>{modelName(r.s)}{status(r.s) !== "Active" ? " · " + status(r.s) : ""}</div>
                  </div>
                </div>
                <div className="relative h-[30px]">
                  <div className="absolute inset-0 rounded-[10px] shadow-[inset_0_1px_2px_#0a0a0a1f]" style={{background: st.track}}/>
                  <div className="absolute inset-[3px] flex gap-[3px]">
                    {weeks.map((w, k) => ({w, v: r.vals[k]})).filter((x): x is {w: string; v: number} => x.v !== null && x.v > 0).map(({w, v}) => {
                      const now = w === cur, pct = v / scale * 100, tone = toneOf(v, r.t == null ? null : paceFor(r.t, w, today));
                      const enter = (el: HTMLElement) => { const b = el.getBoundingClientRect(), t = r.t;
                          const note = t == null ? "No target set" : now ? (tone === "met" ? "On pace for " + t : "Behind pace · target " + t) : v >= t ? "On target · " + t : `${t - v} short of ${t}`;
                          setHover({w, x: b.left + b.width / 2, y: b.top, week: weekLabel(w) + (now ? " · in progress" : ""), value: v, name, note, c: TIP_C[tone]}); };
                      return <button key={w} type="button" aria-label={`${name}, ${weekLabel(w)}: ${v}`}
                        onMouseEnter={e => enter(e.currentTarget)} onFocus={e => enter(e.currentTarget)}
                        onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
                        onClick={() => { window.scrollTo({top: 0, behavior: "smooth"}); goWeek(w, r.s.id); }}
                        className="h-full min-w-1.5 cursor-pointer overflow-hidden whitespace-nowrap rounded-[7px] px-2 text-left font-mono text-[11px] font-bold transition-[opacity,transform] duration-150 ease-[cubic-bezier(.2,.8,.2,1)]"
                        style={{flex: `0 0 calc(${pct}% - 3px)`, background: now ? st.c + "33" : st.bar, border: now ? `1.5px dashed ${st.c}` : 0, color: now ? st.c : st.label,
                          boxShadow: now ? "none" : "inset 0 1px 0 #ffffff2e, 0 1px 3px #0a0a0a33", opacity: hover && hover.w !== w ? .25 : 1, transform: hover?.w === w ? "translateY(-1px)" : "none"}}>
                        {pct >= 5 ? v : ""}</button>;
                    })}
                  </div>
                  {r.t != null && <span title={`Combined target ${Math.round(r.tsum)}`} className="pointer-events-none absolute -bottom-[5px] -top-[5px] w-0.5 rounded-[2px] bg-[var(--ink)] shadow-[0_0_0_1.5px_#fbf9f5]" style={{left: `calc(${r.tsum / scale * 100}% - 1px)`}}>
                    <span className="absolute -left-[3px] -top-0.5 size-2 rounded-full bg-[var(--ink)] shadow-[0_0_0_2px_#fbf9f5]"/></span>}
                </div>
                <span className="num text-right text-[15px] font-bold text-[var(--text-heading)]">{r.total.toLocaleString()}</span>
                <span className="num text-right text-[13px] text-[var(--text-faint)]">{r.reported ? (r.total / r.reported).toFixed(1) : "—"}</span>
                <span className="num text-right text-[13px] font-semibold" style={{color: !r.judged ? "var(--text-faint)" : r.hit === r.judged ? "var(--positive-fg)" : r.hit / r.judged >= .5 ? "var(--warning-fg)" : "var(--negative-fg)"}}>{r.judged ? `${r.hit} of ${r.judged}` : "—"}</span>
              </div>;
            })}
          </div>)}
          <div className="grid items-center gap-4 bg-[color-mix(in_srgb,var(--surface-sunken)_40%,transparent)] px-6 py-3.5 text-[13px] font-semibold" style={{gridTemplateColumns: T_COLS}}>
            <span>All roles</span><span className="font-medium text-[var(--text-faint)]">{rowsAll.length} VAs across {tableGroups.length} roles</span>
            <span className="num text-right text-[15px] font-bold">{allTotal.toLocaleString()}</span><span className="num text-right text-[var(--text-faint)]">{(allTotal / Math.max(1, weeks.length)).toFixed(0)} / wk</span><span/>
          </div>
        </div>
      </div>
    </section>

    {hover && <div className="pointer-events-none fixed z-[80] whitespace-nowrap rounded-[12px] bg-[#0a0a0a] px-3.5 py-2.5 text-[#f4f1ea] shadow-[0_16px_48px_#0a0a0a40]" style={{left: hover.x, top: hover.y, transform: "translate(-50%, calc(-100% - 10px))"}}>
      <div className="font-mono text-[10.5px] uppercase tracking-[.1em] text-[#f4f1ea99]">{hover.week}</div>
      <div className="mt-1 flex items-baseline gap-2"><span className="num text-[20px] font-bold tracking-[-0.03em]">{hover.value}</span><span className="text-[12px] text-[#f4f1eacc]">{hover.name}</span></div>
      <div className="mt-0.5 text-[12px] font-semibold" style={{color: hover.c}}>{hover.note}</div>
    </div>}
  </div>;
}
