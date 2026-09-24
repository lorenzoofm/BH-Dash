"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { datasource, useRecords, useRecordCreate, useRecordUpdate, useRecordDelete, q } from "@/lib/datasource";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Pencil, Trash2, RefreshCw, Plus, Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, X, Users, Sparkles, Calendar, CalendarRange, Hash,
  AlignLeft, History, Inbox,
} from "lucide-react";

// ---------- datasources (Airtable — 20MG Operations) ----------
const ds = datasource.define({ staff: "staff", models: "models", conversions: "conversions", paidSubs: "paidSubs" });

const staffSelect = q.select({ name: "Full Name", status: "Status", model: "Model" });
const modelSelect = q.select({ model: "Model" });

// The Conversion Log is WEEKLY: one row per staff member per model per WEEK.
// The primary date field was renamed `Conversion Date` -> `Week Starting` on 5 Sept and always
// holds the MONDAY that starts the week. Softr's q.select maps Airtable by FIELD NAME, so this
// name is the contract — it must match Airtable exactly.
const convSelect = q.select({
  week: "Week Starting",
  staff: "Staff",
  model: "Model",
  conversions: "Conversions",
  notes: "Notes",
  source: "Source",
});

// Only input fields are ever written. Week Start, Conversions This Week, Conversions Last Week and
// Conversions Last 4 Weeks are Airtable FORMULA fields — read-only, and deliberately absent from
// both maps. `Shift` is deliberately absent too: it described a slot inside a single day and is
// meaningless on a weekly row. The field still exists in Airtable; this block simply never writes,
// reads or shows it.
const createFields = q.select({
  week: "Week Starting",
  staff: "Staff",
  model: "Model",
  conversions: "Conversions",
  notes: "Notes",
  source: "Source",
});
const updateFields = q.select({
  model: "Model",
  conversions: "Conversions",
  notes: "Notes",
});

// ---------- helpers ----------
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
// Airtable SELECT fields come back as { id, label } objects, never plain strings.
function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}
// Airtable LINKED_RECORD fields come back as an array of { id, name } (or of bare ids).
function linkIds(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const x of arr) {
    if (x === null || x === undefined) continue;
    if (typeof x === "object") {
      const o = x as { id?: string };
      if (o.id) out.push(String(o.id));
    } else {
      const s = String(x).trim();
      if (s) out.push(s);
    }
  }
  return out;
}
// The display name carried on the link itself, when the datasource sends one. Used only as a
// fallback — the Staff / Models tables are the authority and are looked up by id below. Never
// render the raw object, or the cell reads "[object Object]".
function linkLabels(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const x of arr) {
    if (x === null || x === undefined) continue;
    if (typeof x === "object") {
      const o = x as { name?: string; label?: string; title?: string };
      const s = String(o.name ?? o.label ?? o.title ?? "").trim();
      if (s) out.push(s);
    }
  }
  return out;
}
// Airtable dates arrive ISO (2026-08-31). No slash-date parsing here — that branch belonged to
// the Google Sheet and is gone on purpose.
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function isoDay(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Weeks start MONDAY. This is the one rule the whole page hangs on: every date that reaches
// Airtable is passed through here first, so a mid-week date cannot be stored.
function mondayOf(d: Date) { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const day = (m.getDay() + 6) % 7; m.setDate(m.getDate() - day); return m; }
function sundayOf(monday: Date) { const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()); d.setDate(d.getDate() + 6); return d; }
function addDays(d: Date, n: number) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function thisMonday() { return mondayOf(new Date()); }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "31 Aug – 6 Sep 2026" / "7 – 13 Sep 2026" / "29 Dec 2025 – 4 Jan 2026".
// A week is NEVER rendered as a bare date anywhere on this page: a bare date is exactly what made
// people read a weekly row as a single day.
function fmtWeekRange(monday: Date): string {
  const end = sundayOf(monday);
  const sameYear = monday.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && monday.getMonth() === end.getMonth();
  const start = sameMonth
    ? `${monday.getDate()}`
    : sameYear
      ? `${monday.getDate()} ${MONTHS[monday.getMonth()]}`
      : `${monday.getDate()} ${MONTHS[monday.getMonth()]} ${monday.getFullYear()}`;
  return `${start} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}
// The same shape widened across a MULTI-week window: "17 Aug – 13 Sep 2026". Its end is the SUNDAY
// that closes `toMonday`, never the Monday itself — a window is named by the days it contains.
function fmtWindow(fromMonday: Date, toMonday: Date): string {
  const end = sundayOf(toMonday);
  const sameYear = fromMonday.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && fromMonday.getMonth() === end.getMonth();
  const start = sameMonth
    ? `${fromMonday.getDate()}`
    : sameYear
      ? `${fromMonday.getDate()} ${MONTHS[fromMonday.getMonth()]}`
      : `${fromMonday.getDate()} ${MONTHS[fromMonday.getMonth()]} ${fromMonday.getFullYear()}`;
  return `${start} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}
