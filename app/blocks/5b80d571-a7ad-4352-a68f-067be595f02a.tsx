"use client";
import { useEffect, useMemo, useState } from "react";
import { datasource, useRecords, useRecordCreate, useRecordUpdate, useRecordDelete, q } from "@/lib/datasource";
import { useCurrentUser } from "@/lib/user";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Pencil, Trash2, BadgeDollarSign, Loader2, AlertTriangle, Plus, Search,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, Download,
  Users, Calendar, CircleDot, X, Hash, DollarSign, AlignLeft, User, MoreHorizontal, Inbox,
} from "lucide-react";

// ---------- datasources ----------
const ds = datasource.define({ staff: "staff", paylog: "paylog" });

const staffSelect = q.select({
  staffId: "Staff ID",
  name: "Full Name",
  status: "Status",
  model: "Model",
  rate: "Current Hourly Rate",
  stdHours: "Standard Daily Hours",
  currency: "Currency",
});

const paySelect = q.select({
  workDate: "Work Date",
  staff: "Staff",
  hours: "Hours Worked",
  rate: "Hourly Rate Snapshot",
  basePay: "Base Pay",
  bonus: "Bonus",
  deductions: "Deductions",
  totalPay: "Total Pay",
  period: "Pay Period",
  status: "Payment Status",
  paymentDate: "Payment Date",
  notes: "Notes",
  submittedBy: "Submitted By",
});

// Formula fields (Base Pay, Total Pay, Pay Period) are READ ONLY in Airtable and are never written.
// "Hourly Rate Snapshot" IS written — Airtable does not compute it, so the block copies the staff
// member's Current Hourly Rate into the row at save time. That snapshot is what keeps a rate change
// in June from rewriting what someone was paid in March. The Add dialog is the ONLY path that
// creates a Pay Log row, so it is the only place that snapshot can come from.
const createFields = q.select({
  workDate: "Work Date",
  staff: "Staff",
  hours: "Hours Worked",
  rate: "Hourly Rate Snapshot",
  bonus: "Bonus",
  deductions: "Deductions",
  status: "Payment Status",
  paymentDate: "Payment Date",
  submittedBy: "Submitted By",
  notes: "Notes",
});
// `rate` is in the update map only so a row saved without a snapshot can be backfilled. An existing
// snapshot is NEVER overwritten — that would rewrite history. The pay run never passes `rate` at all.
const updateFields = q.select({
  hours: "Hours Worked",
  rate: "Hourly Rate Snapshot",
  bonus: "Bonus",
  deductions: "Deductions",
  status: "Payment Status",
  paymentDate: "Payment Date",
  notes: "Notes",
});

// ---------- helpers ----------
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
// Standard Daily Hours has to keep "not set" and 0 apart. An empty default means this person has
// no usual day and the Add dialog pre-fills NOTHING for them; it does not mean they work a
// zero-hour day. num() collapses both to 0, so every read of that field goes through this instead.
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}
// Airtable SELECT fields read back as { id, label }. Unwrap for display / comparison;
// write them back as the plain choice name.
function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}
// Airtable LINKED_RECORD fields read back as an array of { id, name } (or of ids).
function linkName(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? "" : linkName(v[0]);
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { name?: string; label?: string; title?: string };
    return String(o.name ?? o.label ?? o.title ?? "").trim();
  }
  return String(v).trim();
}
function norm(v: unknown): string { return String(v ?? "").trim().toLowerCase(); }
// Airtable rejects "" on typed fields — write null to clear instead.
function orNull(s: string): string | null { const t = s.trim(); return t === "" ? null : t; }
// Airtable dates arrive ISO (2026-09-02). No slash-date parsing any more.
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
function fromIso(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function money(n: number, cur = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(v: unknown): string {
  const d = toDate(v);
  if (!d) return v ? String(v) : "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function isoOrEmpty(v: unknown): string { const d = toDate(v); return d ? isoDay(d) : ""; }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

// ---------- date presets ----------
// Pay Log rows are DAILY, keyed on Work Date, so day-level presets are meaningful here (unlike the
// weekly Conversions page, which deliberately offers none).
// Every boundary below is built from a LOCAL `new Date()` and local Y/M/D constructors — the same
// frame `toDate` parses rows into — so "Today" means the day the person at the screen is in.
// The window is applied to the already-fetched rows. There is deliberately no q.date() query here:
// it is untested against Airtable DATE fields and its failure mode (an empty result) is
// indistinguishable from "nothing logged".
type DatePreset = "today" | "yesterday" | "week" | "lastweek" | "month" | "lastmonth" | "all";
const DATE_DEFAULT: DatePreset = "month";
const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "lastweek", label: "Last week" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "all", label: "All time" },
];
function presetLabel(p: DatePreset): string {
  return DATE_PRESETS.find((x) => x.value === p)?.label ?? "All time";
}
// Weeks run MONDAY–SUNDAY — the same convention the Conversions page and the rest of the app use.
function mondayOf(d: Date) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
function addDays(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
// Inclusive [from, to] day window, or null for "All time".
function presetRange(p: DatePreset, now: Date): { from: Date; to: Date } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "today") return { from: today, to: today };
  if (p === "yesterday") { const y = addDays(today, -1); return { from: y, to: y }; }
  if (p === "week") { const m = mondayOf(today); return { from: m, to: addDays(m, 6) }; }
  if (p === "lastweek") { const m = addDays(mondayOf(today), -7); return { from: m, to: addDays(m, 6) }; }
  if (p === "month") return { from: firstOfMonth(today), to: lastOfMonth(today) };
  if (p === "lastmonth") { const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { from: prev, to: lastOfMonth(prev) }; }
  return null;
}
// "5 Sep" / "31 Aug – 6 Sep" / "1 – 30 Sep", with the year added only when the window is not in
// the current year (or straddles two).
function fmtSpan(from: Date, to: Date): string {
  const cy = new Date().getFullYear();
  const crossYear = from.getFullYear() !== to.getFullYear();
  const showYear = crossYear || from.getFullYear() !== cy || to.getFullYear() !== cy;
  const dm = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (isoDay(from) === isoDay(to)) return showYear ? `${dm(from)} ${from.getFullYear()}` : dm(from);
  if (crossYear) return `${dm(from)} ${from.getFullYear()} – ${dm(to)} ${to.getFullYear()}`;
  if (from.getMonth() === to.getMonth()) return showYear ? `${from.getDate()} – ${dm(to)} ${to.getFullYear()}` : `${from.getDate()} – ${dm(to)}`;
  return showYear ? `${dm(from)} – ${dm(to)} ${to.getFullYear()}` : `${dm(from)} – ${dm(to)}`;
}

