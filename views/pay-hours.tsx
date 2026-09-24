"use client";
import {useEffect, useMemo, useState} from "react";
import {toast} from "sonner";
import {CalendarDays, Check, CircleDot, Clock, DollarSign, FileText, Minus, Plus, User, Wallet} from "lucide-react";
import {Btn, Drawer, Field, PageHeader, PageSkeleton, Panel, Segmented, Stat, inputClass} from "@/components/bh/ui";
import {DataGrid} from "@/components/bh/grid";
import {addDays, label, linkIds, money, mondayOf, num, todayIso} from "@/lib/bh";
import {CHOICES, linkOptions, opts, useTable} from "@/lib/tables";

type Range = "week" | "month" | "last-month" | "all";

export default function PayHours() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const pay = useTable("paylog"), staff = useTable("staff");
  const [range, setRange] = useState<Range>("month");
  const [adding, setAdding] = useState(false);

  const bounds = useMemo((): [string, string] | null => {
    if (!today) return null;
    if (range === "week") return [mondayOf(today), today];
    if (range === "month") return [today.slice(0, 8) + "01", today];
    if (range === "last-month") { const last = addDays(today.slice(0, 8) + "01", -1); return [last.slice(0, 8) + "01", last]; }
    return ["0000-00-00", "9999-99-99"];
  }, [today, range]);
  const rows = useMemo(() => bounds ? pay.rows.filter(r => { const d = String(r.fields.workDate ?? "").slice(0, 10); return d >= bounds[0] && d <= bounds[1]; }) : [], [pay.rows, bounds]);

  if (!today || pay.loading || staff.loading) return <PageSkeleton/>;
  const week = mondayOf(today);
  const sum = (rs: typeof pay.rows, k: string) => rs.reduce((s, r) => s + num(r.fields[k]), 0);
  const thisWeek = pay.rows.filter(r => String(r.fields.workDate ?? "").slice(0, 10) >= week);
  const unpaid = pay.rows.filter(r => label(r.fields.status) !== "Paid");
  const loggedToday = new Set(pay.rows.filter(r => String(r.fields.workDate ?? "").slice(0, 10) === today).flatMap(r => linkIds(r.fields.staff)));
  const activeStaff = staff.rows.filter(s => label(s.fields.status) === "Active");

  async function markPaid(id: string) {
    try { await pay.update(id, {status: "Paid", paidDate: today}); toast.success("Marked as paid"); } catch (e: any) { toast.error(e.message); }
  }

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations" title="Pay & Hours" subtitle="Daily hours per person. Each row keeps the hourly rate it was logged at."
      actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus/>Log hours</Btn>}/>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Hours this week" icon={Clock} value={sum(thisWeek, "hours").toLocaleString()} sub={`${loggedToday.size}/${activeStaff.length} staff logged today`}/>
      <Stat label="Wages this week" icon={Wallet} value={money(sum(thisWeek, "totalPay"))} sub={`${thisWeek.length} entries`}/>
      <Stat label="Wages · selected period" icon={CalendarDays} value={money(sum(rows, "totalPay"))} sub={`${sum(rows, "hours").toLocaleString()} hours`}/>
      <Stat label="Unpaid outstanding" icon={DollarSign} value={money(sum(unpaid, "totalPay"))} tone={unpaid.length ? "negative" : ""} sub={`${unpaid.length} unpaid entries`}/>
    </div>

    <Panel title="Pay log" subtitle="Click a cell to edit. Hover a row to mark it paid or delete it." flush
      actions={<Segmented size="sm" value={range} onChange={setRange} options={[["week", "This week"], ["month", "This month"], ["last-month", "Last month"], ["all", "All time"]] as const}/>}>
      <div className="mt-4 border-t">
        <DataGrid rows={rows} initialSort={{key: "workDate", dir: "desc"}} pageSize={25} searchPlaceholder="Search staff, notes, status"
          columns={[
            {key: "workDate", label: "Date", icon: CalendarDays, type: "date"},
            {key: "staff", label: "Staff", icon: User, type: "link", options: linkOptions(staff.rows, "name"), filter: true, render: r => <span className="font-medium">{label(r.fields.staff?.[0])}</span>},
            {key: "hours", label: "Hours", icon: Clock, type: "number", editable: true},
            {key: "rate", label: "Rate", icon: DollarSign, type: "money", editable: true},
            {key: "bonus", label: "Bonus", icon: Plus, type: "money", editable: true, hideBelow: "lg"},
            {key: "deductions", label: "Deductions", icon: Minus, type: "money", editable: true, hideBelow: "lg"},
            {key: "totalPay", label: "Total", icon: Wallet, type: "money", render: r => <span className="font-semibold">{money(num(r.fields.totalPay), 2)}</span>},
            {key: "status", label: "Status", icon: CircleDot, type: "select", options: opts(CHOICES.payStatus), editable: true, filter: true},
            {key: "paidDate", label: "Paid on", icon: Check, type: "date", editable: true, hideBelow: "xl"},
            {key: "notes", label: "Notes", icon: FileText, type: "longtext", editable: true, hideBelow: "xl"},
          ]}
          onUpdate={(id, key, value) => pay.update(id, {[key]: value})}
          onDelete={r => pay.remove(r.id)}
          rowActions={r => label(r.fields.status) !== "Paid" ? <Btn size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => markPaid(r.id)}><Check/>Paid</Btn> : null}
          footer={rs => <><span>{rs.length} entries</span><span className="num">{sum(rs, "hours").toLocaleString()} h</span><span className="num font-medium text-foreground">{money(sum(rs, "totalPay"), 2)}</span></>}/>
      </div>
    </Panel>

    <LogHours open={adding} onClose={() => setAdding(false)} staff={activeStaff} create={pay.create} today={today}/>
  </div>;
}

