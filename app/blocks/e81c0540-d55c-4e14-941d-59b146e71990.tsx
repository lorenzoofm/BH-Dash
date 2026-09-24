"use client";
import { useEffect, useMemo, useState } from "react";
import { datasource, useRecords, q } from "@/lib/datasource";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  DollarSign,
  Hash,
  Inbox,
  Lock,
  Receipt,
  Search,
  Sparkles,
  Sigma,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";

// ---------------------------------------------------------------- datasources
// Airtable "20MG Operations" (app0OseEBbAAAU6xt). fieldReferenceKey is "name"
// on every one of these, so q.select addresses fields by NAME, not by field id.
const ds = datasource.define({
  expenses: "expenses",
  paylog: "paylog",
  staff: "staff",
  models: "models",
});

const expensesSelect = q.select({
  date: "Expense Date",
  amount: "Amount",
});

// Total Pay is an Airtable FORMULA — read only, never written from here.
const paySelect = q.select({
  workDate: "Work Date",
  staff: "Staff",
  hours: "Hours Worked",
  totalPay: "Total Pay",
  status: "Payment Status",
});

const staffSelect = q.select({
  name: "Full Name",
  model: "Model",
  status: "Status",
});

const modelSelect = q.select({
  model: "Model",
});

// -------------------------------------------------------------------- helpers
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

/** Airtable SELECT fields come back as { id, label }. Unwrap to the plain name. */
function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

const REC_ID = /^rec[A-Za-z0-9]{14}$/;

type LinkEntry = { id: string; name: string };

/**
 * Airtable LINKED_RECORD fields read back as an array — of { id, name } objects,
 * of bare record ids, or (defensively) of bare display names. Normalise all three.
 */
function linkEntries(v: unknown): LinkEntry[] {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: LinkEntry[] = [];
  for (const raw of arr) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) continue;
      if (REC_ID.test(s)) out.push({ id: s, name: "" });
      else out.push({ id: "", name: s });
    } else if (typeof raw === "object") {
      const o = raw as any;
      const id = o.id ? String(o.id).trim() : "";
      const name = String(o.name ?? o.label ?? o.title ?? o.value ?? "").trim();
      if (id || name) out.push({ id, name });
    }
  }
  return out;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // Airtable date fields are ISO (yyyy-mm-dd, optionally with a time part).
  // Build a LOCAL date from the y/m/d parts so the day never shifts.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function money(n: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

function dayLabel(d: Date | null): string {
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function initialsOf(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const PERIODS = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
  { value: "3m", label: "Last 3 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

function periodRange(period: string): { start: Date | null; end: Date | null } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === "this")
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  if (period === "last")
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
  if (period === "3m")
    return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1) };
  if (period === "12m")
    return { start: new Date(y, m - 11, 1), end: new Date(y, m + 1, 1) };
  return { start: null, end: null };
}

function inRange(d: Date | null, start: Date | null, end: Date | null) {
  if (!start && !end) return true;
  if (!d) return false;
  if (start && d.getTime() < start.getTime()) return false;
  if (end && d.getTime() >= end.getTime()) return false;
  return true;
}

function statusTone(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return "bg-emerald-500";
  if (s === "scheduled" || s === "pending") return "bg-amber-500";
  if (s === "unpaid") return "bg-rose-500";
  return "bg-muted-foreground/40";
}

function pageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | string)[] = [];
  const push = (v: number | string) => {
    if (out[out.length - 1] !== v) out.push(v);
  };
  push(1);
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) push("…");
  for (let i = from; i <= to; i++) push(i);
  if (to < total - 1) push("…");
  push(total);
  return out;
}

type PayRow = {
  id: string;
  date: Date | null;
  monthKey: string;
  staff: string;
  model: string; // "" == unassigned
  hours: number;
  pay: number;
  status: string;
};

type SortKey = "date" | "staff" | "model" | "hours" | "pay" | "status";

