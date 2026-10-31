"use client";
import {useState} from "react";
import {ModelAvatar, Panel, RolePill, Stat} from "@/components/bh/ui";
import {Select} from "@/components/bh/menu";
import {cn} from "@/lib/utils";
import {CONVERTING, type Role} from "@/lib/team";

// A model's current chatters per role and its real OnlyFans subs per day this month.
export type StaffedModel = {id: string; name: string; avatar?: string | null; index: number; staff: Partial<Record<Role, number>>; subsByDay: Record<string, number> | undefined};

const n = (v: number | null | undefined, digits = 0) => v == null ? "—" : v.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits});
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
const HEAD = "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "min-h-12 border-b py-1.5 text-[13px] last:border-b-0";
const DUTY = "grid grid-cols-[minmax(150px,1.4fr)_repeat(4,minmax(56px,80px))_repeat(3,minmax(84px,110px))] items-center gap-2 px-6";
const RANK = "grid grid-cols-[40px_minmax(140px,1fr)_repeat(3,minmax(70px,96px))] items-center gap-2 px-6";

export function Staffing({models, days, subsReady}: {models: StaffedModel[]; days: string[]; subsReady: boolean}) {
  const total = (m: StaffedModel) => CONVERTING.reduce((a, r) => a + (m.staff[r] ?? 0), 0);
  const monthSubs = (m: StaffedModel) => m.subsByDay ? Object.values(m.subsByDay).reduce((a, x) => a + x, 0) : null;
  const perVaDay = (subs: number | null, staff: number, nDays: number) => subs == null || !staff || !nDays ? null : subs / staff / nDays;
  const allStaff = models.reduce((a, m) => a + total(m), 0);
  const allSubs = subsReady ? models.reduce((a, m) => a + (monthSubs(m) ?? 0), 0) : null;
  // Latest day by default; today is still filling in, so start on yesterday when there is one.
  const [day, setDay] = useState<string | null>(null);
  const picked = day && days.includes(day) ? day : days[Math.max(0, days.length - 2)] ?? "";
  const ranking = models.filter(m => total(m) > 0).map(m => {
    const subs = m.subsByDay ? m.subsByDay[picked] ?? 0 : null;
    return {m, subs, staff: total(m), ratio: subs == null ? null : subs / total(m)};
  }).sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || a.m.name.localeCompare(b.m.name));

  return <>
    <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {CONVERTING.map(r => <Stat key={r} label={`${r} chatters`} value={n(models.reduce((a, m) => a + (m.staff[r] ?? 0), 0))} sub="On duty now"/>)}
      <Stat label="All chatters" value={n(allStaff)} sub="Active staff on converting roles"/>
      <Stat label="Subs / chatter / day" value={n(perVaDay(allSubs, allStaff, days.length), 2)} sub={`Real subs ÷ chatters ÷ ${days.length} day${days.length === 1 ? "" : "s"}`}/>
    </div>

    <Panel flush title="Staff on duty by model" subtitle="Active staff from the Staff page, by role. Subs per chatter uses this month's real OnlyFans subs.">
      <div className="overflow-x-auto"><div className="min-w-[860px]">
        <div className={cn(DUTY, HEAD)}><span>Model</span>{CONVERTING.map(r => <span key={r} className="text-right">{r}</span>)}{["Chatters", "Real subs", "Subs / chatter / day"].map(h => <span key={h} className="text-right">{h}</span>)}</div>
        {models.map(m => { const t = total(m), subs = monthSubs(m); return <div key={m.id} className={cn(DUTY, ROW)}>
          <span className="flex min-w-0 items-center gap-2.5"><ModelAvatar name={m.name} src={m.avatar} index={m.index}/><span className="truncate font-semibold">{m.name}</span></span>
          {CONVERTING.map(r => <span key={r} className="num text-right">{m.staff[r] ? n(m.staff[r]) : "—"}</span>)}
          <span className="num text-right font-semibold">{t ? n(t) : "—"}</span>
          <span className="num text-right">{n(subs)}</span>
          <span className="num text-right font-semibold">{n(perVaDay(subs, t, days.length), 2)}</span>
        </div>; })}
      </div></div>
    </Panel>

    <Panel flush title="Daily subs per chatter" subtitle="Real OnlyFans subs that day ÷ chatters on the model. Lowest first, for staffing review."
      actions={days.length > 0 && <Select value={picked} onChange={setDay} ariaLabel="Day" className="w-[140px]"
        options={[...days].reverse().map(d => ({value: d, label: short(d)}))}/>}>
      <div className="overflow-x-auto"><div className="min-w-[520px]">
        <div className={cn(RANK, HEAD)}><span>#</span><span>Model</span>{["OF subs", "Chatters", "Subs / chatter"].map(h => <span key={h} className="text-right">{h}</span>)}</div>
        {!ranking.length && <p className="px-6 py-8 text-[13px] text-muted-foreground">No models have active chatters on the Staff page.</p>}
        {ranking.map(({m, subs, staff, ratio}, i) => <div key={m.id} className={cn(RANK, ROW)}>
          <span className="num text-muted-foreground">{i + 1}</span>
          <span className="flex min-w-0 items-center gap-2.5"><ModelAvatar name={m.name} src={m.avatar} index={m.index} size={24}/><span className="truncate font-semibold">{m.name}</span>
            <span className="hidden gap-1 sm:flex">{CONVERTING.filter(r => m.staff[r]).map(r => <RolePill key={r} role={r}/>)}</span></span>
          <span className="num text-right">{n(subs)}</span>
          <span className="num text-right">{n(staff)}</span>
          <span className="num text-right font-semibold">{n(ratio, 2)}</span>
        </div>)}
      </div></div>
    </Panel>
  </>;
}
