"use client";
import {useEffect, useMemo, useState} from "react";
import {toast} from "sonner";
import {Building2, CalendarDays, CircleDot, DollarSign, FileText, Hash, Layers, Plus, Receipt, Repeat, Tag, Type} from "lucide-react";
import {TableError, Bar, Btn, Drawer, Empty, Field, PageHeader, PageSkeleton, Panel, Segmented, Stat, inputClass} from "@/components/bh/ui";
import {DataGrid} from "@/components/bh/grid";
import {addDays, label, money, num, todayIso} from "@/lib/bh";
import {CHOICES, linkOptions, opts, useTable} from "@/lib/tables";

type Range = "month" | "last-month" | "90d" | "all";

export default function Expenses() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const exp = useTable("expenses"), models = useTable("models");
  const [range, setRange] = useState<Range>("month");
  const [adding, setAdding] = useState(false);

  const bounds = useMemo((): [string, string] | null => {
  if (!today) return null;
    if (range === "month") return [today.slice(0, 8) + "01", today];
    if (range === "last-month") { const last = addDays(today.slice(0, 8) + "01", -1); return [last.slice(0, 8) + "01", last]; }
    if (range === "90d") return [addDays(today, -89), today];
    return ["0000-00-00", "9999-99-99"];
  }, [today, range]);
  const rows = useMemo(() => bounds ? exp.rows.filter(r => { const d = String(r.fields.date ?? "").slice(0, 10); return range === "all" || (d >= bounds[0] && d <= bounds[1]); }) : [], [exp.rows, bounds, range]);

  if ([exp, models].some(t => t.error)) return <TableError tables={[exp, models]}/>;
  if (!today || exp.loading || models.loading) return <PageSkeleton/>;
  const sum = (rs: typeof rows) => rs.reduce((s, r) => s + num(r.fields.amount), 0);
  const paid = rows.filter(r => label(r.fields.status) === "Paid");
  const open = rows.filter(r => label(r.fields.status) !== "Paid");
  const recurring = exp.rows.filter(r => label(r.fields.billing) === "Monthly" && label(r.fields.status) !== "Planned");
  const categories = [...rows.reduce((m, r) => m.set(label(r.fields.category) || "Uncategorised", (m.get(label(r.fields.category) || "Uncategorised") ?? 0) + num(r.fields.amount)), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const top = categories[0]?.[1] ?? 0;
  const categoryOpts = opts([...new Set([...CHOICES.category, ...exp.rows.map(r => label(r.fields.category)).filter(Boolean)])].sort());
  const modelOpts = linkOptions(models.rows, "model");

  return <div className="space-y-6">
    <PageHeader eyebrow="Finance" title="Expenses" subtitle="Every operational cost. Paid expenses are deducted in the P&L; planned and unpaid ones are tracked here."
      actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus/>Add expense</Btn>}/>

    <div className="flex justify-end"><Segmented size="sm" value={range} onChange={setRange} options={[["month", "This month"], ["last-month", "Last month"], ["90d", "90 days"], ["all", "All time"]] as const}/></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Total recorded" icon={Receipt} value={money(sum(rows))} sub={`${rows.length} expenses`}/>
      <Stat label="Paid" icon={DollarSign} value={money(sum(paid))} sub="Deducted in the P&L"/>
      <Stat label="Unpaid & planned" icon={CalendarDays} value={money(sum(open))} tone={open.length ? "negative" : ""} sub={`${open.length} outstanding`}/>
      <Stat label="Monthly recurring" icon={Repeat} value={money(sum(recurring))} sub={`${recurring.length} monthly subscriptions`}/>
    </div>

    <Panel title="By category" icon={Layers}>
        {categories.length ? <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{categories.map(([c, v]) => <li key={c}>
          <div className="mb-1.5 flex justify-between text-[13px]"><span>{c}</span><span className="num font-medium">{money(v)}</span></div>
          <Bar value={v} max={top} className="bg-brand"/>
        </li>)}</ul> : <Empty title="No expenses in this period"/>}
      </Panel>

      <Panel title="Expense log" subtitle="Click any cell to edit." flush>
        <div className="mt-4 border-t">
          <DataGrid rows={rows} initialSort={{key: "date", dir: "desc"}} pageSize={20} searchPlaceholder="Search description, vendor, notes"
            columns={[
              {key: "date", label: "Date", icon: CalendarDays, type: "date", editable: true},
              {key: "description", label: "Description", icon: Type, editable: true, render: r => <span className="font-medium">{label(r.fields.description)}</span>},
              {key: "category", label: "Category", icon: Tag, type: "select", options: categoryOpts, editable: true, filter: true, render: r => label(r.fields.category) && <span className="rounded-md bg-muted px-2 py-0.5 text-[12px]">{label(r.fields.category)}</span>},
              {key: "vendor", label: "Vendor", icon: Building2, editable: true, hideBelow: "lg"},
              {key: "model", label: "Model", icon: Hash, type: "link", options: modelOpts, editable: true, filter: true, hideBelow: "xl"},
              {key: "billing", label: "Billing", icon: Repeat, type: "select", options: opts(CHOICES.billing), editable: true, render: r => label(r.fields.billing), hideBelow: "xl"},
              {key: "status", label: "Status", icon: CircleDot, type: "select", options: opts(CHOICES.expenseStatus), editable: true, filter: true},
              {key: "amount", label: "Amount", icon: DollarSign, type: "money", editable: true},
              {key: "currency", label: "Currency", type: "select", options: opts([...CHOICES.currency, "Other"]), editable: true, hideBelow: "xl"},
              {key: "channel", label: "Channel", editable: true, hideBelow: "xl"},
              {key: "sourceRef", label: "Source reference", editable: true, hideBelow: "xl"},
              {key: "notes", label: "Notes", icon: FileText, type: "longtext", editable: true, hideBelow: "xl"},
            ]}
            onUpdate={(id, key, value) => exp.update(id, {[key]: value})}
            onDelete={r => exp.remove(r.id)}
            footer={rs => <><span>{rs.length} expenses</span><span className="num font-medium text-foreground">{money(sum(rs), 2)}</span></>}/>
        </div>
      </Panel>

    <AddExpense open={adding} onClose={() => setAdding(false)} create={exp.create} today={today} categories={categoryOpts.map(o => o.value)} modelOpts={modelOpts}/>
  </div>;
}