// ---------------------------------------------------------------------- block
export default function Block() {
  const [period, setPeriod] = useState("all");

  // table-local filters
  const [monthFilter, setMonthFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  // ------------------------------------------------------------- data fetches
  const expensesQuery = useRecords({
    from: ds.expenses,
    select: expensesSelect,
    count: 100,
  });
  const payQuery = useRecords({
    from: ds.paylog,
    select: paySelect,
    count: 100,
  });
  const staffQuery = useRecords({
    from: ds.staff,
    select: staffSelect,
    count: 100,
  });
  const modelsQuery = useRecords({
    from: ds.models,
    select: modelSelect,
    count: 100,
  });

  // auto-page everything before aggregating
  const expHasNext = expensesQuery.hasNextPage;
  const expFetchingNext = expensesQuery.isFetchingNextPage;
  const expFetchNext = expensesQuery.fetchNextPage;
  useEffect(() => {
    if (expHasNext && !expFetchingNext && expensesQuery.status !== "error") expFetchNext();
  }, [expHasNext, expFetchingNext, expFetchNext, expensesQuery.status]);

  const payHasNext = payQuery.hasNextPage;
  const payFetchingNext = payQuery.isFetchingNextPage;
  const payFetchNext = payQuery.fetchNextPage;
  useEffect(() => {
    if (payHasNext && !payFetchingNext && payQuery.status !== "error") payFetchNext();
  }, [payHasNext, payFetchingNext, payFetchNext, payQuery.status]);

  const staffHasNext = staffQuery.hasNextPage;
  const staffFetchingNext = staffQuery.isFetchingNextPage;
  const staffFetchNext = staffQuery.fetchNextPage;
  useEffect(() => {
    if (staffHasNext && !staffFetchingNext && staffQuery.status !== "error") staffFetchNext();
  }, [staffHasNext, staffFetchingNext, staffFetchNext, staffQuery.status]);

  const modelsHasNext = modelsQuery.hasNextPage;
  const modelsFetchingNext = modelsQuery.isFetchingNextPage;
  const modelsFetchNext = modelsQuery.fetchNextPage;
  useEffect(() => {
    if (modelsHasNext && !modelsFetchingNext && modelsQuery.status !== "error") modelsFetchNext();
  }, [modelsHasNext, modelsFetchingNext, modelsFetchNext, modelsQuery.status]);

  const loading =
    expensesQuery.status === "pending" ||
    payQuery.status === "pending" ||
    staffQuery.status === "pending" ||
    modelsQuery.status === "pending" ||
    expHasNext ||
    payHasNext ||
    staffHasNext ||
    modelsHasNext;

  const failed =
    expensesQuery.status === "error" ||
    payQuery.status === "error" ||
    staffQuery.status === "error" ||
    modelsQuery.status === "error";

  // ------------------------------------------------------------- derived data
  const { start, end } = useMemo(() => periodRange(period), [period]);

  // Hop 2 of the join: Models record id -> model name.
  const modelNameById = useMemo(() => {
    const map = new Map<string, string>();
    const rows = modelsQuery.data?.pages.flatMap((p) => p.items) ?? [];
    for (const r of rows) {
      const name = String((r.fields as any)?.model ?? "").trim();
      if (r.id && name) map.set(String(r.id), name);
    }
    return map;
  }, [modelsQuery.data]);

  // Hop 1 of the join: Staff record id (and, as a fallback, normalised Full Name)
  // -> { name, model }. Staff.Model is itself a LINKED_RECORD into Models, so the
  // model name comes either straight off the link or via modelNameById.
  const staffIndex = useMemo(() => {
    const byId = new Map<string, { name: string; model: string }>();
    const byName = new Map<string, { name: string; model: string }>();
    const rows = staffQuery.data?.pages.flatMap((p) => p.items) ?? [];
    for (const r of rows) {
      const f = r.fields as any;
      const name = String(f?.name ?? "").trim();
      const links = linkEntries(f?.model);
      const first = links[0];
      const model = first
        ? first.name || modelNameById.get(first.id) || ""
        : "";
      const entry = { name, model };
      if (r.id) byId.set(String(r.id), entry);
      if (name) byName.set(name.toLowerCase(), entry);
    }
    return { byId, byName };
  }, [staffQuery.data, modelNameById]);

  const allPayRows: PayRow[] = useMemo(() => {
    const rows = payQuery.data?.pages.flatMap((p) => p.items) ?? [];
    return rows.map((r) => {
      const f = r.fields as any;
      const links = linkEntries(f?.staff);
      const first = links[0];
      const fromId = first?.id ? staffIndex.byId.get(first.id) : undefined;
      const fromName = first?.name
        ? staffIndex.byName.get(first.name.toLowerCase())
        : undefined;
      const resolved = fromId ?? fromName;
      const staffName = (first?.name || resolved?.name || "").trim();
      const d = toDate(f?.workDate);
      return {
        id: r.id,
        date: d,
        monthKey: d ? monthKey(d) : "",
        staff: staffName,
        model: resolved?.model ?? "",
        hours: num(f?.hours),
        pay: num(f?.totalPay),
        status: label(f?.status),
      };
    });
  }, [payQuery.data, staffIndex]);

  // ---- summary strip (driven by the period selector)
  const opsTotal = useMemo(() => {
    const rows = expensesQuery.data?.pages.flatMap((p) => p.items) ?? [];
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const f = r.fields as any;
      const d = toDate(f?.date);
      if (!inRange(d, start, end)) continue;
      sum += num(f?.amount);
      n += 1;
    }
    return { sum, n };
  }, [expensesQuery.data, start, end]);

  const wagesTotal = useMemo(() => {
    let sum = 0;
    let n = 0;
    let hours = 0;
    for (const r of allPayRows) {
      if (!inRange(r.date, start, end)) continue;
      sum += r.pay;
      hours += r.hours;
      n += 1;
    }
    return { sum, n, hours };
  }, [allPayRows, start, end]);

  // ---- table set: period window first, then the chips
  const periodPayRows = useMemo(
    () => allPayRows.filter((r) => inRange(r.date, start, end)),
    [allPayRows, start, end],
  );

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of periodPayRows) if (r.monthKey) set.add(r.monthKey);
    return Array.from(set).sort().reverse();
  }, [periodPayRows]);

  const staffOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of periodPayRows) if (r.staff) set.add(r.staff);
    return Array.from(set).sort();
  }, [periodPayRows]);

  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of periodPayRows) if (r.model) set.add(r.model);
    return Array.from(set).sort();
  }, [periodPayRows]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of periodPayRows) if (r.status) set.add(r.status);
    return Array.from(set).sort();
  }, [periodPayRows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodPayRows.filter((r) => {
      if (monthFilter !== "all" && r.monthKey !== monthFilter) return false;
      if (staffFilter !== "all" && r.staff !== staffFilter) return false;
      if (modelFilter === "__unassigned") {
        if (r.model) return false;
      } else if (modelFilter !== "all" && r.model !== modelFilter) {
        return false;
      }
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (term) {
        const hay = [
          r.staff,
          r.model || "Unassigned",
          r.status,
          dayLabel(r.date),
          r.monthKey,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [
    periodPayRows,
    monthFilter,
    staffFilter,
    modelFilter,
    statusFilter,
    search,
  ]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date")
        cmp = (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0);
      else if (sortKey === "hours") cmp = a.hours - b.hours;
      else if (sortKey === "pay") cmp = a.pay - b.pay;
      else if (sortKey === "staff") cmp = a.staff.localeCompare(b.staff);
      else if (sortKey === "model")
        cmp = (a.model || "Unassigned").localeCompare(b.model || "Unassigned");
      else cmp = a.status.localeCompare(b.status);
      return cmp * dir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const sliceStart = (currentPage - 1) * pageSize;
  const visible = sorted.slice(sliceStart, sliceStart + pageSize);

  const filteredHours = useMemo(
    () => filtered.reduce((s, r) => s + r.hours, 0),
    [filtered],
  );
  const filteredPay = useMemo(
    () => filtered.reduce((s, r) => s + r.pay, 0),
    [filtered],
  );

  const unassignedCount = useMemo(
    () => periodPayRows.filter((r) => !r.model).length,
    [periodPayRows],
  );

  const filtersActive =
    monthFilter !== "all" ||
    staffFilter !== "all" ||
    modelFilter !== "all" ||
    statusFilter !== "all" ||
    search.trim() !== "";

  // reset to page 1 whenever the working set changes
  useEffect(() => {
    setPage(1);
  }, [
    monthFilter,
    staffFilter,
    modelFilter,
    statusFilter,
    search,
    pageSize,
    period,
  ]);

  const resetFilters = () => {
    setMonthFilter("all");
    setStaffFilter("all");
    setModelFilter("all");
    setStatusFilter("all");
    setSearch("");
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(
        key === "date" || key === "hours" || key === "pay" ? "desc" : "asc",
      );
    }
  };

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? null : sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );

  const periodLabel =
    PERIODS.find((p) => p.value === period)?.label ?? "All time";

  const combined = opsTotal.sum + wagesTotal.sum;

  if (failed) return <div role="alert" className="p-6 text-destructive">Cost records could not be fully loaded. Totals are unavailable. <Button onClick={() => { expensesQuery.refetch(); payQuery.refetch(); staffQuery.refetch(); modelsQuery.refetch(); }}>Retry all data</Button></div>;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        {/* ---------------------------------------------- summary strip */}
        <Card className="w-full overflow-hidden">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Total cost base
              </h2>
              <p className="text-sm text-muted-foreground">
                Everything this operation spends, in one place — the source of
                truth for the P&amp;L. Compare the same dates: the live P&amp;L defaults to this month; this page defaults to all time. Recorded operational expenses include every status; the P&amp;L deducts paid operational expenses and all staff wages, with model payouts separately.
              </p>
            </div>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                <CalendarDays className="h-3.5 w-3.5 opacity-60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Receipt className="h-4 w-4 opacity-70" />
                  Operational expenses
                </div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">
                  {loading ? "—" : money(opsTotal.sum)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {loading
                    ? "Loading…"
                    : `${opsTotal.n} row${opsTotal.n === 1 ? "" : "s"} · ${periodLabel}`}
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 opacity-70" />
                  Staff wages
                </div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">
                  {loading ? "—" : money(wagesTotal.sum)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {loading
                    ? "Loading…"
                    : `${wagesTotal.n} timesheet row${wagesTotal.n === 1 ? "" : "s"} · ${wagesTotal.hours.toFixed(2)} h`}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sigma className="h-4 w-4 opacity-70" />
                  Total cost base
                </div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">
                  {loading ? "—" : money(combined)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Operational expenses + staff wages
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Operational expenses are entered by hand in the Expense Log on this
              page; staff wages sync automatically from the Pay &amp; Hours page
              and cannot be edited here.
            </p>

            {failed && (
              <p className="text-xs text-destructive">
                One or more data sources failed to load — the figures above may
                be incomplete.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---------------------------------------------- staff wages table */}
        <Card className="w-full overflow-hidden">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Staff wages
                  </h2>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                    {totalRows}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Live mirror of the Pay Log timesheets. Wages are entered on the
                  Pay &amp; Hours page and appear here automatically — there is
                  nothing to add or edit on this table.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                Read only
              </span>
            </div>

            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Calendar className="h-3.5 w-3.5 opacity-60" />
                  <span>
                    Month
                    {monthFilter !== "all" ? `: ${monthLabel(monthFilter)}` : ""}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All months</SelectItem>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={staffFilter} onValueChange={setStaffFilter}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Users className="h-3.5 w-3.5 opacity-60" />
                  <span>
                    Staff{staffFilter !== "all" ? `: ${staffFilter}` : ""}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff</SelectItem>
                  {staffOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5 opacity-60" />
                  <span>
                    Model
                    {modelFilter === "__unassigned"
                      ? ": Unassigned"
                      : modelFilter !== "all"
                        ? `: ${modelFilter}`
                        : ""}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All models</SelectItem>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                  <SelectItem value="__unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <CircleDot className="h-3.5 w-3.5 opacity-60" />
                  <span>
                    Payment{statusFilter !== "all" ? `: ${statusFilter}` : ""}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs"
                  onClick={resetFilters}
                >
                  <X className="h-3.5 w-3.5" />
                  Reset
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search wages…"
                    className="h-8 w-[200px] pl-8 text-sm lg:w-[260px]"
                  />
                </div>
              </div>
            </div>

            {!loading && unassignedCount > 0 && (
              <p className="text-xs text-amber-600">
                {unassignedCount} of {periodPayRows.length} timesheet row
                {periodPayRows.length === 1 ? "" : "s"} cannot be attributed to a
                model — the staff member has no Model set on Staff.
              </p>
            )}
          </CardHeader>

          <CardContent className="p-0">
            <div className="relative w-full overflow-auto max-h-[70vh] border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("date")}
                      >
                        <Calendar className="h-3 w-3 opacity-60" />
                        Work Date
                        {sortIcon("date")}
                      </button>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("staff")}
                      >
                        <User className="h-3 w-3 opacity-60" />
                        Staff
                        {sortIcon("staff")}
                      </button>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("model")}
                      >
                        <Sparkles className="h-3 w-3 opacity-60" />
                        Model
                        {sortIcon("model")}
                      </button>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("hours")}
                      >
                        <Hash className="h-3 w-3 opacity-60" />
                        Hours Worked
                        {sortIcon("hours")}
                      </button>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("pay")}
                      >
                        <DollarSign className="h-3 w-3 opacity-60" />
                        Total Pay
                        {sortIcon("pay")}
                      </button>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("status")}
                      >
                        <CircleDot className="h-3 w-3 opacity-60" />
                        Payment Status
                        {sortIcon("status")}
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-32 text-center text-sm text-muted-foreground"
                      >
                        Loading timesheets…
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="h-40">
                        <div className="flex flex-col items-center justify-center gap-2 text-center">
                          <Inbox className="h-6 w-6 text-muted-foreground/60" />
                          <p className="text-sm text-muted-foreground">
                            {filtersActive
                              ? "No wage rows match these filters."
                              : "No wage rows in this period."}
                          </p>
                          {filtersActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={resetFilters}
                            >
                              <X className="h-3.5 w-3.5" />
                              Clear filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading &&
                    visible.map((r) => (
                      <TableRow
                        key={r.id}
                        className="h-12 border-b transition-colors hover:bg-muted/40"
                      >
                        <TableCell className="px-3 py-2 text-sm tabular-nums whitespace-nowrap">
                          {r.date ? (
                            dayLabel(r.date)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm">
                          {r.staff ? (
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                                {initialsOf(r.staff)}
                              </span>
                              <span className="font-medium">{r.staff}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm">
                          {r.model ? (
                            <Badge
                              variant="secondary"
                              className="rounded-md font-normal"
                            >
                              {r.model}
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Unassigned
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                          {r.hours.toFixed(2)}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                          {money(r.pay)}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm whitespace-nowrap">
                          {r.status ? (
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              <span
                                className={
                                  "h-1.5 w-1.5 rounded-full " +
                                  statusTone(r.status)
                                }
                              />
                              {r.status}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>

            {/* totals for the filtered set */}
            <div className="flex flex-wrap items-center gap-4 border-t px-3 py-2 text-sm text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 opacity-60" />
                Total hours {failed?"—":loading?"…":filteredHours.toFixed(2)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 opacity-60" />
                Total pay {failed?"—":loading?"…":money(filteredPay)}
              </span>
              <span className="text-muted-foreground/70">
                across {totalRows} filtered row{totalRows === 1 ? "" : "s"}
              </span>
            </div>

            {/* footer */}
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Rows per page
                </span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => setPageSize(Number(v))}
                >
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground tabular-nums">
                {totalRows === 0
                  ? "0 rows"
                  : `${sliceStart + 1}–${Math.min(sliceStart + pageSize, totalRows)} of ${totalRows} rows`}
              </div>

              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageNumbers(currentPage, totalPages).map((p, i) =>
                  typeof p === "number" ? (
                    <Button
                      key={`p${p}`}
                      variant={p === currentPage ? "default" : "ghost"}
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ) : (
                    <span
                      key={`e${i}`}
                      className="px-1 text-xs text-muted-foreground"
                    >
                      …
                    </span>
                  ),
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