function LogHours({open, onClose, staff, create, today}: {open: boolean; onClose: () => void; staff: {id: string; fields: Record<string, any>}[]; create: (f: any) => Promise<any>; today: string}) {
  const blank = {staff: "", date: today, hours: "", bonus: "", deductions: "", notes: ""};
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k: string) => (e: any) => setF(x => ({...x, [k]: e.target.value}));
  const person = staff.find(s => s.id === f.staff);
  const rate = person ? num(person.fields.rate) : 0;
  const hours = Number(f.hours) || 0;
  const total = hours * rate + (Number(f.bonus) || 0) - (Number(f.deductions) || 0);
  async function submit() {
    setBusy(true);
    try {
      await create({staff: [f.staff], workDate: f.date, hours, rate, bonus: f.bonus === "" ? null : Number(f.bonus), deductions: f.deductions === "" ? null : Number(f.deductions), status: "Unpaid", notes: f.notes || null});
      toast.success(`${hours} h logged for ${label(person?.fields.name)}`); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Log hours" subtitle="One day for one person. Their current hourly rate is saved onto the row."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!f.staff || !f.date || f.hours === "" || !person?.fields.rate}>Save</Btn></>}>
    <Field label="Staff" hint={person && !person.fields.rate ? "This person has no hourly rate — set one on the Staff page first." : person ? `Rate ${money(rate, 2)}/h` : undefined}>
      <select className={inputClass} value={f.staff} onChange={set("staff")} autoFocus><option value="">Choose…</option>{staff.map(s => <option key={s.id} value={s.id}>{label(s.fields.name)}</option>)}</select>
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Work date"><input type="date" max={today} className={inputClass} value={f.date} onChange={set("date")}/></Field>
      <Field label="Hours"><input type="number" min={0} max={24} step="0.25" className={inputClass + " num"} value={f.hours} onChange={set("hours")}/></Field>
      <Field label="Bonus"><input type="number" min={0} step="0.01" className={inputClass + " num"} value={f.bonus} onChange={set("bonus")}/></Field>
      <Field label="Deductions"><input type="number" min={0} step="0.01" className={inputClass + " num"} value={f.deductions} onChange={set("deductions")}/></Field>
    </div>
    <Field label="Notes"><textarea rows={3} className={inputClass + " h-auto py-2"} value={f.notes} onChange={set("notes")}/></Field>
    <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3 text-[13px]"><span className="text-muted-foreground">Estimated pay</span><span className="num text-base font-semibold">{money(total, 2)}</span></div>
  </Drawer>;
}