// initials for the person avatar: first letters of the first two words
function initialsOf(name: unknown): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0].charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
}
function statusTone(s: unknown): string {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "paid") return "bg-emerald-500";
  if (v === "scheduled") return "bg-amber-500";
  if (v === "unpaid") return "bg-rose-500";
  return "bg-muted-foreground/40";
}
// at most 5 numbered buttons, ellipsis-collapsed. `current` is 1-based.
function pageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 4, "ellipsis", total];
  if (current >= total - 2) return [1, "ellipsis", total - 3, total - 2, total - 1, total];
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}

const ALL = "__all__";
// Exactly the choices Airtable's Payment Status field carries — writing anything else would
// silently create a new choice.
const STATUSES = ["Unpaid", "Scheduled", "Paid"];
const PAGE_SIZES = [15, 25, 50, 100];
const PAY_FETCH_CAP = 5000; // initial hard stop on auto-paging the pay log
const FETCH_CHUNK = 1000;   // how many more rows "Load more" is willing to pull

type SortKey = "workDate" | "staff" | "hours" | "totalPay";
type SortDir = "asc" | "desc";

type EditDraft = { id: string; label: string; staff: string; hours: string; bonus: string; deductions: string; status: string; paymentDate: string; notes: string; snapshot: number };
// `hoursTouched` keeps the Standard Daily Hours pre-fill from stomping on a number the user
// already typed when they change their mind about who the row is for.
type AddDraft = { staff: string; workDate: string; hours: string; hoursTouched: boolean; bonus: string; deductions: string; status: string; paymentDate: string; notes: string };
function emptyAdd(): AddDraft { return { staff: "", workDate: isoDay(new Date()), hours: "", hoursTouched: false, bonus: "", deductions: "", status: "Unpaid", paymentDate: "", notes: "" }; }

// shared table styling (§4 of the table design spec)
const HEAD = "sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap text-left";
const HEAD_R = HEAD + " text-right";
const CELL = "px-3 py-2 text-sm";

// The pay run is a bulk action on the table above, not a second view of it, so it gets a divider
// band rather than a card of its own.
const SECTION_BAR = "flex flex-col gap-2 border-t bg-muted/20 px-4 py-2.5 sm:px-5 md:flex-row md:items-center md:justify-between";
const SECTION_LABEL = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

