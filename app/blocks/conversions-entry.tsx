"use client";
import {useEffect, useMemo, useState} from "react";
import {toast} from "sonner";
import {CalendarDays, ChevronLeft, ChevronRight, Save} from "lucide-react";
import {q, useRecordCreate, useRecordUpdate, useRecords} from "@/lib/datasource";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {addDays, isLoading, label, linkIds, mondayOf, num, rowsOf, todayIso, useAllPages, weekLabel} from "@/lib/bh";

const staffSelect = q.select({name: "Full Name", status: "Status", model: "Model"});
const convSelect = q.select({week: "Week Starting", staff: "Staff", model: "Model", conversions: "Conversions"});

// Enter one weekly total per VA. Saving creates the Conversion Log row, or updates the existing one.
export default function ConversionsEntry() {
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => setWeek(mondayOf(todayIso())), []);
  const staff = useRecords({from: "staff", select: staffSelect});
  const conv = useRecords({from: "conversions", select: convSelect});
  useAllPages(staff); useAllPages(conv);
  const create = useRecordCreate({from: "conversions", fields: {week: "Week Starting", staff: "Staff", model: "Model", conversions: "Conversions", source: "Source"}});
  const update = useRecordUpdate({from: "conversions", fields: {conversions: "Conversions"}});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    if (!week) return [];
    const entries = rowsOf(conv).filter(r => String(r.fields.week ?? "").slice(0, 10) === week);
    return rowsOf(staff)
      .filter(s => label(s.fields.status) === "Active" || entries.some(e => linkIds(e.fields.staff).includes(s.id)))
      .map(s => {
        const mine = entries.filter(e => linkIds(e.fields.staff).includes(s.id));
        return {id: s.id, name: label(s.fields.name), modelId: linkIds(s.fields.model)[0] ?? null, model: label(s.fields.model?.[0]),
          entries: mine, saved: mine.length ? mine.reduce((t, e) => t + num(e.fields.conversions), 0) : null};
      }).sort((a, b) => a.name.localeCompare(b.name));
  }, [week, staff.data, conv.data]);

  useEffect(() => setDraft({}), [week]);
  const current = week === mondayOf(todayIso());
  const changed = rows.filter(r => draft[r.id] !== undefined && draft[r.id] !== "" && Number(draft[r.id]) !== r.saved);
  const total = rows.reduce((t, r) => t + (draft[r.id] !== undefined && draft[r.id] !== "" ? Number(draft[r.id]) : r.saved ?? 0), 0);

  async function save() {
    setSaving(true);
    let ok = 0;
    for (const r of changed) {
      const value = Math.round(Number(draft[r.id]));
      try {
        if (r.entries.length === 1) await update.mutateAsync({recordId: r.entries[0].id, fields: {conversions: value}});
        else if (!r.entries.length) {
          if (!r.modelId) throw new Error(`${r.name} has no model assigned on Staff`);
          await create.mutateAsync({week, staff: [r.id], model: [r.modelId], conversions: value, source: "Weekly entry"});
        } else throw new Error(`${r.name} has several entries this week — edit them in the log below`);
        ok++;
      } catch (e: any) { toast.error(e.message); }
    }
    setSaving(false);
    if (ok) { toast.success(`Saved ${ok} ${ok === 1 ? "entry" : "entries"} for ${weekLabel(week!)}`); setDraft({}); }
  }

  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle className="flex items-center gap-2"><CalendarDays className="size-5"/>Weekly conversions</CardTitle>
        <CardDescription className="mt-1">Type each VA’s total for the week and save. The Overview chart updates straight away.</CardDescription>
      </div>
      <div className="flex items-center gap-1 rounded-lg border p-1">
        <Button size="icon" variant="ghost" onClick={() => setWeek(addDays(week!, -7))} aria-label="Previous week"><ChevronLeft/></Button>
        <span className="min-w-40 text-center text-sm font-medium">{week ? weekLabel(week) : "…"}{current && <Badge className="ml-2" variant="secondary">This week</Badge>}</span>
        <Button size="icon" variant="ghost" onClick={() => setWeek(addDays(week!, 7))} disabled={current} aria-label="Next week"><ChevronRight/></Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {isLoading(staff) || isLoading(conv) || !week ? <div className="h-48 animate-pulse rounded-lg bg-muted"/> : <>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2.5 text-left font-medium">VA</th><th className="px-4 py-2.5 text-left font-medium">Model</th><th className="px-4 py-2.5 text-right font-medium">Conversions</th></tr></thead>
            <tbody className="divide-y">{rows.map(r => <tr key={r.id} className={draft[r.id] !== undefined && Number(draft[r.id]) !== r.saved ? "bg-amber-50/60" : ""}>
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.model || "—"}</td>
              <td className="px-4 py-1.5 text-right">
                <input type="number" min={0} inputMode="numeric" placeholder="—" aria-label={`Conversions for ${r.name}`}
                  className="h-9 w-24 rounded-md border bg-background px-2 text-right tabular-nums"
                  disabled={r.entries.length > 1}
                  value={draft[r.id] ?? (r.saved ?? "")} onChange={e => setDraft(d => ({...d, [r.id]: e.target.value}))}/>
              </td>
            </tr>)}</tbody>
            <tfoot className="border-t bg-muted/30"><tr><td className="px-4 py-2.5 font-semibold" colSpan={2}>Week total</td><td className="px-4 py-2.5 text-right text-base font-semibold tabular-nums">{total}</td></tr></tfoot>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3">
          {changed.length > 0 && <span className="text-sm text-muted-foreground">{changed.length} unsaved</span>}
          <Button variant="ghost" onClick={() => setDraft({})} disabled={!changed.length || saving}>Discard</Button>
          <Button onClick={save} disabled={!changed.length || saving}><Save/>{saving ? "Saving…" : "Save week"}</Button>
        </div>
      </>}
    </CardContent>
  </Card>;
}