function AddExpense({open, onClose, create, today, categories, modelOpts}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>; today: string; categories: string[]; modelOpts: {value: string; label: string}[]}) {
  const blank = {date: today, description: "", amount: "", category: "", vendor: "", model: "", billing: "One-off", status: "Paid", notes: ""};
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(blank); }, [open]);
  const set = (k: string) => (e: any) => setF(x => ({...x, [k]: e.target.value}));
  async function submit() {
    setBusy(true);
    try {
      const id = `EXP-${f.date.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await create({expenseId: id, date: f.date, description: f.description.trim(), amount: Number(f.amount), currency: "USD", category: f.category.trim() || null,
        vendor: f.vendor || null, model: f.model ? [f.model] : [], billing: f.billing, status: f.status, notes: f.notes || null});
      toast.success("Expense added"); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Add expense" subtitle="Leave Model empty for a shared cost."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!f.description.trim() || f.amount === "" || !f.date}>Add expense</Btn></>}>
    <Field label="Description"><input className={inputClass} value={f.description} onChange={set("description")} autoFocus/></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Amount (USD)"><input type="number" min={0} step="0.01" className={inputClass + " num"} value={f.amount} onChange={set("amount")}/></Field>
      <Field label="Date"><input type="date" className={inputClass} value={f.date} onChange={set("date")}/></Field>
      <Field label="Category"><input list="bh-categories" className={inputClass} value={f.category} onChange={set("category")}/><datalist id="bh-categories">{categories.map(c => <option key={c} value={c}/>)}</datalist></Field>
      <Field label="Vendor"><input className={inputClass} value={f.vendor} onChange={set("vendor")}/></Field>
      <Field label="Billing"><select className={inputClass} value={f.billing} onChange={set("billing")}>{CHOICES.billing.map(o => <option key={o}>{o}</option>)}</select></Field>
      <Field label="Status"><select className={inputClass} value={f.status} onChange={set("status")}>{CHOICES.expenseStatus.map(o => <option key={o}>{o}</option>)}</select></Field>
    </div>
    <Field label="Model"><select className={inputClass} value={f.model} onChange={set("model")}><option value="">Shared (no model)</option>{modelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
    <Field label="Notes"><textarea rows={3} className={inputClass + " h-auto py-2"} value={f.notes} onChange={set("notes")}/></Field>
  </Drawer>;
}