// ---------- block ----------
export default function Block() {
  const today = new Date();
  const user = useCurrentUser();

  // ===== add record state =====
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState<AddDraft>(emptyAdd());
  const [adding, setAdding] = useState(false);
  const [dupConfirm, setDupConfirm] = useState<string | null>(null);

  // ===== filters =====
  const [fStaff, setFStaff] = useState<string>(ALL);
  // ONE date filter. The old "Pay period" chip is gone: it silently opened the page pre-filtered to
  // a yyyy-mm string and could contradict any other date control. Presets replace it entirely.
  const [fDate, setFDate] = useState<DatePreset>(DATE_DEFAULT);
  const [fStatus, setFStatus] = useState<string>(ALL);
  // Resolved once per preset change, not per render, so it is a stable dependency for the filter
  // memo below.
  const dateRange = useMemo(() => presetRange(fDate, new Date()), [fDate]);
  const dateLabel = presetLabel(fDate);
  const dateWindow = dateRange ? `${dateLabel} (${fmtSpan(dateRange.from, dateRange.to)})` : dateLabel;

  // ===== search, sort & pagination =====
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey>("workDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // how many rows we are willing to pull from the pay log
  const [fetchCap, setFetchCap] = useState(PAY_FETCH_CAP);

  // Reset page to 0 whenever the visible result set changes shape
  useEffect(() => { setPage(0); }, [search, fStaff, fDate, fStatus, pageSize, sortKey, sortDir]);

  // "Active" means "not the default view" — Reset returns to the DEFAULT preset, not to All time.
  const filtersActive = fStaff !== ALL || fDate !== DATE_DEFAULT || fStatus !== ALL || search.trim() !== "";
  const resetFilters = () => { setFStaff(ALL); setFDate(DATE_DEFAULT); setFStatus(ALL); setSearch(""); };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "workDate" ? "desc" : "asc"); }
  };
  const SortIcon = ({ column }: { column: SortKey }) => {
    if (column !== sortKey) return null;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3" />;
  };

  // ===== pay run controls =====
  const [runStaff, setRunStaff] = useState<string>(ALL);
  const [runFrom, setRunFrom] = useState(isoDay(firstOfMonth(today)));
  const [runTo, setRunTo] = useState(isoDay(lastOfMonth(today)));
  const [runPaidDate, setRunPaidDate] = useState(isoDay(today));
  const [runCandidates, setRunCandidates] = useState<any[] | null>(null);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | null>(null);

  // ===== edit / delete state =====
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ===== Staff — fetched WITHOUT a server-side status filter and auto-paged past the 100-row page
  // limit. Status is a SELECT now, so it is unwrapped and matched client-side. Staff is what the
  // Add dialog snapshots the hourly rate from, so it must be fully loaded before a row is saved. ==
  const staffQ = useRecords({
    from: ds.staff,
    select: staffSelect,
    count: 100,
    orderBy: q.asc("name"),
  });
  useEffect(() => {
    if (staffQ.hasNextPage && !staffQ.isFetching) staffQ.fetchNextPage();
  }, [staffQ.hasNextPage, staffQ.isFetching, staffQ.data]);
  const staffRows = useMemo(
    () => (staffQ.data?.pages.flatMap((p: any) => p.items) ?? [])
      .map((r: any) => ({
        id: r.id,
        name: String(r.fields.name ?? "").trim(),
        statusRaw: r.fields.status,
        status: label(r.fields.status),
        model: linkName(r.fields.model),
        rate: num(r.fields.rate),
        stdHours: numOrNull(r.fields.stdHours),
        currency: label(r.fields.currency) || "USD",
      }))
      .filter((s: any) => s.name !== ""),
    [staffQ.data]
  );
  // The pickers need people who have left but still have history, as well as current staff.
  const allStaff = useMemo(() => staffRows.filter((s: any) => s.status === "Active" || s.status === "Inactive"), [staffRows]);
  const staffLoaded = staffQ.status === "success" && !staffQ.hasNextPage;

  const mainCurrency = allStaff[0]?.currency ?? "USD";
  // Per-staff currency (Staff "Currency"), so one member's money is never formatted with another's.
  const currencyOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allStaff as any[]) m.set(norm(s.name), s.currency);
    return m;
  }, [allStaff]);
  const rowCurrency = (name: unknown) => currencyOf.get(norm(name)) ?? mainCurrency;
  // Current rate by name — used ONLY to backfill a row that has no snapshot at all.
  const rateOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of allStaff as any[]) m.set(norm(s.name), s.rate);
    return m;
  }, [allStaff]);

  // ===== The Pay Log — one query, auto-paged in full up to the cap. =====
  const payQ = useRecords({
    from: ds.paylog,
    select: paySelect,
    count: 100,
  });
  const loadedCount = payQ.data?.pages.reduce((s: number, p: any) => s + (p.items?.length ?? 0), 0) ?? 0;
  const capReached = payQ.hasNextPage === true && loadedCount >= fetchCap;
  useEffect(() => {
    if (payQ.hasNextPage && !payQ.isFetching && loadedCount < fetchCap) payQ.fetchNextPage();
  }, [payQ.hasNextPage, payQ.isFetching, payQ.data, loadedCount, fetchCap]);
  const historyTotal: number | null = typeof payQ.data?.pages?.[0]?.total === "number" ? payQ.data.pages[0].total : null;

  const allRows = useMemo(() => (payQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[], [payQ.data]);
  const allLoaded = payQ.status === "success" && !payQ.hasNextPage;

  // ----- decorate all fetched rows (unwrap the linked Staff and the Payment Status select once,
  // and detect duplicates over the whole fetched set) -----
  const allFetchedRows = useMemo(() => {
    const counts = new Map<string, number>();
    const decorated = allRows.map((r: any) => {
      const d = toDate(r.fields.workDate);
      const staffName = linkName(r.fields.staff);
      const st = label(r.fields.status) || "Unpaid";
      const period = String(r.fields.period ?? "").trim() || (d ? monthKey(d) : "");
      const key = `${norm(staffName)}|${d ? isoDay(d) : String(r.fields.workDate ?? "")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { ...r, __date: d, __staff: staffName, __status: st, __period: period, __key: key };
    });
    return decorated.map((r: any) => ({ ...r, __dup: (counts.get(r.__key) ?? 0) > 1 }));
  }, [allRows]);

  // ----- filters + search (staff name, notes, submitted by — plus date & status) -----
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allFetchedRows.filter((r: any) => {
      if (fStaff !== ALL && norm(r.__staff) !== norm(fStaff)) return false;
      // Date window, inclusive of both ends. A row with an unreadable Work Date is excluded from
      // every window except All time rather than being silently counted into one.
      if (dateRange) {
        if (!r.__date) return false;
        const t = r.__date.getTime();
        if (t < dateRange.from.getTime() || t > dateRange.to.getTime()) return false;
      }
      if (fStatus !== ALL && r.__status !== fStatus) return false;
      if (!term) return true;
      const f = r.fields;
      const staffName = String(r.__staff ?? "").toLowerCase();
      const notesStr = String(f.notes ?? "").toLowerCase();
      const submittedStr = String(f.submittedBy ?? "").toLowerCase();
      const dateStr = fmtDate(f.workDate).toLowerCase();
      const statusStr = String(r.__status ?? "").toLowerCase();
      return staffName.includes(term) || notesStr.includes(term) || submittedStr.includes(term)
        || dateStr.includes(term) || statusStr.includes(term);
    });
  }, [allFetchedRows, search, fStaff, dateRange, fStatus]);

  // ----- client-side sort on parsed values (dates via toDate, numbers via num) -----
  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = filteredRows.slice();
    rows.sort((a: any, b: any) => {
      let cmp = 0;
      if (sortKey === "workDate") {
        cmp = (a.__date?.getTime() ?? 0) - (b.__date?.getTime() ?? 0);
      } else if (sortKey === "staff") {
        cmp = String(a.__staff ?? "").localeCompare(String(b.__staff ?? ""), undefined, { sensitivity: "base" });
      } else if (sortKey === "hours") {
        cmp = num(a.fields.hours) - num(b.fields.hours);
      } else {
        cmp = num(a.fields.totalPay) - num(b.fields.totalPay);
      }
      if (cmp === 0) cmp = (a.__date?.getTime() ?? 0) - (b.__date?.getTime() ?? 0);
      return cmp * dir;
    });
    return rows;
  }, [filteredRows, sortKey, sortDir]);

  // ----- client-side pagination -----
  const totalFiltered = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedRows = useMemo(() => {
    const start = safePage * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, safePage, pageSize]);

  const rangeStart = totalFiltered === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min((safePage + 1) * pageSize, totalFiltered);
  const pages = pageList(safePage + 1, totalPages);

  // ----- totals over the WHOLE filtered set, not just the visible page -----
  const ledgerTotals = useMemo(() => filteredRows.reduce((acc: any, r: any) => {
    acc.hours += num(r.fields.hours);
    acc.pay += num(r.fields.totalPay);
    if (r.__status !== "Paid") acc.unpaid += num(r.fields.totalPay);
    return acc;
  }, { hours: 0, pay: 0, unpaid: 0 }), [filteredRows]);

  // An empty table has to name the filter responsible for it, so nobody reads a narrow window as
  // "there is no data".
  const emptyReason = useMemo(() => {
    if (allFetchedRows.length === 0) return "No pay log rows yet — add the first one.";
    const bits: string[] = [];
    if (fDate !== "all") bits.push(dateLabel);
    if (fStaff !== ALL) bits.push(fStaff);
    if (fStatus !== ALL) bits.push(fStatus);
    if (search.trim() !== "") bits.push(`“${search.trim()}”`);
    if (bits.length === 0) return "No pay log rows to show.";
    return `No rows for ${bits.join(" · ")} — try a wider range.`;
  }, [allFetchedRows.length, fDate, dateLabel, fStaff, fStatus, search]);

  // Which NON-date filters are narrowing the totals — spelled out rather than a bare "(filtered)".
  const narrowedBy = useMemo(() => {
    const bits: string[] = [];
    if (fStaff !== ALL) bits.push(fStaff);
    if (fStatus !== ALL) bits.push(fStatus.toLowerCase());
    if (search.trim() !== "") bits.push(`search “${search.trim()}”`);
    return bits;
  }, [fStaff, fStatus, search]);

  // ===== mutations =====
  const create = useRecordCreate({ from: ds.paylog, fields: createFields, onError: (e) => toast.error(e.message) });
  const update = useRecordUpdate({ from: ds.paylog, fields: updateFields, onError: (e) => toast.error(e.message) });
  const remove = useRecordDelete({ from: ds.paylog, onError: (e) => toast.error(e.message) });
  // ADD and UPDATE carry different permissions (ALL_USERS vs LOGGED_IN_USERS) — never assume
  // create.enabled covers both.
  const canCreate = create.enabled;
  const canUpdate = update.enabled;
  const canDelete = remove.enabled;

  const refetchAll = async () => { await payQ.refetch(); };

  // ===================================================================================
  // Add record — the ONLY path that creates a Pay Log row, and therefore the only place
  // Hourly Rate Snapshot is ever set on a new record.
  // ===================================================================================
  const openAdd = () => { setAdd(emptyAdd()); setAddOpen(true); };
  const setAddStatus = (v: string) => setAdd((d) => ({ ...d, status: v, paymentDate: v === "Paid" ? (d.paymentDate || isoDay(new Date())) : "" }));
  const addStaff = useMemo(() => (allStaff as any[]).find((s: any) => s.id === add.staff) ?? null, [allStaff, add.staff]);
  // Picking a person pre-fills Hours from their Standard Daily Hours (Staff page). No default set
  // leaves the box EMPTY — never 0, which would be a real zero-hour day. A number the user already
  // typed is left alone.
  const pickStaff = (id: string) => {
    setAdd((d) => {
      const s = (allStaff as any[]).find((x: any) => x.id === id) ?? null;
      if (d.hoursTouched) return { ...d, staff: id };
      const std = s?.stdHours;
      return { ...d, staff: id, hours: std === null || std === undefined ? "" : String(std) };
    });
  };
  const addValid = !!addStaff && !!add.workDate && num(add.hours) > 0 && (add.status !== "Paid" || !!add.paymentDate);

  const performCreate = async () => {
    if (!canCreate) { toast.error("You don't have permission to add records."); return; }
    if (!addStaff) { toast.error("Choose a staff member."); return; }
    setAdding(true);
    try {
      await create.mutateAsync({
        workDate: add.workDate,
        staff: [addStaff.id],            // LINKED_RECORD — always an array of Staff record ids
        hours: num(add.hours),
        rate: addStaff.rate,             // Hourly Rate Snapshot, copied from Current Hourly Rate NOW
        bonus: add.bonus.trim() === "" ? null : num(add.bonus),
        deductions: add.deductions.trim() === "" ? null : num(add.deductions),
        status: add.status,              // plain choice name, from the real choice list
        paymentDate: add.status === "Paid" ? (add.paymentDate || null) : null,
        notes: orNull(add.notes),
        submittedBy: orNull(user?.email ?? ""),
      });
      await refetchAll();
      toast.success(`Added ${addStaff.name} · ${fmtDate(add.workDate)}`);
      setDupConfirm(null);
      setAddOpen(false);
      setAdd(emptyAdd());
    } catch (e: any) {
      toast.error(e?.message ?? "Add failed");
    } finally {
      setAdding(false);
    }
  };

  const submitAdd = () => {
    if (!addValid || !addStaff) { toast.error("Staff, work date and hours (> 0) are required."); return; }
    const name = norm(addStaff.name);
    const clash = allRows.some((r: any) => {
      const d = toDate(r.fields.workDate);
      return !!d && isoDay(d) === add.workDate && norm(linkName(r.fields.staff)) === name;
    });
    if (clash) { setDupConfirm(`${addStaff.name} already has a row on ${fmtDate(add.workDate)} — add another anyway?`); return; }
    performCreate();
  };

  const openEdit = (r: any) => {
    const f = r.fields;
    setEdit({
      id: r.id,
      label: `${r.__staff ?? ""} · ${fmtDate(f.workDate)}`,
      staff: String(r.__staff ?? ""),
      hours: f.hours ? String(num(f.hours)) : "",
      bonus: f.bonus ? String(num(f.bonus)) : "",
      deductions: f.deductions ? String(num(f.deductions)) : "",
      status: STATUSES.includes(r.__status) ? r.__status : "Unpaid",
      paymentDate: isoOrEmpty(f.paymentDate),
      notes: String(f.notes ?? ""),
      snapshot: num(f.rate),
    });
  };
  // A row that already carries a snapshot keeps it, full stop. A row with none can be backfilled
  // from the person's current rate, because a missing snapshot means Base Pay and Total Pay are
  // blank and the row is unpayable as it stands.
  const editBackfill = useMemo(() => {
    if (!edit) return null;
    if (edit.snapshot > 0) return null;
    const r = rateOf.get(norm(edit.staff));
    return r !== undefined && r > 0 ? r : null;
  }, [edit, rateOf]);

  const saveEdit = async () => {
    if (!edit) return;
    if (!canUpdate) { toast.error("You don't have permission to update records."); return; }
    setSavingEdit(true);
    try {
      // NEVER overwrites an existing Hourly Rate Snapshot — the snapshot is what stops a rate
      // change in June rewriting what someone was paid in March. `rate` is only ever sent when
      // the row has no snapshot at all.
      const fields: any = {
        hours: num(edit.hours),
        bonus: edit.bonus.trim() === "" ? null : num(edit.bonus),
        deductions: edit.deductions.trim() === "" ? null : num(edit.deductions),
        status: edit.status,
        paymentDate: edit.paymentDate || null,
        notes: orNull(edit.notes),
      };
      if (edit.snapshot <= 0 && editBackfill !== null) fields.rate = editBackfill;
      await update.mutateAsync({ recordId: edit.id, fields });
      await refetchAll();
      toast.success("Row updated");
      setEdit(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (!canDelete) { toast.error("You don't have permission to delete records."); return; }
    setDeleting(true);
    try {
      await remove.mutateAsync(deleteTarget.id);
      await refetchAll();
      toast.success("Row deleted");
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  // ----- pay run -----
  const runFromDate = fromIso(runFrom);
  const runToDate = fromIso(runTo);
  const runRangeValid = !!runFrom && !!runTo && runFromDate.getTime() <= runToDate.getTime();

  const findCandidates = () => {
    if (!runRangeValid) { toast.error("From date must be on or before To date."); return; }
    if (!runPaidDate) { toast.error("Choose a paid date."); return; }
    const from = runFromDate.getTime(), to = runToDate.getTime();
    const matches = allRows.filter((r: any) => {
      const d = toDate(r.fields.workDate);
      if (!d) return false;
      const t = d.getTime();
      if (t < from || t > to) return false;
      if (runStaff !== ALL && norm(linkName(r.fields.staff)) !== norm(runStaff)) return false;
      return label(r.fields.status) !== "Paid";
    });
    if (matches.length === 0) { toast.info("No unpaid rows match that staff and date range."); return; }
    setRunCandidates(matches);
  };
  const runTotal = (runCandidates ?? []).reduce((s: number, r: any) => s + num(r.fields.totalPay), 0);

  const executeRun = async () => {
    if (!runCandidates || runCandidates.length === 0) return;
    if (!canUpdate) { toast.error("You don't have permission to update records."); return; }
    const list = runCandidates;
    setRunCandidates(null);
    setRunProgress({ done: 0, total: list.length });
    let ok = 0, failed = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        // Payment Status and Payment Date only — never a formula field, never the snapshot.
        await update.mutateAsync({ recordId: list[i].id, fields: { status: "Paid", paymentDate: runPaidDate } });
        ok++;
      } catch { failed++; }
      setRunProgress({ done: i + 1, total: list.length });
    }
    await refetchAll();
    setRunProgress(null);
    if (failed === 0) toast.success(`Marked ${ok} row${ok === 1 ? "" : "s"} as paid on ${fmtDate(runPaidDate)}`);
    else toast.warning(`Marked ${ok} as paid, ${failed} failed`);
  };

  const running = runProgress !== null;
  const historyLoading = payQ.status === "pending";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        <Card className="w-full overflow-hidden rounded-xl border bg-card shadow-sm">

          {/* ================= Card header ================= */}
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Pay log</h2>
                <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">{totalFiltered}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Every hours-and-pay row for every staff member. Use <span className="font-medium text-foreground">Add record</span> to log one day for one person, then edit, delete or pay the rows here.
              </p>
              <p className="text-sm text-muted-foreground">
                Adding a row records that person's hourly rate onto it as it saves, so a later rate change never rewrites old pay. Hours pre-fill from their <span className="font-medium text-foreground">Standard Daily Hours</span> on the Staff page when one is set — change it before saving if the day was different. Base pay, total and pay period are calculated by Airtable.
              </p>
            </div>
            <Button size="sm" onClick={openAdd} disabled={!canCreate || running || !staffLoaded} className="h-8 shrink-0 gap-1.5">
              <Plus className="h-4 w-4" /> Add record
            </Button>
          </div>

          <CardContent className="p-0">

            {/* ---- Toolbar: filter chips left, search right ---- */}
            <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5">
              <Select value={fStaff} onValueChange={setFStaff}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Users className="h-3.5 w-3.5 opacity-60" />
                  <span>{fStaff === ALL ? "Staff" : `Staff: ${fStaff}`}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All staff</SelectItem>
                  {allStaff.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}{s.status === "Inactive" ? " (inactive)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* ONE date chip. It always shows the window it is on, so the table is never quietly
                  filtered. Replaces the old "Pay period" chip outright. */}
              <Select value={fDate} onValueChange={(v) => setFDate(v as DatePreset)}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Calendar className="h-3.5 w-3.5 opacity-60" />
                  <span>Date: {dateLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <CircleDot className="h-3.5 w-3.5 opacity-60" />
                  <span>{fStatus === ALL ? "Payment status" : `Status: ${fStatus}`}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>

              {filtersActive && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={resetFilters}>
                  <X className="h-3.5 w-3.5" /> Reset
                </Button>
              )}

              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search staff, notes or submitted by…"
                  className="h-8 w-[200px] pl-8 text-sm lg:w-[260px]"
                />
              </div>
            </div>

            {staffQ.status === "error" && (
              <div className="flex items-start gap-2 border-t bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Staff could not be loaded, so new rows cannot be added right now — the hourly rate has to be read from the Staff record to be recorded on the row.</span>
              </div>
            )}

            {/* ---- The one table ---- */}
            {historyLoading ? (
              <div className="border-t py-16 text-center text-sm text-muted-foreground">Loading…</div>
            ) : payQ.status === "error" ? (
              <div className="border-t py-16 text-center text-sm text-destructive">Could not load the pay log.</div>
            ) : sortedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 border-t px-6 py-16 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{emptyReason}</p>
                {allFetchedRows.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {filtersActive && (
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={resetFilters}>
                        <X className="h-3.5 w-3.5" /> Reset to {presetLabel(DATE_DEFAULT)}
                      </Button>
                    )}
                    {fDate !== "all" && (
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setFDate("all")}>
                        <Calendar className="h-3.5 w-3.5" /> Show all time
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* raw table markup: shadcn's <Table> wraps itself in its own overflow-auto div,
                 which would become the scrollport and kill the sticky header */
              <div className="relative w-full overflow-auto max-h-[70vh] border-t">
                <table className="w-full caption-bottom border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={HEAD}>
                        <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => toggleSort("workDate")}>
                          <Calendar className="h-3 w-3 opacity-60" /> Work date <SortIcon column="workDate" />
                        </button>
                      </th>
                      <th className={HEAD + " min-w-[180px]"}>
                        <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => toggleSort("staff")}>
                          <User className="h-3 w-3 opacity-60" /> Staff <SortIcon column="staff" />
                        </button>
                      </th>
                      <th className={HEAD_R}>
                        <button type="button" className="inline-flex w-full items-center justify-end gap-1.5 hover:text-foreground" onClick={() => toggleSort("hours")}>
                          <Hash className="h-3 w-3 opacity-60" /> Hours <SortIcon column="hours" />
                        </button>
                      </th>
                      <th className={HEAD_R}><span className="inline-flex items-center gap-1.5"><DollarSign className="h-3 w-3 opacity-60" /> Rate</span></th>
                      <th className={HEAD_R}><span className="inline-flex items-center gap-1.5"><DollarSign className="h-3 w-3 opacity-60" /> Base</span></th>
                      <th className={HEAD_R}><span className="inline-flex items-center gap-1.5"><DollarSign className="h-3 w-3 opacity-60" /> Bonus</span></th>
                      <th className={HEAD_R}><span className="inline-flex items-center gap-1.5"><DollarSign className="h-3 w-3 opacity-60" /> Deduct.</span></th>
                      <th className={HEAD_R}>
                        <button type="button" className="inline-flex w-full items-center justify-end gap-1.5 hover:text-foreground" onClick={() => toggleSort("totalPay")}>
                          <DollarSign className="h-3 w-3 opacity-60" /> Total <SortIcon column="totalPay" />
                        </button>
                      </th>
                      <th className={HEAD}><span className="inline-flex items-center gap-1.5"><CircleDot className="h-3 w-3 opacity-60" /> Status</span></th>
                      <th className={HEAD}><span className="inline-flex items-center gap-1.5"><Calendar className="h-3 w-3 opacity-60" /> Paid date</span></th>
                      <th className={HEAD + " min-w-[160px]"}><span className="inline-flex items-center gap-1.5"><AlignLeft className="h-3 w-3 opacity-60" /> Notes</span></th>
                      <th className={HEAD_R + " w-[150px]"}><span className="inline-flex items-center gap-1.5"><MoreHorizontal className="h-3 w-3 opacity-60" /> Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((r: any) => {
                      const f = r.fields;
                      const st = r.__status || "Unpaid";
                      const cur = rowCurrency(r.__staff);
                      return (
                        <tr key={r.id} className={`h-12 border-b transition-colors hover:bg-muted/40${r.__dup ? " bg-destructive/5" : ""}`}>
                          <td className={CELL + " whitespace-nowrap tabular-nums"}>{fmtDate(f.workDate)}</td>
                          <td className={CELL}>
                            {r.__staff ? (
                              <div className="flex items-center gap-2.5">
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initialsOf(r.__staff)}</span>
                                <span className="font-medium whitespace-nowrap">{r.__staff}</span>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={CELL + " text-right tabular-nums"}>{num(f.hours).toFixed(2)}</td>
                          <td className={CELL + " text-right tabular-nums"}>{num(f.rate) > 0 ? money(num(f.rate), cur) : <span className="text-amber-600">none</span>}</td>
                          <td className={CELL + " text-right tabular-nums"}>{money(num(f.basePay), cur)}</td>
                          <td className={CELL + " text-right tabular-nums"}>{num(f.bonus) ? money(num(f.bonus), cur) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={CELL + " text-right tabular-nums"}>{num(f.deductions) ? money(num(f.deductions), cur) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={CELL + " text-right font-medium tabular-nums"}>{money(num(f.totalPay), cur)}</td>
                          <td className={CELL}>
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-sm">
                                <span className={"h-1.5 w-1.5 rounded-full " + statusTone(st)} />
                                {st}
                              </span>
                              {r.__dup && <Badge variant="destructive" className="rounded-md font-normal">dup</Badge>}
                            </div>
                          </td>
                          <td className={CELL + " whitespace-nowrap tabular-nums"}>{f.paymentDate ? fmtDate(f.paymentDate) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={CELL + " max-w-[260px] truncate text-muted-foreground"} title={`${String(f.notes ?? "")}${f.submittedBy ? ` — ${f.submittedBy}` : ""}`}>{f.notes || <span className="text-muted-foreground">—</span>}</td>
                          <td className={CELL + " text-right"}>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => openEdit(r)} disabled={!canUpdate || running}>
                                <Pencil className="h-3.5 w-3.5" />Edit
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-destructive" onClick={() => setDeleteTarget({ id: r.id, label: `${r.__staff ?? ""} · ${fmtDate(f.workDate)}` })} disabled={!canDelete || running}>
                                <Trash2 className="h-3.5 w-3.5" />Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- Aggregate totals for the filtered set (own row, above the footer) ---- */}
            {/* Totals for the filtered set. It states the active window IN WORDS plus the dates it
                resolves to, so the numbers can never be read as "everything". */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{dateWindow}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{totalFiltered} row{totalFiltered === 1 ? "" : "s"}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{ledgerTotals.hours.toFixed(2)} h</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{money(ledgerTotals.pay, mainCurrency)}</span>
              <span aria-hidden="true">·</span>
              <span className={`tabular-nums ${ledgerTotals.unpaid > 0 ? "text-amber-600" : ""}`}>{money(ledgerTotals.unpaid, mainCurrency)} unpaid</span>
              {narrowedBy.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>also filtered by {narrowedBy.join(", ")}</span>
                </>
              )}
            </div>

            {/* ---- Footer: rows-per-page left, range middle, pagination right ---- */}
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="whitespace-nowrap">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground tabular-nums">
                {totalFiltered === 0 ? "0 rows" : `${rangeStart}–${rangeEnd} of ${totalFiltered} row${totalFiltered === 1 ? "" : "s"}`}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="First page" disabled={safePage === 0} onClick={() => setPage(0)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pages.map((p, i) =>
                  p === "ellipsis" ? (
                    <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === safePage + 1 ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 p-0 text-xs tabular-nums"
                      aria-label={`Page ${p}`}
                      onClick={() => setPage(p - 1)}
                    >
                      {p}
                    </Button>
                  )
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next page" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Last page" disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* ---- Server-fetch cap / load more ---- */}
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3 text-xs text-muted-foreground">
              <span>
                {loadedCount.toLocaleString()} row{loadedCount === 1 ? "" : "s"} loaded from the pay log
                {historyTotal !== null ? ` of ${historyTotal.toLocaleString()} total` : ""}
                {payQ.isFetching ? " · loading…" : ""}
              </span>
              {capReached && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => setFetchCap((c) => c + FETCH_CHUNK)} disabled={payQ.isFetching}>
                  <Download className="h-3.5 w-3.5" /> Load more
                </Button>
              )}
              {(!canCreate || !canUpdate || !canDelete) && payQ.status === "success" && (
                <span>
                  {!canCreate && "Adding is disabled for your account. "}{!canUpdate && "Editing is disabled for your account. "}{!canDelete && "Deleting is disabled for your account. "}Check the block's Actions permissions in Studio.
                </span>
              )}
            </div>

            {/* ================= Pay run ================= */}
            <div className={SECTION_BAR}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={SECTION_LABEL}><BadgeDollarSign className="mr-1 inline h-3.5 w-3.5 opacity-60" />Pay run</span>
                <span className="text-xs text-muted-foreground">Mark every unpaid or scheduled row in a date range as paid, in one go. Base pay and totals are calculated by Airtable and are not changed.</span>
              </div>
            </div>

            <div className="space-y-3 border-t px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Staff</Label>
                  <Select value={runStaff} onValueChange={setRunStaff}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All staff</SelectItem>
                      {allStaff.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}{s.status === "Inactive" ? " (inactive)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={runFrom} onChange={(e) => setRunFrom(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={runTo} onChange={(e) => setRunTo(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Paid date</Label>
                  <Input type="date" value={runPaidDate} onChange={(e) => setRunPaidDate(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="flex items-end">
                  <Button size="sm" className="h-8 w-full gap-2" onClick={findCandidates} disabled={!canUpdate || running || !allLoaded || !runRangeValid}>
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeDollarSign className="h-4 w-4" />}
                    {running ? `${runProgress!.done} of ${runProgress!.total}…` : !allLoaded ? "Loading rows…" : "Mark as paid"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{allLoaded ? `${allRows.length} pay log row${allRows.length === 1 ? "" : "s"} scanned` : "Scanning pay log…"}</span>
                {!runRangeValid && <span className="text-destructive">From must be on or before To.</span>}
                {!canUpdate && payQ.status === "success" && (
                  <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Updating records is disabled for your account — enable the Update action in the block's Actions tab in Studio.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------- Add dialog — the only write path that creates a row ---------- */}
        <Dialog open={addOpen} onOpenChange={(o) => { if (!o && !adding) { setAddOpen(false); setAdd(emptyAdd()); } }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add pay record</DialogTitle>
              <DialogDescription>One row: one person, one day. The hourly rate below is written onto the row as it saves; base pay, pay period and total are calculated by Airtable.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Staff <span className="text-destructive">*</span></Label>
                <Select value={add.staff} onValueChange={pickStaff}>
                  <SelectTrigger><SelectValue placeholder="Choose staff" /></SelectTrigger>
                  <SelectContent>
                    {allStaff.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}{s.status === "Inactive" ? " (inactive)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                {addStaff ? (
                  addStaff.rate > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Hourly rate recorded on this row: <span className="font-medium tabular-nums text-foreground">{money(addStaff.rate, addStaff.currency)}</span>
                      {addStaff.stdHours !== null && addStaff.stdHours !== undefined
                        ? <> · standard day {String(addStaff.stdHours)} h</>
                        : <> · no standard day set</>}
                    </p>
                  ) : (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      No hourly rate on {addStaff.name}'s Staff record. The row will save, but base pay and total will be 0 until a rate is set on the Staff page.
                    </p>
                  )
                ) : (
                  <p className="text-xs text-muted-foreground">Their current hourly rate is recorded on the row, and hours pre-fill from their standard day if one is set.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Work date <span className="text-destructive">*</span></Label>
                <Input type="date" value={add.workDate} onChange={(e) => setAdd({ ...add, workDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Hours worked <span className="text-destructive">*</span></Label>
                <Input type="number" inputMode="decimal" min={0} max={24} step={0.25} placeholder="0" value={add.hours} onChange={(e) => setAdd({ ...add, hours: e.target.value, hoursTouched: true })} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment status</Label>
                <Select value={add.status} onValueChange={setAddStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className={add.status !== "Paid" ? "text-muted-foreground" : undefined}>Paid date</Label>
                <Input type="date" value={add.paymentDate} disabled={add.status !== "Paid"} onChange={(e) => setAdd({ ...add, paymentDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Bonus</Label>
                <Input type="number" inputMode="decimal" min={0} step={0.01} placeholder="0" value={add.bonus} onChange={(e) => setAdd({ ...add, bonus: e.target.value })} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Deductions</Label>
                <Input type="number" inputMode="decimal" min={0} step={0.01} placeholder="0" value={add.deductions} onChange={(e) => setAdd({ ...add, deductions: e.target.value })} className="tabular-nums" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Input value={add.notes} onChange={(e) => setAdd({ ...add, notes: e.target.value })} placeholder="Optional" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setAddOpen(false); setAdd(emptyAdd()); }} disabled={adding}>Cancel</Button>
              <Button onClick={submitAdd} disabled={adding || !canCreate || !addValid}>{adding ? "Adding…" : "Add record"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ---------- Duplicate confirm ---------- */}
        <AlertDialog open={dupConfirm !== null} onOpenChange={(o) => { if (!o && !adding) setDupConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Possible duplicate</AlertDialogTitle>
              <AlertDialogDescription>{dupConfirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={adding}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); performCreate(); }} disabled={adding}>{adding ? "Adding…" : "Add anyway"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ---------- Edit dialog ---------- */}
        <Dialog open={edit !== null} onOpenChange={(o) => { if (!o && !savingEdit) setEdit(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit pay row</DialogTitle>
              <DialogDescription>{edit?.label}. Staff and work date can't be changed here — delete and re-add instead.</DialogDescription>
            </DialogHeader>
            {edit && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  {edit.snapshot > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Hourly rate on this row: <span className="font-medium tabular-nums text-foreground">{money(edit.snapshot, rowCurrency(edit.staff))}</span> — recorded when the row was created and never changed by an edit.
                    </p>
                  ) : editBackfill !== null ? (
                    <p className="text-xs text-amber-700">
                      This row has no hourly rate recorded, so base pay and total are blank. Saving will record {money(editBackfill, rowCurrency(edit.staff))} from {edit.staff}'s current rate.
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700">
                      This row has no hourly rate recorded and no current rate is set on the Staff record, so base pay and total stay blank. Add a rate on the Staff page first.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Hours worked</Label>
                  <Input type="number" inputMode="decimal" min={0} max={24} step={0.25} value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Payment status</Label>
                  <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Bonus</Label>
                  <Input type="number" inputMode="decimal" min={0} step={0.01} value={edit.bonus} onChange={(e) => setEdit({ ...edit, bonus: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Deductions</Label>
                  <Input type="number" inputMode="decimal" min={0} step={0.01} value={edit.deductions} onChange={(e) => setEdit({ ...edit, deductions: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Payment date</Label>
                  <Input type="date" value={edit.paymentDate} onChange={(e) => setEdit({ ...edit, paymentDate: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Notes</Label>
                  <Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Optional" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEdit(null)} disabled={savingEdit}>Cancel</Button>
              <Button onClick={saveEdit} disabled={savingEdit || !canUpdate}>{savingEdit ? "Saving…" : "Save changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ---------- Delete confirm ---------- */}
        <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this pay row?</AlertDialogTitle>
              <AlertDialogDescription>{deleteTarget?.label}. This removes the row from the Pay Log and cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting ? "Deleting…" : "Delete"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ---------- Pay run confirm ---------- */}
        <AlertDialog open={runCandidates !== null} onOpenChange={(o) => { if (!o) setRunCandidates(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm pay run</AlertDialogTitle>
              <AlertDialogDescription>
                Mark {runCandidates?.length ?? 0} row{(runCandidates?.length ?? 0) === 1 ? "" : "s"} totalling {money(runTotal, mainCurrency)} as paid on {fmtDate(runPaidDate)}?
                {" "}({runStaff === ALL ? "All staff" : runStaff}, {fmtDate(runFrom)} – {fmtDate(runTo)}.) Each row's Payment Status becomes "Paid" and Payment Date is set to {runPaidDate}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); executeRun(); }}>Mark as paid</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </div>
  );
}
