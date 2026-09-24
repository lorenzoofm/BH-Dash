"use client";
import {useEffect, useMemo, useState} from "react";
import {toast} from "sonner";
import {AtSign, CalendarDays, CircleDot, Clock, DollarSign, Globe, Hash, Plus, Tag, Target, User, UserCheck, Users, Wallet} from "lucide-react";
import {Avatar, Bar, Btn, Drawer, Field, PageHeader, PageSkeleton, Panel, Pill, Segmented, Stat, inputClass} from "@/components/bh/ui";
import {DataGrid} from "@/components/bh/grid";
import {addDays, label, linkIds, money, mondayOf, num, todayIso, weekLabel} from "@/lib/bh";
import {CHOICES, linkOptions, opts, useTable} from "@/lib/tables";

type Period = "this" | "last" | "4w";

export default function Staff() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const staff = useTable("staff"), models = useTable("models"), conv = useTable("conversions"), targets = useTable("expectations"), pay = useTable("paylog");
  const [period, setPeriod] = useState<Period>("last");
  const [adding, setAdding] = useState<null | "staff" | "target">(null);

  const perf = useMemo(() => {
    if (!today) return null;
    const thisWeek = mondayOf(today);
    const weeks = period === "this" ? [thisWeek] : period === "last" ? [addDays(thisWeek, -7)] : [-28, -21, -14, -7].map(n => addDays(thisWeek, n));
    const target = (sid: string, w: string) => targets.rows.filter(t => linkIds(t.fields.staff).includes(sid) && String(t.fields.week ?? "").slice(0, 10) <= w && t.fields.weekly != null)
      .sort((a, b) => String(b.fields.week).localeCompare(String(a.fields.week)))[0];
    return {
      weeks,
      rows: staff.rows.filter(s => label(s.fields.status) !== "Inactive").map(s => {
        let actual = 0, goal = 0, reported = 0, hasGoal = false;
        for (const w of weeks) {
          const e = conv.rows.filter(r => linkIds(r.fields.staff).includes(s.id) && String(r.fields.week ?? "").slice(0, 10) === w);
          if (e.length) { reported++; actual += e.reduce((t, r) => t + num(r.fields.conversions), 0); }
          const t = target(s.id, w);
          if (t) { hasGoal = true; goal += num(t.fields.weekly); }
        }
        const pct = hasGoal && goal ? actual / goal : null;
        return {id: s.id, name: label(s.fields.name), model: label(s.fields.model?.[0]), actual: reported ? actual : null, goal: hasGoal ? goal : null, pct, reported};
      }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || (b.actual ?? -1) - (a.actual ?? -1)),
    };
  }, [today, period, staff.rows, conv.rows, targets.rows]);

  if (!perf || [staff, models, conv, targets, pay].some(t => t.loading)) return <PageSkeleton/>;
  const active = staff.rows.filter(s => label(s.fields.status) === "Active");
  const thisWeek = mondayOf(today!);
  const hoursWeek = pay.rows.filter(r => String(r.fields.workDate ?? "").slice(0, 10) >= thisWeek).reduce((s, r) => s + num(r.fields.hours), 0);
  const avgRate = active.length ? active.reduce((s, r) => s + num(r.fields.rate), 0) / active.length : 0;
  const modelOpts = linkOptions(models.rows, "model"), staffOpts = linkOptions(staff.rows, "name");
  const onTarget = perf.rows.filter(r => r.pct !== null && r.pct >= 1).length, withGoal = perf.rows.filter(r => r.pct !== null).length;

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations" title="Staff" subtitle="Team directory, weekly targets and performance."
      actions={<><Btn onClick={() => setAdding("target")}><Target/>Set target</Btn><Btn variant="primary" onClick={() => setAdding("staff")}><Plus/>Add staff</Btn></>}/>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Active staff" icon={UserCheck} value={active.length} sub={`${staff.rows.filter(s => label(s.fields.status) === "Setup").length} in setup · ${staff.rows.filter(s => label(s.fields.status) === "Inactive").length} inactive`}/>
      <Stat label="On target" icon={Target} value={withGoal ? `${onTarget}/${withGoal}` : "—"} sub={period === "this" ? "this week so far" : period === "last" ? "last week" : "last 4 weeks"}/>
      <Stat label="Hours this week" icon={Clock} value={hoursWeek.toLocaleString()} sub={`Since ${weekLabel(thisWeek).split(" – ")[0]}`}/>
      <Stat label="Average hourly rate" icon={DollarSign} value={money(avgRate, 2)} sub="Active staff"/>
    </div>

    <Panel title="Performance" icon={Target} subtitle={`Conversions against weekly minimum · ${perf.weeks.length === 1 ? weekLabel(perf.weeks[0]) : `${weekLabel(perf.weeks[0]).split(" – ")[0]} – ${weekLabel(perf.weeks.at(-1)!).split(" – ")[1]}`}`}
      actions={<Segmented size="sm" value={period} onChange={setPeriod} options={[["this", "This week"], ["last", "Last week"], ["4w", "Last 4 weeks"]] as const}/>} flush>
      <div className="mt-4 overflow-x-auto border-t">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="border-b bg-muted/40 text-[11.5px] text-muted-foreground">
            <th className="h-9 px-5 text-left font-medium">VA</th><th className="px-4 text-right font-medium">Conversions</th><th className="px-4 text-right font-medium">Target</th>
            <th className="w-[28%] px-4 text-left font-medium">Achievement</th><th className="px-5 text-right font-medium">Status</th>
          </tr></thead>
          <tbody className="divide-y">{perf.rows.map(r => <tr key={r.id}>
            <td className="px-5 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={r.name}/><div><div className="font-medium">{r.name}</div><div className="text-[12px] text-muted-foreground">{r.model || "No model"}</div></div></div></td>
            <td className="num px-4 text-right">{r.actual ?? "—"}</td>
            <td className="num px-4 text-right text-muted-foreground">{r.goal ?? "—"}</td>
            <td className="px-4"><div className="flex items-center gap-3"><Bar value={r.actual ?? 0} max={r.goal ?? 1} className={r.pct === null ? "bg-foreground/30" : r.pct >= 1 ? "bg-positive" : r.pct >= 0.8 ? "bg-warning" : "bg-negative"}/><span className="num w-11 text-right text-[12px]">{r.pct === null ? "" : `${Math.round(r.pct * 100)}%`}</span></div></td>
            <td className="px-5 text-right">{r.actual === null ? <Pill>Not reported</Pill> : r.pct === null ? <Pill>No target</Pill> : r.pct >= 1 ? <Pill tone="green" dot>On target</Pill> : <Pill tone={r.pct >= 0.8 ? "amber" : "red"} dot>{r.goal! - r.actual} short</Pill>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Panel>

    <Panel title="Team" icon={Users} subtitle="Click any cell to edit. Set Status to Inactive instead of deleting." flush>
      <DataGrid rows={staff.rows} initialSort={{key: "name", dir: "asc"}} searchPlaceholder="Search staff"
        columns={[
          {key: "staffId", label: "ID", icon: Hash, width: "70px", render: r => <span className="num text-[12px] text-muted-foreground">{label(r.fields.staffId)}</span>},
          {key: "name", label: "Name", icon: User, editable: true, render: r => <span className="flex items-center gap-2.5 font-medium"><Avatar name={label(r.fields.name)} className="size-6 text-[9.5px]"/>{label(r.fields.name)}</span>},
          {key: "status", label: "Status", icon: CircleDot, type: "select", options: opts(CHOICES.staffStatus), editable: true, filter: true},
          {key: "model", label: "Model", icon: Tag, type: "link", options: modelOpts, editable: true, filter: true},
          {key: "platform", label: "Platform", icon: Globe, type: "select", options: opts(CHOICES.platform), editable: true, render: r => label(r.fields.platform), hideBelow: "lg"},
          {key: "payType", label: "Pay", icon: Wallet, type: "select", options: opts(CHOICES.payType), editable: true, render: r => label(r.fields.payType), hideBelow: "xl"},
          {key: "rate", label: "Rate /h", icon: DollarSign, type: "money", editable: true},
          {key: "hours", label: "Std hours", icon: Clock, type: "number", editable: true, hideBelow: "xl"},
          {key: "start", label: "Started", icon: CalendarDays, type: "date", editable: true, hideBelow: "lg"},
          {key: "email", label: "Email", icon: AtSign, editable: true, hideBelow: "xl"},
        ]}
        onUpdate={(id, key, value) => staff.update(id, {[key]: value})}/>
    </Panel>

    <Panel title="Target history" icon={Target} subtitle="Each target applies from its effective week until a newer one replaces it." flush>
      <DataGrid rows={targets.rows} initialSort={{key: "week", dir: "desc"}} pageSize={10} searchPlaceholder="Search targets"
        columns={[
          {key: "staff", label: "VA", icon: User, type: "link", options: staffOpts, filter: true},
          {key: "week", label: "Effective from", icon: CalendarDays, type: "date", render: r => weekLabel(String(r.fields.week ?? "").slice(0, 10))},
          {key: "daily", label: "Daily", type: "number", editable: true},
          {key: "weekly", label: "Weekly minimum", type: "number", editable: true},
          {key: "monthly", label: "Monthly", type: "number", editable: true},
        ]}
        onUpdate={(id, key, value) => targets.update(id, {[key]: value})}/>
    </Panel>

    <AddStaff open={adding === "staff"} onClose={() => setAdding(null)} create={staff.create} rows={staff.rows} modelOpts={modelOpts}/>
    <AddTarget open={adding === "target"} onClose={() => setAdding(null)} create={targets.create} staffOpts={linkOptions(active, "name")} week={thisWeek}/>
  </div>;
}

function AddStaff({open, onClose, create, rows, modelOpts}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>; rows: any[]; modelOpts: {value: string; label: string}[]}) {
  const next = "VA" + (Math.max(0, ...rows.map(r => parseInt(String(r.fields.staffId ?? "").replace(/\D/g, "")) || 0)) + 1);
  const blank = {name: "", model: "", platform: "OnlyFans", payType: "Hourly", rate: "", hours: "8", email: "", start: todayIso()};
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k: keyof typeof blank) => (e: any) => setF(x => ({...x, [k]: e.target.value}));
  async function submit() {
    setBusy(true);
    try {
      await create({staffId: next, name: f.name.trim(), status: "Active", model: f.model ? [f.model] : [], platform: f.platform, payType: f.payType, currency: "USD",
        rate: f.rate === "" ? null : Number(f.rate), hours: f.hours === "" ? null : Number(f.hours), email: f.email || null, start: f.start || null});
      toast.success(`${f.name} added as ${next}`); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Add staff member" subtitle={`Will be created as ${next}`}
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!f.name.trim()}>Add staff</Btn></>}>
    <Field label="Full name"><input className={inputClass} value={f.name} onChange={set("name")} autoFocus/></Field>
    <Field label="Model"><select className={inputClass} value={f.model} onChange={set("model")}><option value="">—</option>{modelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Platform"><select className={inputClass} value={f.platform} onChange={set("platform")}>{CHOICES.platform.map(o => <option key={o}>{o}</option>)}</select></Field>
      <Field label="Pay type"><select className={inputClass} value={f.payType} onChange={set("payType")}>{CHOICES.payType.map(o => <option key={o}>{o}</option>)}</select></Field>
      <Field label="Hourly rate (USD)"><input type="number" min={0} step="0.01" className={inputClass + " num"} value={f.rate} onChange={set("rate")}/></Field>
      <Field label="Standard daily hours"><input type="number" min={0} max={24} className={inputClass + " num"} value={f.hours} onChange={set("hours")}/></Field>
    </div>
    <Field label="Email"><input type="email" className={inputClass} value={f.email} onChange={set("email")}/></Field>
    <Field label="Start date"><input type="date" className={inputClass} value={f.start} onChange={set("start")}/></Field>
  </Drawer>;
}

function AddTarget({open, onClose, create, staffOpts, week}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>; staffOpts: {value: string; label: string}[]; week: string}) {
  const [f, setF] = useState({staff: "", week, daily: "", weekly: "", monthly: ""});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({staff: "", week, daily: "", weekly: "", monthly: ""}); }, [open]);
  const set = (k: string) => (e: any) => setF(x => ({...x, [k]: e.target.value}));
  const n = (v: string) => v === "" ? null : Math.round(Number(v));
  async function submit() {
    setBusy(true);
    try {
      const name = staffOpts.find(o => o.value === f.staff)?.label ?? "";
      await create({name, staff: [f.staff], week: mondayOf(f.week), daily: n(f.daily), weekly: n(f.weekly), monthly: n(f.monthly)});
      toast.success(`Target set for ${name}`); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Set a target" subtitle="Applies from the chosen week onwards. Leave any field blank for no target."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!f.staff}>Save target</Btn></>}>
    <Field label="VA"><select className={inputClass} value={f.staff} onChange={set("staff")}><option value="">Choose…</option>{staffOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
    <Field label="Effective week" hint={`Starts ${weekLabel(mondayOf(f.week || week))}`}><input type="date" className={inputClass} value={f.week} onChange={set("week")}/></Field>
    <div className="grid grid-cols-3 gap-3">
      <Field label="Daily"><input type="number" min={0} className={inputClass + " num"} value={f.daily} onChange={set("daily")}/></Field>
      <Field label="Weekly min."><input type="number" min={0} className={inputClass + " num"} value={f.weekly} onChange={set("weekly")}/></Field>
      <Field label="Monthly"><input type="number" min={0} className={inputClass + " num"} value={f.monthly} onChange={set("monthly")}/></Field>
    </div>
  </Drawer>;
}