// "Week of Mon 31 Aug – Sun 6 Sep 2026" — the spelled-out form used in the Add dialog.
function fmtWeekLong(monday: Date): string {
  const end = sundayOf(monday);
  const sameYear = monday.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && monday.getMonth() === end.getMonth();
  const start = sameMonth
    ? `Mon ${monday.getDate()}`
    : sameYear
      ? `Mon ${monday.getDate()} ${MONTHS[monday.getMonth()]}`
      : `Mon ${monday.getDate()} ${MONTHS[monday.getMonth()]} ${monday.getFullYear()}`;
  return `Week of ${start} – Sun ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}
function initialsOf(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0].charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
}
// Status is a SELECT, so it is unwrapped with label() before comparing. Same trimmed / lowercased
// comparison the Staff database and Home blocks use.
function isActiveStatus(v: unknown): boolean {
  return label(v).toLowerCase() === "active";
}
// At most 5 numbered page buttons, long ranges collapsed with an ellipsis
function pageItems(current: number, total: number): Array<number | "gap"> {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, "gap", total];
  if (current >= total - 2) return [1, "gap", total - 2, total - 1, total];
  return [1, "gap", current, "gap", total];
}

const ALL = "__all";
const NONE = "__none";

// ---------- date presets ----------
// ONE date filter for this page, replacing the old Month + Recent pair, which answered the same
// question and cleared each other rather than combining.
// Every row here is a WEEK (one per staff / model / Monday), so there is deliberately NO "Today"
// or "Yesterday": a day preset on weekly rows would return nothing, every time. The Pay & Hours
// page, whose rows are daily, does offer them.
// All boundaries are computed from a LOCAL `new Date()` via mondayOf/addDays, the same frame the
// rows are parsed into. There is no q.date() query anywhere in this block, by design.
type WeekPreset = "this" | "last" | "4" | "8" | "12" | "all";
const WEEK_DEFAULT: WeekPreset = "4";
const WEEK_PRESETS: Array<{ value: WeekPreset; label: string }> = [
  { value: "this", label: "This week" },
  { value: "last", label: "Last week" },
  { value: "4", label: "Last 4 weeks" },
  { value: "8", label: "Last 8 weeks" },
  { value: "12", label: "Last 12 weeks" },
  { value: "all", label: "All weeks" },
];
function weekPresetLabel(p: WeekPreset): string {
  return WEEK_PRESETS.find((x) => x.value === p)?.label ?? "All weeks";
}
// An inclusive window of MONDAYS. A row is in range when its own week-start Monday falls inside
// it. "Last N weeks" means the current week plus the N-1 before it.
function weekPresetRange(p: WeekPreset, now: Date): { fromMonday: Date; toMonday: Date } | null {
  if (p === "all") return null;
  const cur = mondayOf(now);
  if (p === "this") return { fromMonday: cur, toMonday: cur };
  if (p === "last") { const m = addDays(cur, -7); return { fromMonday: m, toMonday: m }; }
  const n = Number(p);
  if (!isFinite(n) || n <= 0) return null;
  return { fromMonday: addDays(cur, -7 * (n - 1)), toMonday: cur };
}
const MAX_AUTO_ROWS = 1000;
const PAGE_SIZES = [15, 25, 50, 100];
const HEAD = "sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap";
const CHIP = "h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium";

type SortKey = "week" | "staff" | "model" | "conversions";
type Row = { id: string; weekDate: Date | null; weekIso: string; staffId: string; staff: string; modelId: string; model: string; conversions: number; notes: string; source: string; dup: boolean };
type EditDraft = { modelId: string; conversions: string; notes: string };
type AddDraft = { staffId: string; week: string; modelId: string; conversions: string; notes: string };
// The draft always carries a MONDAY, never a raw picked day — see setWeekFromAnyDay below.
const emptyAdd = (): AddDraft => ({ staffId: "", week: isoDay(thisMonday()), modelId: "", conversions: "", notes: "" });

const paidFields = q.select({ name: "Name", week: "Week Starting", model: "Model", paid: "Paid Subscribers", notes: "Notes" });

function paidCount(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function paidMonday(value: string): string {
  const d = toDate(value);
  if (!d || isoDay(d) !== value) throw new Error("Choose a valid week.");
  return isoDay(mondayOf(d));
}
function paidMatches(rows: any[], modelId: string, week: string) {
  return rows.filter(r => linkIds(r.fields.model).includes(modelId) && String(r.fields.week ?? "").slice(0, 10) === week);
}
function paidPayload(model: any, week: string, value: string, notes: string) {
  if (!model) throw new Error("Choose a model.");
  const paid = paidCount(value);
  if (value.trim() !== "" && paid === null) throw new Error("Paid subscribers must be a whole number of zero or more.");
  if (notes.length > 2000) throw new Error("Keep notes within 2,000 characters.");
  return { name: model.name + " · " + paidMonday(week), week: paidMonday(week), model: [model.id], paid, notes: notes.trim() || null };
}
function paidResults(items: any[], staff: any[], modelId: string, week: string, paid: number | null) {
  const matching = items.filter(r => {
    const d = toDate(r.fields.week);
    return d && isoDay(mondayOf(d)) === week && linkIds(r.fields.model).includes(modelId);
  });
  const people = new Map<string, { id: string; name: string; conversions: number | null; rows: number }>();
  for (const s of staff) if (s.active && s.modelId === modelId) people.set(s.id, { id: s.id, name: s.name, conversions: null, rows: 0 });
  let invalid = false, duplicate = false;
  for (const row of matching) {
    const ids = linkIds(row.fields.staff), count = paidCount(row.fields.conversions);
    if (ids.length !== 1 || linkIds(row.fields.model).length !== 1) { invalid = true; continue; }
    const id = ids[0], person = people.get(id) ?? { id, name: staff.find(s => s.id === id)?.name || linkLabels(row.fields.staff)[0] || "Unlinked VA", conversions: null, rows: 0 };
    person.rows += 1;
    if (person.rows > 1) duplicate = true;
    if (count === null) invalid = true;
    person.conversions = count === null ? null : (person.conversions ?? 0) + count;
    people.set(id, person);
  }
  const rows = [...people.values()];
  const total = matching.length && !invalid && !duplicate ? rows.reduce((n, r) => n + (r.conversions ?? 0), 0) : null;
  const canEstimate = total !== null && total > 0 && paid !== null;
  return {
    total, invalid, duplicate, reported: rows.filter(r => r.rows > 0 && r.conversions !== null).length,
    unreported: rows.filter(r => r.rows === 0).length,
    ratio: canEstimate ? paid! / total! * 100 : null,
    rows: rows.map(r => {
      const share = total !== null && total > 0 && r.conversions !== null ? r.conversions / total : null;
      const estimate = canEstimate && share !== null ? paid! * share : null;
      return { ...r, share, estimate, daily: estimate === null ? null : estimate / 7 };
    }).sort((a, b) => (b.conversions ?? -1) - (a.conversions ?? -1) || a.name.localeCompare(b.name)),
  };
}

function PaidSubscribers({ models, staff, items, sourceReady, sourceError, refreshSource }: any) {
  const query = useRecords({ from: ds.paidSubs, select: paidFields, count: 100, orderBy: q.desc("week") });
  const createPaid = useRecordCreate({ from: ds.paidSubs, fields: paidFields });
  const updatePaid = useRecordUpdate({ from: ds.paidSubs, fields: paidFields });
  const entries = query.data?.pages.flatMap((p: any) => p.items) ?? [];
  useEffect(() => { if (query.hasNextPage && !query.isFetching && query.status !== "error") query.fetchNextPage(); }, [query.hasNextPage, query.isFetching, query.status, query.data]);
  const [modelId, setModelId] = useState("");
  const [week, setWeek] = useState(isoDay(addDays(thisMonday(), -7)));
  const [value, setValue] = useState(""), [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const ready = sourceReady && query.status === "success" && !query.hasNextPage && !query.isFetching;
  const matching = modelId ? paidMatches(entries, modelId, week) : [];
  const entry = matching.length === 1 ? matching[0] : null;
  const stored = entry?.fields.paid;
  const storedNotes = String(entry?.fields.notes ?? "");
  useEffect(() => { if (!dirty) { setValue(stored == null ? "" : String(stored)); setNotes(storedNotes); } }, [modelId, week, stored, storedNotes, dirty]);
  useEffect(() => {
    if (dirty || busy) return;
    const timer = setInterval(() => { query.refetch(); refreshSource(); }, 60000);
    return () => clearInterval(timer);
  }, [dirty, busy, query.refetch, refreshSource]);
  const paid = matching.length > 1 ? null : paidCount(stored);
  const result = paidResults(items, staff, modelId, week, paid);
  const show = (n: number | null, digits = 2) => n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });
  const selectedModel = models.find((m: any) => m.id === modelId);
  const current = week === isoDay(thisMonday());
  const canSave = entry ? updatePaid.enabled : createPaid.enabled;
  const chooseWeek = (raw: string) => {
    try { setWeek(paidMonday(raw)); setDirty(false); setError(""); } catch { setError("Choose a valid week."); }
  };
  const save = async (event: any) => {
    event.preventDefault(); if (lock.current) return;
    setError("");
    if (!ready) { setError("Wait for all records to load, then retry."); return; }
    if (!canSave) { setError("You do not have permission to save this entry."); return; }
    lock.current = true; setBusy(true);
    try {
      const fields = paidPayload(selectedModel, week, value, notes);
      // ponytail: a fresh check prevents ordinary duplicates; simultaneous editors require a backend unique constraint for a strict guarantee.
      const fresh = await query.refetch();
      if (fresh.isError || fresh.error || !fresh.data) throw new Error("Could not check existing entries. Your changes have not been saved.");
      const existing = paidMatches(fresh.data.pages.flatMap((p: any) => p.items), modelId, week);
      if (existing.length > 1) throw new Error("Multiple paid-sub entries exist for this model and week. Resolve them before saving.");
      if ((existing[0]?.id ?? null) !== (entry?.id ?? null) || String(existing[0]?.fields.paid ?? "") !== String(stored ?? "") || String(existing[0]?.fields.notes ?? "") !== storedNotes) throw new Error("This entry changed while you were editing. Refresh and check the latest value before saving.");
      if (existing.length) await updatePaid.mutateAsync({ recordId: existing[0].id, fields });
      else {
        if (fields.paid === null) throw new Error("Enter the weekly paid subscriber count. Use zero if there were none.");
        await createPaid.mutateAsync(fields);
      }
      await query.refetch(); setDirty(false); toast.success("Weekly paid subscribers saved.");
    } catch (e: any) { setError(e.message || "Could not save. Your entries are still here."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Card className="w-full rounded-xl border bg-card shadow-sm"><CardContent className="space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Weekly paid subscribers</h2><p className="mt-1 text-sm text-muted-foreground">Enter new paid subs for a model each week, then estimate each VA's contribution.</p></div><Button variant="outline" size="sm" disabled={busy || dirty} onClick={() => { query.refetch(); refreshSource(); }}>Refresh paid subs</Button></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">Model<select aria-label="Paid subs model" className="h-10 min-w-44 rounded-md border bg-background px-3" value={modelId} disabled={busy || dirty} onChange={e => { setModelId(e.target.value); setError(""); }}><option value="">Choose a model</option>{models.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Week<Input type="date" aria-label="Paid subs week" value={week} disabled={busy || dirty} onChange={e => chooseWeek(e.target.value)} /></label>
      <Button variant="outline" disabled={busy || dirty} onClick={() => chooseWeek(isoDay(addDays(thisMonday(), -7)))}>Last complete week</Button>
      <span className="pb-2 text-sm text-muted-foreground">{fmtWeekRange(toDate(week)!)}{current ? " · in progress" : week > isoDay(thisMonday()) ? " · future week" : ""}</span>
    </div>
    <p className="text-xs text-muted-foreground">Use new paid subscribers from this VA traffic for the selected week, excluding renewals and unrelated sources. Estimates allocate paid subs in proportion to each VA's logged conversions; they do not identify which VA brought an individual subscriber.</p>
    {sourceError || query.status === "error" ? <p role="alert" className="text-sm text-destructive">Could not load conversion or paid-subscriber data. Refresh to retry.</p> : !ready ? <p role="status" className="text-sm text-muted-foreground">Loading weekly records…</p> : !modelId ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Choose a model to enter the weekly paid subscriber count and see its VAs.</p> : <>
      {matching.length > 1 && <p role="alert" className="text-sm text-destructive">Multiple paid-sub entries exist for this model and week. Estimates are paused until those entries are resolved.</p>}
      <form className="space-y-3 rounded-lg border bg-muted/20 p-4" onSubmit={save}>
        <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">New paid subscribers for the week<Input aria-label="Weekly paid subscriber count" className="max-w-64" type="number" min={0} step={1} value={value} placeholder="Not reported" disabled={busy || !canSave || matching.length > 1} onChange={e => { setValue(e.target.value); setDirty(true); }} /></label><label className="grid min-w-48 flex-1 gap-1 text-sm">Notes<Input aria-label="Paid subscriber notes" value={notes} maxLength={2000} placeholder="Optional source or context" disabled={busy || !canSave || matching.length > 1} onChange={e => { setNotes(e.target.value); setDirty(true); }} /></label><Button type="submit" disabled={!dirty || busy || !canSave || matching.length > 1}>{busy ? "Saving…" : "Save paid subscribers"}</Button>{dirty && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setDirty(false); setError(""); }}>Discard changes</Button>}</div>
        <p className="text-xs text-muted-foreground">{dirty ? "Unsaved changes. Estimates below use the last saved count." : paid === null ? "Not reported yet. Enter zero only when the confirmed weekly count is zero." : `Saved: ${paid} new paid subscribers. Editing this value replaces the weekly total.`}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
      <div className="grid gap-3 sm:grid-cols-3">{[["Logged weekly conversions", show(result.total, 0)], ["New paid subscribers", show(paid, 0)], ["Paid subs ÷ logged conversions", result.ratio === null ? "—" : show(result.ratio) + "%"]].map(([title, val]) => <div key={title} className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">{title}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{val}</div></div>)}</div>
      <p className="text-xs text-muted-foreground">{result.reported} VAs have conversion entries for this model/week.{result.unreported > 0 ? ` ${result.unreported} currently assigned VAs have no entry. Estimates use reported conversions only and may change when missing totals are added.` : ""} The same estimated paid-sub rate is applied to every VA; this cannot measure individual lead quality.</p>
      {(result.invalid || result.duplicate) && <p role="alert" className="text-sm text-destructive">{result.duplicate ? "Duplicate VA/model/week conversion rows found." : "A conversion count or staff/model link is missing or invalid."} Correct the conversion log before calculating estimates.</p>}
      {paid !== null && result.total === 0 && <p className="text-sm text-muted-foreground">There are zero logged conversions, so paid subs cannot be allocated to VAs.</p>}
      {paid !== null && result.total !== null && paid > result.total && <p className="text-sm text-amber-700">Paid subs exceed logged conversions. Check missing entries, traffic sources and reporting dates; the same-week ratio may include subscribers who converted earlier.</p>}
      <div className="overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr>{["VA", "Weekly conversions", "Avg conversions/day", "Share of conversions", "Est. paid subs/week", "Est. paid subs/day"].map(title => <th key={title} className="whitespace-nowrap border-b bg-muted/40 px-3 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{result.rows.map(r => <tr key={r.id}><td className="border-b px-3 py-3 font-medium">{r.name}</td><td className="border-b px-3 py-3 tabular-nums">{show(r.conversions, 0)}{!r.rows && <div className="text-xs text-muted-foreground">Not reported</div>}</td><td className="border-b px-3 py-3 tabular-nums">{show(r.conversions === null ? null : r.conversions / 7)}</td><td className="border-b px-3 py-3 tabular-nums">{r.share === null ? "—" : show(r.share * 100) + "%"}</td><td className="border-b px-3 py-3 tabular-nums">{show(r.estimate)}</td><td className="border-b px-3 py-3 tabular-nums">{show(r.daily)}</td></tr>)}{!result.rows.length && <tr><td colSpan={6} className="p-4 text-muted-foreground">No assigned VAs or conversion entries for this model.</td></tr>}</tbody></table></div>
      <p className="text-xs text-muted-foreground">Estimated paid subs/week = model paid subs × VA conversions ÷ model logged conversions. Per-day figures divide the weekly figure by seven calendar days. Weekly subscriber totals stay exact; VA allocations may be fractional estimates.</p>
    </>}
  </CardContent></Card>;
}

// ---------- block ----------
export default function Block() {
  const [staffFilter, setStaffFilter] = useState(ALL);
  const [modelFilter, setModelFilter] = useState(ALL);
  // ONE date filter. Weekly data reads best as "the recent weeks", so Last 4 weeks is the default
  // view — and the chip always says so, rather than filtering silently.
  const [weekFilter, setWeekFilter] = useState<WeekPreset>(WEEK_DEFAULT);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ modelId: "", conversions: "", notes: "" });
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(emptyAdd());
  const [dupConfirm, setDupConfirm] = useState(false);

  // ===== Staff — fetched WITHOUT a server-side status filter and auto-paged past the 100-row page
  // limit. Status is a SELECT now, so it is unwrapped and matched client-side. =====
  const staffQ = useRecords({ from: ds.staff, select: staffSelect, count: 100, orderBy: q.asc("name") });
  useEffect(() => {
    if (staffQ.hasNextPage && !staffQ.isFetching) staffQ.fetchNextPage();
  }, [staffQ.hasNextPage, staffQ.isFetching, staffQ.data]);
  // Keyed by RECORD ID — Conversion Log.Staff is a link, so identity is the record, not the name.
  const staffRows = useMemo(() => {
    const out: Array<{ id: string; name: string; active: boolean; modelId: string }> = [];
    const seen = new Set<string>();
    for (const r of (staffQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[]) {
      const n = String(r.fields.name ?? "").trim();
      if (!n || seen.has(r.id)) continue;
      seen.add(r.id);
      // Staff.Model is a link too — take the linked model's RECORD ID straight off the staff record.
      out.push({ id: r.id, name: n, active: isActiveStatus(r.fields.status), modelId: linkIds(r.fields.model)[0] ?? "" });
    }
    return out.sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
  }, [staffQ.data]);
  const staffName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffRows) m.set(s.id, s.name);
    return m;
  }, [staffRows]);
  const staffByName = useMemo(() => staffRows.slice().sort((a, b) => a.name.localeCompare(b.name)), [staffRows]);
  // Staff record id -> default model record id (used to pre-fill the Add dialog)
  const staffModel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffRows) if (!m.has(s.id)) m.set(s.id, s.modelId);
    return m;
  }, [staffRows]);

  // Models list — the ONLY source of model identity for every picker on this block.
  const modelsQ = useRecords({ from: ds.models, select: modelSelect, count: 100, orderBy: q.asc("model") });
  useEffect(() => {
    if (modelsQ.hasNextPage && !modelsQ.isFetching) modelsQ.fetchNextPage();
  }, [modelsQ.hasNextPage, modelsQ.isFetching, modelsQ.data]);
  const models = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    for (const r of (modelsQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[]) {
      const name = String(r.fields.model ?? "").trim();
      if (!name || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [modelsQ.data]);
  const modelName = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of models) m.set(x.id, x.name);
    return m;
  }, [models]);

  // ===== The Conversion Log — one unfiltered, auto-paged query. It is deliberately NOT narrowed
  // server-side: an earlier build asked Airtable for a single day with q.date("week").is(...), a
  // query that was never verified against an Airtable DATE field. Its failure mode (an empty result
  // set) looks exactly like "nothing logged", which would silently disarm the duplicate guard below.
  // Filtering the already-fetched rows client-side cannot fail that way. There is no q.date() call
  // anywhere in this block, and there must not be one. =====
  const convQ = useRecords({
    from: ds.conversions,
    select: convSelect,
    count: 100,
    orderBy: q.desc("week"),
  });
  const loadedCount = convQ.data?.pages.reduce((n: number, p: any) => n + p.items.length, 0) ?? 0;
  // Auto-page up to MAX_AUTO_ROWS so the filters, totals and the duplicate guard cover enough history
  useEffect(() => {
    if (convQ.hasNextPage && !convQ.isFetching && loadedCount < MAX_AUTO_ROWS) convQ.fetchNextPage();
  }, [convQ.hasNextPage, convQ.isFetching, loadedCount]);
  // True only when every row in the table has actually been loaded. The duplicate guard is
  // authoritative only then; short of that it says so rather than guessing.
  const convFullyLoaded = convQ.status === "success" && !convQ.hasNextPage;

  const convItems = useMemo(
    () => (convQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[],
    [convQ.data]
  );

  // ----- decorate every fetched row once -----
  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = convItems.map((r: any) => {
      const raw = toDate(r.fields.week);
      // Normalised to the Monday on the way in as well as on the way out. New rows are already
      // Mondays; any legacy mid-week row still lands in the right week rather than in a week of
      // its own, which is what keeps the duplicate guard honest during the changeover.
      const wk = raw ? mondayOf(raw) : null;
      const staffId = linkIds(r.fields.staff)[0] ?? "";
      const modelId = linkIds(r.fields.model)[0] ?? "";
      return {
        id: r.id,
        weekDate: wk,
        weekIso: wk ? isoDay(wk) : "",
        staffId,
        // Resolved from the Staff table by id; the link's own name is only a fallback.
        staff: staffName.get(staffId) ?? linkLabels(r.fields.staff)[0] ?? "",
        modelId,
        // Resolved from the Models table by id; the link's own name is only a fallback.
        model: modelName.get(modelId) ?? linkLabels(r.fields.model)[0] ?? "",
        conversions: num(r.fields.conversions),
        notes: String(r.fields.notes ?? ""),
        source: String(r.fields.source ?? "").trim(),
        dup: false,
      };
    });
    // Flag duplicates: same staff + model + WEEK
    const counts = new Map<string, number>();
    for (const r of rows) { const k = `${r.staffId}|${r.modelId}|${r.weekIso}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const r of rows) r.dup = (counts.get(`${r.staffId}|${r.modelId}|${r.weekIso}`) ?? 0) > 1;
    rows.sort((a, b) => (b.weekDate?.getTime() ?? 0) - (a.weekDate?.getTime() ?? 0));
    return rows;
  }, [convItems, staffName, modelName]);

  // The query is unfiltered, so it answers "is the table itself empty?" directly.
  const tableEmpty = convQ.status === "success" && allRows.length === 0;

  // Resolved once per preset change, not per render, so it is a stable dependency below.
  const weekRange = useMemo(() => {
    const r = weekPresetRange(weekFilter, new Date());
    return r ? { fromMonday: r.fromMonday, toMonday: r.toMonday, fromIso: isoDay(r.fromMonday), toIso: isoDay(r.toMonday) } : null;
  }, [weekFilter]);
  const weekLabel = weekPresetLabel(weekFilter);
  const weekWindow = weekRange ? `${weekLabel} (${fmtWindow(weekRange.fromMonday, weekRange.toMonday)})` : weekLabel;

  // Filtered set (staff / model / date window / search) — everything below the table reports on
  // THIS set, not the page
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (staffFilter !== ALL && r.staffId !== staffFilter) return false;
      if (modelFilter !== ALL && r.modelId !== modelFilter) return false;
      // Compared as ISO Monday strings, which sort lexicographically. A row with no readable week
      // is excluded from every window except All weeks.
      if (weekRange) {
        if (!r.weekIso) return false;
        if (r.weekIso < weekRange.fromIso || r.weekIso > weekRange.toIso) return false;
      }
      if (term) {
        const hay = `${r.staff} ${r.model} ${r.notes}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allRows, staffFilter, modelFilter, weekRange, search]);

  // Sorting on parsed values (weeks via toDate/mondayOf, numbers via num)
  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const out = rows.slice();
    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "week") cmp = (a.weekDate?.getTime() ?? 0) - (b.weekDate?.getTime() ?? 0);
      else if (sortKey === "conversions") cmp = a.conversions - b.conversions;
      else if (sortKey === "staff") cmp = a.staff.localeCompare(b.staff);
      else cmp = a.model.localeCompare(b.model);
      if (cmp === 0) cmp = (a.weekDate?.getTime() ?? 0) - (b.weekDate?.getTime() ?? 0);
      return cmp * dir;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  // Pagination over the filtered / sorted set
  const totalRows = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  useEffect(() => { setPage(1); }, [staffFilter, modelFilter, weekFilter, search, pageSize]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const safePage = Math.min(page, pageCount);
  const startIdx = (safePage - 1) * pageSize;
  const pageRows = useMemo(() => sortedRows.slice(startIdx, startIdx + pageSize), [sortedRows, startIdx, pageSize]);
  const showFrom = totalRows === 0 ? 0 : startIdx + 1;
  const showTo = Math.min(startIdx + pageSize, totalRows);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "week" || key === "conversions" ? "desc" : "asc"); }
  };
  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col ? null : sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;

  // "Active" means "not the default view" — Reset returns to the DEFAULT preset, not to All weeks.
  const filtersActive = staffFilter !== ALL || modelFilter !== ALL || weekFilter !== WEEK_DEFAULT || search.trim() !== "";
  const resetFilters = () => { setStaffFilter(ALL); setModelFilter(ALL); setWeekFilter(WEEK_DEFAULT); setSearch(""); };

  // An empty table has to name the filter responsible for it, so nobody reads a narrow window as
  // "nothing was ever logged".
  const emptyReason = useMemo(() => {
    // An empty TABLE is not the filter's fault, so it never says it is — but it still names the
    // window on screen, so "nothing here" is never mistaken for "this preset is broken".
    if (allRows.length === 0) {
      return weekFilter === "all"
        ? "No weeks logged yet — add the first one."
        : `No weeks logged yet — the whole conversion log is empty, so ${weekLabel} shows nothing either.`;
    }
    const bits: string[] = [];
    if (weekFilter !== "all") bits.push(weekLabel);
    if (staffFilter !== ALL) bits.push(staffName.get(staffFilter) ?? "that staff member");
    if (modelFilter !== ALL) bits.push(modelName.get(modelFilter) ?? "that model");
    if (search.trim() !== "") bits.push(`“${search.trim()}”`);
    if (bits.length === 0) return "No weeks to show.";
    return `No rows for ${bits.join(" · ")} — try a wider range.`;
  }, [allRows.length, weekFilter, weekLabel, staffFilter, modelFilter, search, staffName, modelName]);

  // Which NON-date filters are narrowing the totals — spelled out rather than a bare "(filtered)".
  const narrowedBy = useMemo(() => {
    const bits: string[] = [];
    if (staffFilter !== ALL) bits.push(staffName.get(staffFilter) ?? "staff");
    if (modelFilter !== ALL) bits.push(modelName.get(modelFilter) ?? "model");
    if (search.trim() !== "") bits.push(`search “${search.trim()}”`);
    return bits;
  }, [staffFilter, modelFilter, search, staffName, modelName]);

  // Totals — the whole FILTERED set, not just the visible page
  const total = rows.reduce((n, r) => n + r.conversions, 0);
  const perModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.model || "—", (m.get(r.model || "—") ?? 0) + r.conversions);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // ===== Mutations =====
  const create = useRecordCreate({ from: ds.conversions, fields: createFields, onError: (e) => toast.error(e.message) });
  const update = useRecordUpdate({ from: ds.conversions, fields: updateFields, onError: (e) => toast.error(e.message) });
  const remove = useRecordDelete({ from: ds.conversions, onError: (e) => toast.error(e.message) });

  // ---- Add weekly conversions — the only write path that creates rows ----
  const openAdd = () => { setAddDraft(emptyAdd()); setAdding(true); };

  // The week picker. Whatever day the user picks, only its MONDAY is ever stored in the draft, so
  // there is no code path from this dialog that could write a mid-week date. An unparseable or
  // half-typed value leaves the previous Monday in place rather than clearing the field, so the
  // draft is never blank either.
  const setWeekFromAnyDay = (raw: string) => {
    const d = toDate(raw);
    if (!d) return;
    setAddDraft((x) => ({ ...x, week: isoDay(mondayOf(d)) }));
  };
  const shiftWeek = (weeks: number) => {
    setAddDraft((x) => {
      const base = toDate(x.week) ?? thisMonday();
      return { ...x, week: isoDay(addDays(mondayOf(base), 7 * weeks)) };
    });
  };
  const addWeekMonday = useMemo(() => {
    const d = toDate(addDraft.week);
    return d ? mondayOf(d) : null;
  }, [addDraft.week]);
  const addWeekIso = addWeekMonday ? isoDay(addWeekMonday) : "";
  const isCurrentWeek = addWeekIso === isoDay(thisMonday());

  // Duplicate guard for the Add dialog — staff + model + WEEK. It filters the rows this block has
  // already fetched; it does NOT ask Airtable for the week with q.date(), a query never verified
  // against an Airtable DATE field whose failure mode (an empty result set) looks exactly like
  // "no duplicate" and would silently disarm the guard. When not every row has been loaded it says
  // so and forces a confirm, rather than reporting a clean bill of health it cannot back up.
  const dupStaffId = addDraft.staffId;
  const dupModelId = addDraft.modelId;
  const dupReady = adding && dupStaffId !== "" && dupModelId !== "" && addWeekIso !== "";
  const dupMatches = useMemo(() => {
    if (!dupReady) return [] as Row[];
    return allRows.filter((r) => r.weekIso === addWeekIso && r.staffId === dupStaffId && r.modelId === dupModelId);
  }, [allRows, dupReady, addWeekIso, dupStaffId, dupModelId]);
  const addDupExists = dupReady && dupMatches.length > 0;
  const addDupChecking = dupReady && (convQ.status === "pending" || convQ.isFetching);
  // Unknown when the fetch failed, or when a match was NOT found but not every row was loaded.
  const addDupUnknown = dupReady && !addDupChecking && !addDupExists && (convQ.status === "error" || !convFullyLoaded);
  const addStaffLabel = staffName.get(addDraft.staffId) ?? "";
  const addModelLabel = modelName.get(addDraft.modelId) ?? "";
  const addWeekLabel = addWeekMonday ? fmtWeekRange(addWeekMonday) : "";
  const addProblem = (): string | null => {
    if (!addDraft.staffId) return "Pick a staff member before saving.";
    if (!addDraft.modelId) return "Pick a model before saving.";
    if (!addWeekMonday) return "Pick a week before saving.";
    if (num(addDraft.conversions) <= 0) return "Conversions must be greater than zero.";
    return null;
  };
  const doCreate = async () => {
    if (!create.enabled) { toast.error("You don't have permission to add records."); return; }
    const monday = addWeekMonday;
    if (!monday) { toast.error("Pick a week before saving."); return; }
    // Snapped a second time on the way out. Belt and braces: the only value that can reach
    // `Week Starting` is a Monday.
    const weekIso = isoDay(mondayOf(monday));
    setBusy(true);
    try {
      await create.mutateAsync({
        week: weekIso,
        // Link fields are written as an ARRAY OF RECORD IDS, never a bare name.
        staff: [addDraft.staffId],
        model: [addDraft.modelId],
        conversions: num(addDraft.conversions),
        // Airtable rejects "" on a typed field, so blank clears it with null.
        notes: addDraft.notes.trim() || null,
        source: "Manual",
      });
      await convQ.refetch();
      toast.success(`Added ${addStaffLabel} · ${addModelLabel} · ${fmtWeekRange(monday)}`);
      setDupConfirm(false);
      setAdding(false);
      setAddDraft(emptyAdd());
    } catch (e: any) {
      toast.error(e?.message ?? "Add failed");
    } finally {
      setBusy(false);
    }
  };
  const submitAdd = () => {
    const problem = addProblem();
    if (problem) { toast.error(problem); return; }
    if (addDupChecking) { toast.error("Still checking whether this week is already logged — try again in a moment."); return; }
    // Confirm when a matching row exists, and also when the check itself could not be completed —
    // never write blind.
    if (addDupExists || addDupUnknown) { setDupConfirm(true); return; }
    doCreate();
  };

  const openEdit = (r: Row) => {
    setDraft({ modelId: r.modelId, conversions: r.conversions ? String(r.conversions) : "", notes: r.notes });
    setEditing(r);
  };
  const saveEdit = async () => {
    if (!editing || !update.enabled) return;
    setBusy(true);
    try {
      await update.mutateAsync({
        recordId: editing.id,
        fields: {
          model: draft.modelId ? [draft.modelId] : [],
          conversions: num(draft.conversions),
          notes: draft.notes.trim() || null,
        },
      });
      await convQ.refetch();
      toast.success(`Updated ${editing.staff} · ${editing.weekDate ? fmtWeekRange(editing.weekDate) : ""}`);
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleting || !remove.enabled) return;
    setBusy(true);
    try {
      await remove.mutateAsync(deleting.id);
      await convQ.refetch();
      toast.success(`Deleted ${deleting.staff} · ${deleting.weekDate ? fmtWeekRange(deleting.weekDate) : ""}`);
      setDeleting(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const loading = convQ.status === "pending";
  const canAct = update.enabled || remove.enabled;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full space-y-4">
        <PaidSubscribers models={models} staff={staffRows} items={convItems} sourceReady={convFullyLoaded && !convQ.isFetching && staffQ.status === "success" && !staffQ.hasNextPage && modelsQ.status === "success" && !modelsQ.hasNextPage} sourceError={[convQ, staffQ, modelsQ].some(q => q.status === "error")} refreshSource={convQ.refetch} />
        <Card className="w-full overflow-hidden rounded-xl border bg-card shadow-sm">

          {/* ================= Card header ================= */}
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Weekly conversion log</h2>
                <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">{allRows.length}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                One row per staff member, model and <span className="font-medium text-foreground">week</span> — weeks run Monday to Sunday. Add a week with the button, then filter, search, sort, edit or delete inline.
              </p>
            </div>
            {create.enabled && (
              <Button size="sm" onClick={openAdd} className="h-8 shrink-0 gap-1.5"><Plus className="h-4 w-4" /> Add conversion</Button>
            )}
          </div>

          <CardContent className="p-0">

            {/* ---- Toolbar: filter chips left, search + refresh right ---- */}
            <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5">
              <Select value={staffFilter} onValueChange={setStaffFilter}>
                <SelectTrigger className={CHIP}>
                  <Users className="h-3.5 w-3.5 opacity-60" />
                  <span>Staff</span>
                  {staffFilter !== ALL && <span className="font-semibold text-foreground">{staffName.get(staffFilter) ?? ""}</span>}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All staff</SelectItem>
                  {staffByName.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className={CHIP}>
                  <Sparkles className="h-3.5 w-3.5 opacity-60" />
                  <span>Model</span>
                  {modelFilter !== ALL && <span className="font-semibold text-foreground">{modelName.get(modelFilter) ?? ""}</span>}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All models</SelectItem>
                  {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* ONE date chip, replacing the old Month + Recent pair. It always shows the window it
                  is on, so the table is never quietly filtered. No day presets: every row is a week. */}
              <Select value={weekFilter} onValueChange={(v) => setWeekFilter(v as WeekPreset)}>
                <SelectTrigger className={CHIP}>
                  <CalendarRange className="h-3.5 w-3.5 opacity-60" />
                  <span>Date:</span>
                  <span className="font-semibold text-foreground">{weekLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  {WEEK_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>

              {filtersActive && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={resetFilters}>
                  <X className="h-3.5 w-3.5" /> Reset
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search staff, model, notes"
                    className="h-8 w-[200px] pl-8 text-sm lg:w-[260px]"
                  />
                </div>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => convQ.refetch()} disabled={convQ.isFetching}>
                  <RefreshCw className={`h-3.5 w-3.5 ${convQ.isFetching ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
            </div>

            {/* ---- The table ---- */}
            <div className="relative w-full overflow-auto border-t max-h-[70vh]">
              {loading ? (
                <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
              ) : convQ.status === "error" ? (
                <div className="py-16 text-center text-sm text-destructive">Could not load the conversion log.</div>
              ) : totalRows === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <Inbox className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">{emptyReason}</p>
                  {!tableEmpty && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {filtersActive && (
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={resetFilters}>
                          <X className="h-3.5 w-3.5" /> Reset to {weekPresetLabel(WEEK_DEFAULT)}
                        </Button>
                      )}
                      {weekFilter !== "all" && (
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setWeekFilter("all")}>
                          <CalendarRange className="h-3.5 w-3.5" /> Show all weeks
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={HEAD}>
                        <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => toggleSort("week")}>
                          <CalendarRange className="h-3 w-3 opacity-60" /> Week <SortIcon col="week" />
                        </button>
                      </TableHead>
                      <TableHead className={HEAD}>
                        <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => toggleSort("staff")}>
                          <Users className="h-3 w-3 opacity-60" /> Staff <SortIcon col="staff" />
                        </button>
                      </TableHead>
                      <TableHead className={HEAD}>
                        <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => toggleSort("model")}>
                          <Sparkles className="h-3 w-3 opacity-60" /> Model <SortIcon col="model" />
                        </button>
                      </TableHead>
                      <TableHead className={`${HEAD} text-right`}>
                        <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => toggleSort("conversions")}>
                          <Hash className="h-3 w-3 opacity-60" /> Conversions <SortIcon col="conversions" />
                        </button>
                      </TableHead>
                      <TableHead className={`${HEAD} min-w-[200px]`}>
                        <span className="inline-flex items-center gap-1.5"><AlignLeft className="h-3 w-3 opacity-60" /> Notes</span>
                      </TableHead>
                      <TableHead className={HEAD}>
                        <span className="inline-flex items-center gap-1.5"><Inbox className="h-3 w-3 opacity-60" /> Source</span>
                      </TableHead>
                      {canAct && <TableHead className={`${HEAD} text-right`}>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r) => (
                      <TableRow key={r.id} className="h-12 border-b transition-colors hover:bg-muted/40">
                        {/* A week, always as a range — never a bare date. */}
                        <TableCell className="whitespace-nowrap px-3 py-2 text-sm tabular-nums">
                          {r.weekDate ? fmtWeekRange(r.weekDate) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm">
                          {r.staff ? (
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initialsOf(r.staff)}</span>
                              <span className="font-medium">{r.staff}</span>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm">
                          {r.model ? <Badge variant="secondary" className="rounded-md font-normal">{r.model}</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            {r.conversions}
                            {r.dup && <Badge variant="destructive" className="rounded-md px-1.5 py-0 text-[10px] font-normal">dup</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate px-3 py-2 text-sm text-muted-foreground" title={r.notes}>
                          {r.notes || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm text-muted-foreground">{r.source || <span className="text-muted-foreground">—</span>}</TableCell>
                        {canAct && (
                          <TableCell className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {update.enabled && (
                                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => openEdit(r)}>
                                  <Pencil className="h-3.5 w-3.5" />Edit
                                </Button>
                              )}
                              {remove.enabled && (
                                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-destructive" onClick={() => setDeleting(r)}>
                                  <Trash2 className="h-3.5 w-3.5" />Delete
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Totals for the whole filtered set */}
            <div className="flex flex-wrap items-center gap-2 border-t px-3 py-3 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{weekWindow}</span> ·{" "}
                <span className="font-medium tabular-nums text-foreground">{rows.length}</span> weekly row{rows.length === 1 ? "" : "s"} ·{" "}
                <span className="font-medium tabular-nums text-foreground">{total}</span> conversions
                {narrowedBy.length > 0 ? ` · also filtered by ${narrowedBy.join(", ")}` : ""}
              </span>
              {perModel.map(([m, n]) => <Badge key={m} variant="outline" className="rounded-md font-normal tabular-nums">{m}: {n}</Badge>)}
              <span className="ml-auto flex items-center gap-2 text-xs">
                <span className="tabular-nums">{loadedCount} row{loadedCount === 1 ? "" : "s"} loaded from Airtable{convQ.hasNextPage ? "" : " (all)"}</span>
                {convQ.hasNextPage && (
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => convQ.fetchNextPage()} disabled={convQ.isFetchingNextPage}>
                    {convQ.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                )}
              </span>
            </div>

            {/* Footer — rows per page, range, pagination */}
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[72px]"><span className="tabular-nums">{pageSize}</span></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground tabular-nums">{showFrom}–{showTo} of {totalRows} rows</span>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={safePage <= 1} aria-label="First page"><ChevronsLeft className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                {pageItems(safePage, pageCount).map((it, i) =>
                  it === "gap" ? (
                    <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                  ) : (
                    <Button
                      key={`p-${it}`}
                      variant={it === safePage ? "default" : "ghost"}
                      className="h-8 w-8 p-0 text-xs tabular-nums"
                      onClick={() => setPage(it as number)}
                    >
                      {it}
                    </Button>
                  )
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage(pageCount)} disabled={safePage >= pageCount} aria-label="Last page"><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit dialog — the week itself is not editable here; delete and re-add to move a row. */}
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o && !busy) setEditing(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit weekly conversions</DialogTitle>
              <DialogDescription>{editing ? `${editing.staff} · ${editing.weekDate ? fmtWeekLong(editing.weekDate) : "no week"}` : ""}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-1">
                <Label>Model</Label>
                <Select value={draft.modelId || NONE} onValueChange={(v) => setDraft((d) => ({ ...d, modelId: v === NONE ? "" : v }))}>
                  <SelectTrigger><span>{modelName.get(draft.modelId) ?? <span className="text-muted-foreground">Pick model</span>}</span></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}><span className="text-muted-foreground">— none —</span></SelectItem>
                    {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Conversions for the week</Label>
                <Input type="number" inputMode="numeric" min={0} step={1} value={draft.conversions} onChange={(e) => setDraft((d) => ({ ...d, conversions: e.target.value }))} className="tabular-nums" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button onClick={saveEdit} disabled={busy || !update.enabled}>{busy ? "Saving…" : "Save changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add dialog — the only path that creates a conversion row. It takes a WEEK, not a day. */}
        <Dialog open={adding} onOpenChange={(o) => { if (!o && !busy) { setAdding(false); setAddDraft(emptyAdd()); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add weekly conversions</DialogTitle>
              <DialogDescription>One row per staff member, model and week. Weeks run Monday to Sunday.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              {/* ---- Week picker ---- */}
              <div className="space-y-1.5">
                <Label>Week <span className="text-destructive">*</span></Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => shiftWeek(-1)} aria-label="Previous week">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input type="date" className="h-9" value={addDraft.week} onChange={(e) => setWeekFromAnyDay(e.target.value)} />
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => shiftWeek(1)} aria-label="Next week">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
                  <span className="text-sm font-medium tabular-nums">
                    {addWeekMonday ? fmtWeekLong(addWeekMonday) : "—"}
                    {isCurrentWeek && <span className="ml-2 text-xs font-normal text-muted-foreground">(this week)</span>}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => setAddDraft((d) => ({ ...d, week: isoDay(thisMonday()) }))} disabled={isCurrentWeek}>
                    This week
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Pick any day and it snaps to that week's Monday — a mid-week date cannot be saved.</p>
              </div>

              <div className="space-y-1">
                <Label>Staff <span className="text-destructive">*</span></Label>
                <Select value={addDraft.staffId || NONE} onValueChange={(v) => { const s = v === NONE ? "" : v; setAddDraft((d) => ({ ...d, staffId: s, modelId: s ? (staffModel.get(s) || d.modelId) : d.modelId })); }}>
                  <SelectTrigger><span>{addStaffLabel || <span className="text-muted-foreground">Pick staff</span>}</span></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}><span className="text-muted-foreground">— pick staff —</span></SelectItem>
                    {staffRows.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.active ? s.name : `${s.name} (inactive)`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Model <span className="text-destructive">*</span></Label>
                <Select value={addDraft.modelId || NONE} onValueChange={(v) => setAddDraft((d) => ({ ...d, modelId: v === NONE ? "" : v }))}>
                  <SelectTrigger><span>{addModelLabel || <span className="text-muted-foreground">Pick model</span>}</span></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}><span className="text-muted-foreground">— pick model —</span></SelectItem>
                    {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">One row per model. Log a second row for the same week if the staff member converted for another model.</p>
              </div>
              <div className="space-y-1">
                <Label>Conversions for the week <span className="text-destructive">*</span></Label>
                <Input type="number" inputMode="numeric" min={0} step={1} placeholder="0" value={addDraft.conversions} onChange={(e) => setAddDraft((d) => ({ ...d, conversions: e.target.value }))} className="tabular-nums" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={addDraft.notes} onChange={(e) => setAddDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Optional" />
              </div>
              {!addProblem() && addDupChecking && (
                <p className="text-xs text-muted-foreground">Checking whether this staff member, model and week is already logged…</p>
              )}
              {!addProblem() && !addDupChecking && addDupExists && (
                <p className="text-xs text-amber-700">A row for {addStaffLabel} · {addModelLabel} · {addWeekLabel} already exists. You'll be asked to confirm.</p>
              )}
              {!addProblem() && !addDupChecking && addDupUnknown && (
                <p className="text-xs text-amber-700">Couldn't check whether this staff member, model and week is already logged — not every row in the log has been loaded. You'll be asked to confirm.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setAdding(false); setAddDraft(emptyAdd()); }} disabled={busy}>Cancel</Button>
              <Button onClick={submitAdd} disabled={busy || !create.enabled}>{busy ? "Adding…" : "Add conversion"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Duplicate confirm — staff + model + week */}
        <AlertDialog open={dupConfirm} onOpenChange={(o) => { if (!o && !busy) setDupConfirm(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{addDupUnknown ? "Couldn't check for an existing row" : "Add a duplicate week?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {addDupUnknown
                  ? `The check for ${addStaffLabel} · ${addModelLabel} · ${addWeekLabel} could not be completed, so it is not known whether that week is already logged. Adding one that exists will double-count.`
                  : `${addStaffLabel} · ${addModelLabel} · ${addWeekLabel} is already logged${dupMatches.length > 1 ? ` (${dupMatches.length} rows)` : ""}. Adding another row will double-count unless you edit or delete the existing one.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); doCreate(); }} disabled={busy}>{busy ? "Adding…" : "Add anyway"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete confirm */}
        <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !busy) setDeleting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this weekly row?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting ? `${deleting.staff} · ${deleting.model || "no model"} · ${deleting.weekDate ? fmtWeekLong(deleting.weekDate) : "no week"} · ${deleting.conversions} conversions. This cannot be undone.` : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={busy || !remove.enabled} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {busy ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
