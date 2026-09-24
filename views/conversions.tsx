"use client";
import {useEffect, useMemo, useState} from "react";
import {toast} from "sonner";
import {CalendarDays, FileText, Hash, Save, Sparkles, Tag, User, Users} from "lucide-react";
import {Avatar, Btn, Empty, PageHeader, PageSkeleton, Panel, Pill, Stat, WeekStepper, inputClass} from "@/components/bh/ui";
import {DataGrid} from "@/components/bh/grid";
import {addDays, label, linkIds, mondayOf, num, todayIso, weekLabel} from "@/lib/bh";
import {linkOptions, useTable} from "@/lib/tables";

export default function Conversions() {
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => setWeek(mondayOf(todayIso())), []);
  const staff = useTable("staff"), conv = useTable("conversions"), models = useTable("models"), subs = useTable("paidSubs");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [subDraft, setSubDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft({}); setSubDraft({}); }, [week]);

  const rows = useMemo(() => {
    if (!week) return [];
    const entries = conv.rows.filter(r => String(r.fields.week ?? "").slice(0, 10) === week);
    return staff.rows
      .filter(s => label(s.fields.status) === "Active" || entries.some(e => linkIds(e.fields.staff).includes(s.id)))
      .map(s => {
        const mine = entries.filter(e => linkIds(e.fields.staff).includes(s.id));
        return {id: s.id, name: label(s.fields.name), modelId: linkIds(s.fields.model)[0] ?? null, model: label(s.fields.model?.[0]),
          entries: mine, saved: mine.length ? mine.reduce((t, e) => t + num(e.fields.conversions), 0) : null};
      }).sort((a, b) => a.name.localeCompare(b.name));
  }, [week, staff.rows, conv.rows]);

  if (!week || [staff, conv, models, subs].some(t => t.loading)) return <PageSkeleton/>;

  const current = week === mondayOf(todayIso());
  const valueOf = (r: typeof rows[number]) => draft[r.id] !== undefined && draft[r.id] !== "" ? Number(draft[r.id]) : r.saved;
  const changed = rows.filter(r => draft[r.id] !== undefined && draft[r.id] !== "" && Number(draft[r.id]) !== r.saved);
  const total = rows.reduce((t, r) => t + (valueOf(r) ?? 0), 0);
  const reported = rows.filter(r => valueOf(r) !== null).length;
  const prevTotal = conv.rows.filter(r => String(r.fields.week ?? "").slice(0, 10) === addDays(week, -7)).reduce((t, r) => t + num(r.fields.conversions), 0);
  const liveModels = models.rows.filter(m => label(m.fields.status) !== "Ended");
  const subsFor = (modelId: string) => subs.rows.find(r => linkIds(r.fields.model).includes(modelId) && String(r.fields.week ?? "").slice(0, 10) === week);
  const totalSubs = liveModels.reduce((s, m) => s + num(subsFor(m.id)?.fields.paidSubs), 0);

  async function saveWeek() {
    setSaving(true);
    let ok = 0;
    for (const r of changed) {
      const value = Math.round(Number(draft[r.id]));
      try {
        if (r.entries.length === 1) await conv.update(r.entries[0].id, {conversions: value});
        else if (!r.entries.length) {
          if (!r.modelId) throw new Error(`${r.name} has no model assigned — set one on the Staff page`);
          await conv.create({week, staff: [r.id], model: [r.modelId], conversions: value, source: "Weekly entry"});
        } else throw new Error(`${r.name} has several entries this week — edit them in the log`);
        ok++;
      } catch (e: any) { toast.error(e.message); }
    }
    setSaving(false);
    if (ok) { toast.success(`Saved ${ok} ${ok === 1 ? "entry" : "entries"} · ${weekLabel(week!)}`); setDraft({}); }
  }

  async function saveSubs(modelId: string, modelName: string) {
    const value = Math.round(Number(subDraft[modelId]));
    if (!Number.isFinite(value) || value < 0) return toast.error("Enter a whole number");
    const existing = subsFor(modelId);
    try {
      if (existing) await subs.update(existing.id, {paidSubs: value});
      else await subs.create({name: `${modelName} · ${week}`, week, model: [modelId], paidSubs: value});
      setSubDraft(d => { const n = {...d}; delete n[modelId]; return n; });
      toast.success(`Paid subs saved for ${modelName}`);
    } catch (e: any) { toast.error(e.message); }
  }

  const staffOpts = linkOptions(staff.rows, "name"), modelOpts = linkOptions(models.rows, "model");

  return <div className="space-y-6">
    <PageHeader eyebrow="Operations" title="Conversions" subtitle="Weekly totals per VA, dated to the Monday of the week."
      actions={<WeekStepper label={weekLabel(week)} onPrev={() => setWeek(addDays(week, -7))} onNext={() => setWeek(addDays(week, 7))} nextDisabled={current} badge={current ? <Pill tone="orange">This week</Pill> : undefined}/>}/>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Week total" icon={Hash} value={total.toLocaleString()} delta={prevTotal ? total - prevTotal : null} deltaLabel="vs prior week"/>
      <Stat label="Average per VA" icon={Users} value={reported ? (total / reported).toFixed(1) : "—"} sub={`${reported} of ${rows.length} VAs reported`}/>
      <Stat label="Daily average" icon={CalendarDays} value={(total / 7).toFixed(1)} sub="Week total ÷ 7"/>
      <Stat label="Paid subscribers" icon={Sparkles} value={totalSubs ? totalSubs.toLocaleString() : "—"} sub={totalSubs && total ? `${(totalSubs / total * 100).toFixed(1)}% of conversions` : "Enter per model below"}/>
    </div>

    <div className="grid gap-6 xl:grid-cols-5">
      <Panel className="xl:col-span-3" title="Enter weekly totals" subtitle="Type each VA’s total, then save. Existing numbers are updated in place." flush
        actions={<>
          {changed.length > 0 && <span className="text-[12px] text-muted-foreground">{changed.length} unsaved</span>}
          <Btn size="sm" variant="ghost" onClick={() => setDraft({})} disabled={!changed.length || saving}>Discard</Btn>
          <Btn size="sm" variant="primary" onClick={saveWeek} disabled={!changed.length} loading={saving}><Save/>Save week</Btn>
        </>}>
        <div className="mt-4 border-t">
          {rows.length ? <table className="w-full text-[13px]">
            <tbody className="divide-y">{rows.map(r => {
              const dirty = draft[r.id] !== undefined && draft[r.id] !== "" && Number(draft[r.id]) !== r.saved;
              return <tr key={r.id} className={dirty ? "bg-brand-soft/50" : ""}>
                <td className="py-2 pl-5"><div className="flex items-center gap-2.5"><Avatar name={r.name}/><span className="font-medium">{r.name}</span></div></td>
                <td className="hidden py-2 text-muted-foreground sm:table-cell">{r.model || "No model"}</td>
                <td className="py-2 pr-5 text-right">
                  <input type="number" min={0} inputMode="numeric" placeholder="—" aria-label={`Conversions for ${r.name}`} disabled={r.entries.length > 1}
                    className={inputClass + " num ml-auto w-24 text-right " + (dirty ? "border-brand" : "")}
                    value={draft[r.id] ?? (r.saved ?? "")} onChange={e => setDraft(d => ({...d, [r.id]: e.target.value}))}
                    onKeyDown={e => e.key === "Enter" && changed.length && saveWeek()}/>
                </td>
              </tr>;
            })}</tbody>
            <tfoot><tr className="border-t bg-muted/40"><td className="py-3 pl-5 font-semibold" colSpan={2}>Total</td><td className="num py-3 pr-5 text-right text-[15px] font-semibold">{total.toLocaleString()}</td></tr></tfoot>
          </table> : <div className="p-5"><Empty icon={Users} title="No active staff">Add staff on the Staff page.</Empty></div>}
        </div>
      </Panel>

      <Panel className="xl:col-span-2" title="Paid subscribers" subtitle="New paid subs per model this week. Each VA’s share is estimated in proportion to their conversions.">
        {liveModels.length ? <div className="space-y-5">{liveModels.map(m => {
          const name = label(m.fields.model), rec = subsFor(m.id), saved = rec ? num(rec.fields.paidSubs) : null;
          const vas = rows.filter(r => r.modelId === m.id && (valueOf(r) ?? 0) > 0);
          const modelTotal = vas.reduce((s, r) => s + (valueOf(r) ?? 0), 0);
          const val = subDraft[m.id] ?? (saved ?? "");
          return <div key={m.id}>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13px] font-medium">{name}</span>
              <input type="number" min={0} placeholder="—" aria-label={`Paid subscribers for ${name}`} className={inputClass + " num w-24 text-right"} value={val} onChange={e => setSubDraft(d => ({...d, [m.id]: e.target.value}))}/>
              <Btn size="sm" onClick={() => saveSubs(m.id, name)} disabled={subDraft[m.id] === undefined || subDraft[m.id] === "" || Number(subDraft[m.id]) === saved}>Save</Btn>
            </div>
            {saved !== null && modelTotal > 0 && <ul className="mt-2.5 space-y-1.5 border-l-2 pl-3">{vas.map(r => <li key={r.id} className="flex justify-between text-[12.5px] text-muted-foreground">
              <span>{r.name}</span><span className="num">≈ {(saved * (valueOf(r) ?? 0) / modelTotal).toFixed(1)} subs</span>
            </li>)}</ul>}
          </div>;
        })}</div> : <Empty title="No active models"/>}
      </Panel>
    </div>

    <Panel title="Conversion log" subtitle="Every weekly entry. Click a number or note to edit it." flush>
      <DataGrid rows={conv.rows} initialSort={{key: "week", dir: "desc"}}
        columns={[
          {key: "week", label: "Week", icon: CalendarDays, type: "date", render: r => weekLabel(String(r.fields.week).slice(0, 10)), sortValue: r => String(r.fields.week ?? "")},
          {key: "staff", label: "VA", icon: User, type: "link", options: staffOpts, filter: true, render: r => <span className="flex items-center gap-2"><Avatar name={label(r.fields.staff?.[0])} className="size-6 text-[9.5px]"/>{label(r.fields.staff?.[0])}</span>},
          {key: "model", label: "Model", icon: Tag, type: "link", options: modelOpts, filter: true, editable: true},
          {key: "conversions", label: "Conversions", icon: Hash, type: "number", editable: true},
          {key: "notes", label: "Notes", icon: FileText, type: "longtext", editable: true, hideBelow: "lg"},
          {key: "source", label: "Source", type: "text", hideBelow: "xl"},
        ]}
        onUpdate={(id, key, value) => conv.update(id, {[key]: value})}
        onDelete={r => conv.remove(r.id)}
        footer={rs => <><span>{rs.length} entries</span><span className="num font-medium text-foreground">{rs.reduce((s, r) => s + num(r.fields.conversions), 0).toLocaleString()} conversions</span></>}
        searchPlaceholder="Search VA, model, notes"/>
    </Panel>
  </div>;
}
