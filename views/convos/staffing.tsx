"use client";
import {useState} from "react";
import {ModelAvatar, Panel, RolePill} from "@/components/bh/ui";
import {Select} from "@/components/bh/menu";
import {cn} from "@/lib/utils";
import {CONVERTING, type Role} from "@/lib/team";

// A model's current chatters per role and its real OnlyFans subs per day this month.
export type StaffedModel = {id: string; name: string; avatar?: string | null; index: number; staff: Partial<Record<Role, number>>; subsByDay: Record<string, number> | undefined};

const n = (v: number | null | undefined, digits = 0) => v == null ? "—" : v.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits});
const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
const HEAD = "h-9 bg-muted text-[11.5px] font-medium text-muted-foreground";
const ROW = "min-h-12 border-b py-1.5 text-[13px] last:border-b-0";
const RANK = "grid grid-cols-[40px_minmax(140px,1fr)_repeat(3,minmax(70px,96px))] items-center gap-2 px-6";

// Real OnlyFans subs that day ÷ the model's chatters, lowest first.
export function Staffing({models, days}: {models: StaffedModel[]; days: string[]}) {
  const total = (m: StaffedModel) => CONVERTING.reduce((a, r) => a + (m.staff[r] ?? 0), 0);
  // Latest day by default; today is still filling in, so start on yesterday when there is one.
  const [day, setDay] = useState<string | null>(null);
  const picked = day && days.includes(day) ? day : days[Math.max(0, days.length - 2)] ?? "";
  const ranking = models.filter(m => total(m) > 0).map(m => {
    const subs = m.subsByDay ? m.subsByDay[picked] ?? 0 : null;
    return {m, subs, staff: total(m), ratio: subs == null ? null : subs / total(m)};
  }).sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || a.m.name.localeCompare(b.m.name));

  return <Panel flush title="Daily subs per chatter" subtitle="Real OnlyFans subs that day ÷ chatters on the model. Lowest first, for staffing review."
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
  </Panel>;
}
