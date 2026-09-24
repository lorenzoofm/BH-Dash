"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  datasource,
  q,
  useRecords,
  useFieldOptions,
  useRecordCreate,
  useRecordUpdate,
  useRecordDelete,
} from "@/lib/datasource";
import { useCurrentUser } from "@/lib/user";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  AlignLeft,
  Calendar,
  Check,
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
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Split,
  Sparkles,
  Store,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

/* ------------------------------------------------------------ datasources */
// Recompiled a second time with no code change, deliberately — done again on
// 6 Sept after the category combobox went in: a block compiled straight after an
// Airtable schema read can silently drop a field from its compiled select map,
// and the second pass is what proves the field list the runtime actually got is
// the field list this file asks for.
// Airtable "20MG Operations" (app0OseEBbAAAU6xt). fieldReferenceKey is "name",
// so every q.select below addresses fields by NAME, not by field id.
const ds = datasource.define({
  expenses: "expenses",
  models: "models",
});

/* PAID DATE IS DELIBERATELY ABSENT from every select and every write map on
   this block (Lorenzo, 6 Sept: "one date, not two"). The Airtable field
   `Paid Date` fldt0gTEVSQgLiUrH still exists and still holds whatever it held —
   it is hidden from the UI, not deleted, so it stays recoverable. Because it is
   not in the write map either, no save on this page can ever blank it.
   `Expense Date` is now the single date. The P&L's Paid-only rule keys off
   Status, never off a date, so nothing downstream depends on Paid Date. */
const expenseSelect = q.select({
  expenseId: "Expense ID",
  expenseDate: "Expense Date",
  description: "Description",
  amount: "Amount",
  currency: "Currency",
  category: "Category",
  channel: "Channel",
  model: "Model",
  vendor: "Vendor",
  billingType: "Billing Type",
  status: "Status",
  notes: "Notes",
  createdBy: "Created By",
  sourceRef: "Source Ref",
});

const expenseFields = q.select({
  expenseId: "Expense ID",
  expenseDate: "Expense Date",
  description: "Description",
  amount: "Amount",
  currency: "Currency",
  category: "Category",
  channel: "Channel",
  model: "Model",
  vendor: "Vendor",
  billingType: "Billing Type",
  status: "Status",
  notes: "Notes",
  createdBy: "Created By",
  sourceRef: "Source Ref",
});

const paidFields = q.select({
  status: "Status",
});

const modelSelect = q.select({
  model: "Model",
});

const ALL = "__all__";
const NONE = "__none__";

// Read verbatim from the Airtable connect response. Every SELECT has
// allowToAddNewChoice: true, so a string that is not one of these silently
// creates a new Airtable choice. These are the fallbacks used when the live
// option fetch has not resolved yet; never invent a value outside them.
const CURRENCY_CHOICES = ["USD", "GBP", "EUR", "AUD", "Other"];
const CATEGORY_CHOICES = [
  "Paid traffic",
  "Payroll",
  "Infrastructure",
  "Software",
  "Creative",
  "Influencer",
  "Organic growth",
  "Legal",
  "Other",
];
const BILLING_CHOICES = ["One-off", "Daily", "Weekly", "Monthly", "Annual"];
const STATUS_CHOICES = ["Planned", "Unpaid", "Paid"];

/* ---------------------------------------------------------------- helpers */

/** Airtable SELECT fields come back as { id, label }. Unwrap to the plain name. */
function selLabel(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

function txt(v: any): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

const REC_ID = /^rec[A-Za-z0-9]{14}$/;

type LinkEntry = { id: string; name: string };

/**
 * Airtable LINKED_RECORD fields read back as an array — of { id, name }
 * objects, of bare record ids, or (defensively) of bare display names.
 * Normalise all three shapes. Expense Log.Model is a MULTI link (Airtable
 * reports prefersSingleRecordLink: false), so the whole array matters now,
 * not just the first entry.
 */
function linkEntries(v: any): LinkEntry[] {
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
      const id = txt(o.id ?? o.recordId ?? "").trim();
      const name = txt(o.name ?? o.label ?? o.title ?? o.value ?? "").trim();
      if (id || name) out.push({ id, name });
    }
  }
  return out;
}

function toDate(v: any): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // Airtable date fields are ISO (yyyy-mm-dd, optionally with a time part).
  // Build a LOCAL date from the y/m/d parts so the day never shifts.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isoDay(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso(): string {
  return isoDay(new Date());
}

function displayDate(v: any): string {
  const d = toDate(v);
  if (!d) return "";
  return isoDay(d);
}

function monthKey(v: any): string {
  const d = toDate(v);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  if (!key) return "";
  const [y, m] = key.split("-");
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const idx = Number(m) - 1;
  return `${names[idx] ?? m} ${y}`;
}

/** Returns null when the amount is genuinely absent (not 0). */
function amountOf(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const s = String(v).replace(/[^0-9.\-]/g, "").trim();
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function money(n: number, currency: string): string {
  const code = (currency || "USD").toUpperCase();
  const safe = ["USD", "GBP", "EUR", "AUD"].includes(code) ? code : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

/**
 * `Expense ID` is the PRIMARY field of the Airtable table, so it can never be
 * blank. Lorenzo never types one: it is derived here, from the rows already
 * loaded, in a readable and lexicographically sortable shape —
 * EXP-YYYY-MM-NNN, where YYYY-MM is the expense's own month.
 *
 * The sequence is the highest number already used inside that month, plus one
 * (so an empty table yields EXP-YYYY-MM-001), and it is then advanced past any
 * id that is already taken, which covers a backdated row landing in a month
 * that already has entries. `existing` must be the full loaded set — this block
 * auto-pages to the end of the table before the Add button does anything.
 */
function nextExpenseId(existing: string[], when: Date): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const prefix = `EXP-${y}-${m}-`;
  const taken = new Set<string>();
  let max = 0;
  for (const raw of existing) {
    const s = txt(raw).trim().toUpperCase();
    if (!s) continue;
    taken.add(s);
    if (!s.startsWith(prefix)) continue;
    const tail = s.slice(prefix.length).replace(/[^0-9]/g, "");
    if (!tail) continue;
    const n = Number(tail);
    if (!isNaN(n) && n > max) max = n;
  }
  let n = max + 1;
  let candidate = prefix + String(n).padStart(3, "0");
  // Guard against a collision with an id that does not fit the max-plus-one
  // rule (a manually typed one, or a gap left by a deletion).
  while (taken.has(candidate.toUpperCase()) && n < 1000000) {
    n += 1;
    candidate = prefix + String(n).padStart(3, "0");
  }
  return candidate;
}

const STATUS_TONE: Record<string, string> = {
  Paid: "bg-emerald-500",
  Planned: "bg-amber-500",
  Unpaid: "bg-rose-500",
};

function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [];
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);
  if (start > 1) {
    out.push(1);
    if (start > 2) out.push("…");
  }
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total) {
    if (end < total - 1) out.push("…");
    out.push(total);
  }
  return out;
}

/**
 * Live options first (so a choice added in Airtable shows up without a redeploy),
 * the verbatim Airtable choice list as a fallback while that resolves, then any
 * value actually present in the loaded rows. Never breaks on an empty option set.
 */
function mergeChoices(live: any[] | undefined, fallback: string[], extra: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: any) => {
    const l = txt(raw).trim();
    if (l && !seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  };
  for (const o of live ?? []) push((o as any)?.label ?? (o as any)?.name);
  if (out.length === 0) for (const f of fallback) push(f);
  for (const e of extra) push(e);
  return out;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

type SortKey = "expenseDate" | "amount" | "category" | "status";

type FormState = {
  expenseId: string;
  expenseDate: string;
  description: string;
  amount: string;
  currency: string;
  category: string;
  channel: string;
  modelIds: string[];
  vendor: string;
  billingType: string;
  status: string;
  notes: string;
  createdBy: string;
  sourceRef: string;
};

const EMPTY_FORM: FormState = {
  expenseId: "",
  expenseDate: "",
  description: "",
  amount: "",
  currency: "USD",
  category: "",
  channel: "",
  modelIds: [],
  vendor: "",
  billingType: "",
  status: "Unpaid",
  notes: "",
  createdBy: "",
  sourceRef: "",
};

/* ------------------------------------------------- multi-model chip picker */

type ModelOption = { id: string; name: string };

/**
 * One expense can belong to SEVERAL models (Lorenzo, 6 Sept). The picker shows
 * the chosen models as removable chips and opens a checkbox list; the value is
 * always an array of Airtable RECORD IDS, which is the only shape a
 * LINKED_RECORD write accepts.
 */
function ModelMultiSelect({
  value,
  options,
  nameById,
  onChange,
  placeholder = "Tag one or more models",
  triggerClassName = "",
  compact = false,
}: {
  value: string[];
  options: ModelOption[];
  nameById: Map<string, string>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  triggerClassName?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.name.toLowerCase().includes(t));
  }, [options, term]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={
              "w-full justify-between gap-2 font-normal " +
              (compact ? "h-8 text-xs " : "") +
              triggerClassName
            }
          >
            <span className={value.length === 0 ? "text-muted-foreground" : ""}>
              {value.length === 0
                ? placeholder
                : `${value.length} model${value.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-0">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Find a model"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-auto p-1">
            {shown.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                {options.length === 0 ? "No models yet." : "No match."}
              </div>
            )}
            {shown.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
              >
                <Checkbox
                  checked={value.includes(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                />
                <span className="truncate">{o.name}</span>
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <div className="flex items-center justify-between border-t px-2 py-1.5">
              <span className="text-xs text-muted-foreground tabular-nums">
                {value.length} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onChange([])}
              >
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <Badge
              key={id}
              variant="secondary"
              className="gap-1 rounded-md pr-1 font-normal"
            >
              {nameById.get(id) ?? "Linked model"}
              <button
                type="button"
                aria-label={`Remove ${nameById.get(id) ?? "model"}`}
                className="rounded-sm opacity-60 hover:opacity-100"
                onClick={() => onChange(value.filter((v) => v !== id))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------- category combobox + guards */

/**
 * Fold case, punctuation and spacing away so "Paid Ads", "paid-ads" and
 * "  paid ads  " all collapse to one key. This is the check that stops
 * "Software", "software" and "Soft ware" becoming three Airtable choices:
 * the Category field has allowToAddNewChoice: true, so ANY string written to
 * it silently becomes a new choice, with no error anywhere.
 */
function catKey(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Levenshtein distance, capped: anything further than `max` edits away comes
 * back as max + 1, which is all a "is this a near-duplicate?" question needs.
 * Deliberately small and readable — nine short strings do not warrant a
 * fuzzy-matching dependency.
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * The closest existing choice to what was typed, or null when nothing is
 * close. One edit for short names, two for longer ones — so "Sofware" finds
 * "Software" and "Payrolls" finds "Payroll", while "Legal" never claims to be
 * "Creative". Exact-after-folding matches are handled separately and never
 * reach here.
 */
function nearestChoice(typed: string, choices: string[]): string | null {
  const t = catKey(typed);
  if (t.length < 4) return null;
  const limit = t.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestDist = limit + 1;
  for (const c of choices) {
    const d = editDistance(t, catKey(c), limit);
    if (d > 0 && d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Category picker. Lists the live choices, filters as you type, and — only as
 * a separate, explicit click — offers to create a new one. Typing and blurring
 * never create anything: that is the whole point, because a stray "Sofware"
 * would become a permanent Airtable choice and quietly split his reporting.
 *
 *  - a fold-equal match ("software" vs "Software") selects the existing choice
 *    and no create action is offered at all
 *  - a near match ("Sofware") shows "Did you mean Software?" with the existing
 *    choice as the primary action and creating as the quiet secondary one
 *  - anything genuinely new gets a plain "+ Create …" button
 */
function CategoryCombobox({
  value,
  choices,
  onChange,
  onCreate,
  onClose,
  autoOpen = false,
  compact = false,
  triggerClassName = "w-full",
  placeholder = "Select or add a category",
}: {
  value: string;
  choices: string[];
  onChange: (name: string) => void;
  onCreate: (name: string) => void;
  onClose?: () => void;
  autoOpen?: boolean;
  compact?: boolean;
  triggerClassName?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [term, setTerm] = useState("");

  const typed = term.trim();

  const sameAs = useMemo(() => {
    if (!typed) return null;
    const k = catKey(typed);
    return choices.find((c) => catKey(c) === k) ?? null;
  }, [choices, typed]);

  const near = useMemo(
    () => (typed && !sameAs ? nearestChoice(typed, choices) : null),
    [typed, sameAs, choices],
  );

  const shown = useMemo(() => {
    const t = typed.toLowerCase();
    if (!t) return choices;
    return choices.filter(
      (c) => c.toLowerCase().includes(t) || c === sameAs || c === near,
    );
  }, [choices, typed, sameAs, near]);

  // Nothing to create when what he typed is an existing category wearing a
  // different case or a stray hyphen.
  const canCreate = typed !== "" && !sameAs;

  function close() {
    setOpen(false);
    setTerm("");
    onClose?.();
  }

  function pick(name: string) {
    onChange(name);
    close();
  }

  function create(name: string) {
    onCreate(name);
    close();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setOpen(true);
        else close();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={
            "justify-between gap-2 font-normal " +
            (compact ? "h-8 text-xs " : "") +
            triggerClassName
          }
        >
          <span className={"truncate " + (value ? "" : "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[272px] p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // Enter can only land on a category that already exists.
                  // Creating one is always its own deliberate click.
                  if (sameAs) pick(sameAs);
                  else if (shown.length === 1) pick(shown[0]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
              }}
              placeholder="Find a category, or type a new one"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        <div className="max-h-52 overflow-auto p-1">
          <button
            type="button"
            onClick={() => pick("")}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60"
          >
            No category
            {value === "" && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {shown.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pick(c)}
              className={
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 " +
                (c === sameAs || c === near ? "bg-muted/60" : "")
              }
            >
              <span className="truncate">{c}</span>
              {value === c && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
          {shown.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No category matches that.
            </div>
          )}
        </div>

        {typed !== "" && (
          <div className="space-y-2 border-t p-2">
            {sameAs && sameAs !== typed && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{sameAs}</span>{" "}
                already exists — selecting it, rather than adding a second
                spelling.
              </p>
            )}

            {near && (
              <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-2">
                <p className="text-xs text-amber-900">
                  Did you mean{" "}
                  <span className="font-semibold">{near}</span>?
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => pick(near)}
                >
                  Use “{near}”
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs text-muted-foreground"
                  onClick={() => create(typed)}
                >
                  No — create “{typed}”
                </Button>
              </div>
            )}

            {canCreate && !near && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full justify-start gap-1.5 text-xs"
                onClick={() => create(typed)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create “{typed}”
              </Button>
            )}
          </div>
        )}

        <div className="border-t px-2 py-1.5">
          <p className="text-[11px] text-muted-foreground">
            Categories are renamed or removed in Airtable.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------------------------------------------------- inline text editor */

/**
 * Enter or blur commits, Escape cancels. `done` makes sure the two commit
 * paths cannot both fire — Escape blurs the input, which would otherwise
 * immediately re-commit the value Escape just discarded.
 */
function InlineInput({
  initial,
  type,
  className,
  onCommit,
  onCancel,
}: {
  initial: string;
  type?: string;
  className?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  return (
    <Input
      autoFocus
      type={type}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (done.current) return;
          done.current = true;
          onCommit(v);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (done.current) return;
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (done.current) return;
        done.current = true;
        onCommit(v);
      }}
      className={"h-8 text-sm " + (className ?? "")}
    />
  );
}

/* ------------------------------------------------------------------ block */

type InlineField =
  | "description"
  | "amount"
  | "category"
  | "channel"
  | "vendor"
  | "model"
  | "status"
  | "expenseDate";

type CellState = {
  status: "saving" | "saved" | "error";
  message?: string;
  // What the user typed. Held so a failed save still shows the value he meant,
  // clearly marked, instead of silently snapping back to the stored one.
  display?: string;
  models?: string[];
};

export default function Block() {
  const user = useCurrentUser();

  const {
    data,
    status,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useRecords({
    from: ds.expenses,
    select: expenseSelect,
    count: 100,
    orderBy: q.desc("expenseDate"),
  });

  // Auto-page until every expense row is loaded — aggregates must cover them
  // all, and so must the Expense ID sequence.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const modelsQuery = useRecords({
    from: ds.models,
    select: modelSelect,
    count: 100,
  });

  useEffect(() => {
    if (modelsQuery.hasNextPage && !modelsQuery.isFetchingNextPage) {
      modelsQuery.fetchNextPage();
    }
  }, [modelsQuery.hasNextPage, modelsQuery.isFetchingNextPage, modelsQuery.fetchNextPage]);

  const currencyOptions = useFieldOptions({
    from: ds.expenses,
    select: expenseSelect,
    field: "currency",
  });
  const categoryOptions = useFieldOptions({
    from: ds.expenses,
    select: expenseSelect,
    field: "category",
  });
  const billingOptions = useFieldOptions({
    from: ds.expenses,
    select: expenseSelect,
    field: "billingType",
  });
  const statusOptions = useFieldOptions({
    from: ds.expenses,
    select: expenseSelect,
    field: "status",
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  // Categories Lorenzo has explicitly created in this session. Held so a brand
  // new one is offered everywhere — the filter chip, both pickers — from the
  // moment he creates it, rather than only after the row it belongs to has
  // been saved and refetched. Once that round trip completes the name arrives
  // from the datasource anyway and this set stops mattering.
  const [newCats, setNewCats] = useState<string[]>([]);
  // The one just created from the add/edit form, so the form can say so.
  const [formNewCat, setFormNewCat] = useState<string | null>(null);

  function registerNewCategory(name: string) {
    const n = name.trim();
    if (!n) return;
    setNewCats((prev) => (prev.some((c) => c === n) ? prev : [...prev, n]));
  }

  const [search, setSearch] = useState("");
  const [fMonth, setFMonth] = useState(ALL);
  const [fModel, setFModel] = useState(ALL);
  const [fChannel, setFChannel] = useState(ALL);
  const [fCategory, setFCategory] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("expenseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ---- inline editing state ----
  const [editCell, setEditCell] = useState<{ rowId: string; field: InlineField } | null>(null);
  const [inlineModels, setInlineModels] = useState<string[]>([]);
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});

  const createRecord = useRecordCreate({
    from: ds.expenses,
    fields: expenseFields,
    onSuccess: async () => {
      await refetch();
      toast.success("Expense added");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not add the expense"),
  });

  const updateRecord = useRecordUpdate({
    from: ds.expenses,
    fields: expenseFields,
    onSuccess: async () => {
      await refetch();
      toast.success("Expense updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update the expense"),
  });

  // A separate update hook for the grid, so a cell save never fires the
  // dialog's toast and never fights the dialog's own pending state.
  const inlineUpdate = useRecordUpdate({
    from: ds.expenses,
    fields: expenseFields,
  });

  const markPaid = useRecordUpdate({
    from: ds.expenses,
    fields: paidFields,
    onSuccess: async () => {
      await refetch();
      toast.success("Marked as paid");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark as paid"),
  });

  const deleteRecord = useRecordDelete({
    from: ds.expenses,
    onSuccess: async () => {
      await refetch();
      toast.success("Expense deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete the expense"),
  });

  /* ------------------------------------------------------------- models */

  // The Models table is the only source of model identity. Expense Log.Model is
  // a multi-value LINKED_RECORD: read it as an array, write it as an array of
  // record ids.
  const modelRecords = useMemo(() => {
    const items = modelsQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
    const out: ModelOption[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const id = txt(it.id).trim();
      const name = txt(it.fields?.model).trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [modelsQuery.data]);

  const modelNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of modelRecords) m.set(r.id, r.name);
    return m;
  }, [modelRecords]);

  const modelIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of modelRecords) m.set(r.name.toLowerCase(), r.id);
    return m;
  }, [modelRecords]);

  /* --------------------------------------------------------------- rows */

  const rows = useMemo(() => {
    const items = data?.pages.flatMap((p: any) => p.items) ?? [];
    return items.map((it: any) => {
      const f = it.fields ?? {};
      const links = linkEntries(f.model);
      const modelIds: string[] = [];
      const modelNames: string[] = [];
      for (const l of links) {
        const id = l.id || modelIdByName.get(l.name.toLowerCase()) || "";
        const name = l.name || modelNameById.get(l.id) || "";
        if (id && !modelIds.includes(id)) modelIds.push(id);
        if (name && !modelNames.includes(name)) modelNames.push(name);
      }
      return {
        id: it.id,
        expenseId: txt(f.expenseId),
        expenseDate: f.expenseDate,
        dateObj: toDate(f.expenseDate),
        month: monthKey(f.expenseDate),
        description: txt(f.description),
        amount: amountOf(f.amount),
        currency: selLabel(f.currency) || "USD",
        category: selLabel(f.category),
        channel: txt(f.channel),
        modelIds,
        models: modelNames,
        vendor: txt(f.vendor),
        billingType: selLabel(f.billingType),
        statusLabel: selLabel(f.status),
        notes: txt(f.notes),
        createdBy: txt(f.createdBy),
        sourceRef: txt(f.sourceRef),
      };
    });
  }, [data, modelNameById, modelIdByName]);

  const loadingAll = status === "pending" || hasNextPage || isFetchingNextPage;

  const catalogModels = useMemo(
    () => modelRecords.map((r) => r.name),
    [modelRecords],
  );

  const monthValues = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.month) set.add(r.month);
    return Array.from(set).sort().reverse();
  }, [rows]);

  const modelValues = useMemo(() => {
    const set = new Set<string>(catalogModels);
    for (const r of rows) for (const m of r.models) set.add(m);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, catalogModels]);

  const channelValues = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.channel) set.add(r.channel);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Live choices first (so a category added in Airtable, or by the combobox
  // below, shows up without a redeploy), the verbatim connect-response list as
  // the fallback while that resolves, then anything the loaded rows or this
  // session's newly created names carry. This is the single list behind the
  // filter chip, the form picker and the inline picker.
  const categoryValues = useMemo(
    () =>
      mergeChoices(
        categoryOptions.options,
        CATEGORY_CHOICES,
        [...rows.map((r) => r.category), ...newCats],
      ),
    [rows, categoryOptions.options, newCats],
  );

  const statusValues = useMemo(
    () =>
      mergeChoices(
        statusOptions.options,
        STATUS_CHOICES,
        rows.map((r) => r.statusLabel),
      ),
    [rows, statusOptions.options],
  );

  const currencyChoices = useMemo(
    () => mergeChoices(currencyOptions.options, CURRENCY_CHOICES, []),
    [currencyOptions.options],
  );

  const billingChoices = useMemo(
    () => mergeChoices(billingOptions.options, BILLING_CHOICES, []),
    [billingOptions.options],
  );

  const filtersActive =
    search.trim() !== "" ||
    fMonth !== ALL ||
    fModel !== ALL ||
    fChannel !== ALL ||
    fCategory !== ALL ||
    fStatus !== ALL;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (fMonth !== ALL && r.month !== fMonth) return false;
      if (fModel !== ALL) {
        if (fModel === NONE) {
          if (r.models.length !== 0) return false;
        } else if (!r.models.includes(fModel)) return false;
      }
      if (fChannel !== ALL) {
        if (fChannel === NONE ? r.channel !== "" : r.channel !== fChannel) return false;
      }
      if (fCategory !== ALL) {
        if (fCategory === NONE ? r.category !== "" : r.category !== fCategory) return false;
      }
      if (fStatus !== ALL) {
        if (fStatus === NONE ? r.statusLabel !== "" : r.statusLabel !== fStatus) return false;
      }
      if (term) {
        const hay = `${r.description} ${r.vendor} ${r.channel} ${r.expenseId} ${r.models.join(" ")}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, fMonth, fModel, fChannel, fCategory, fStatus]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const copy = filtered.slice();
    copy.sort((a, b) => {
      if (sortKey === "expenseDate") {
        const av = a.dateObj ? a.dateObj.getTime() : -Infinity;
        const bv = b.dateObj ? b.dateObj.getTime() : -Infinity;
        if (av !== bv) return (av - bv) * dir;
      } else if (sortKey === "amount") {
        const av = a.amount === null ? -Infinity : a.amount;
        const bv = b.amount === null ? -Infinity : b.amount;
        if (av !== bv) return (av - bv) * dir;
      } else if (sortKey === "category") {
        const c = a.category.localeCompare(b.category);
        if (c !== 0) return c * dir;
      } else {
        const c = a.statusLabel.localeCompare(b.statusLabel);
        if (c !== 0) return c * dir;
      }
      return a.expenseId.localeCompare(b.expenseId) * dir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const firstRow = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, sorted.length);

  const totals = useMemo(() => {
    let sum = 0;
    let missing = 0;
    let untagged = 0;
    let split = 0;
    const byStatus: Record<string, number> = {};
    const currencies = new Set<string>();
    for (const r of filtered) {
      if (r.amount === null) missing += 1;
      else {
        sum += r.amount;
        currencies.add(r.currency);
      }
      if (r.models.length === 0) untagged += 1;
      if (r.models.length > 1) split += 1;
      const key = r.statusLabel || "No status";
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    return {
      sum,
      missing,
      untagged,
      split,
      byStatus,
      mixed: currencies.size > 1,
      currency: currencies.size === 1 ? Array.from(currencies)[0] : "USD",
    };
  }, [filtered]);

  /* ------------------------------------------------------------ handlers */

  function resetFilters() {
    setSearch("");
    setFMonth(ALL);
    setFModel(ALL);
    setFChannel(ALL);
    setFCategory(ALL);
    setFStatus(ALL);
    setPage(1);
  }

  function changeFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "expenseDate" || key === "amount" ? "desc" : "asc");
    }
    setPage(1);
  }

  function openAdd() {
    setEditingId(null);
    setFormNewCat(null);
    // No Expense ID here on purpose: it is generated at save time from the rows
    // as they stand then, so two dialogs opened back to back cannot both claim
    // the same number.
    setForm({
      ...EMPTY_FORM,
      expenseDate: todayIso(),
      createdBy: txt(user?.email),
    });
    setDialogOpen(true);
  }

  function openEdit(row: any) {
    setEditingId(row.id);
    setFormNewCat(null);
    setForm({
      expenseId: row.expenseId,
      expenseDate: displayDate(row.expenseDate),
      description: row.description,
      amount: row.amount === null ? "" : String(row.amount),
      currency: row.currency || "USD",
      category: row.category,
      channel: row.channel,
      modelIds: row.modelIds,
      vendor: row.vendor,
      billingType: row.billingType,
      status: row.statusLabel,
      notes: row.notes,
      createdBy: row.createdBy,
      sourceRef: row.sourceRef,
    });
    setDialogOpen(true);
  }

  // Airtable write rules: numbers as real numbers, dates as ISO strings, SELECTs
  // as the plain choice name, LINKED_RECORD as an array of record ids. A typed
  // field is cleared with null — "" is rejected. Paid Date is not written at
  // all, so the hidden Airtable value is preserved untouched.
  function buildPayload(expenseId: string) {
    const amt = form.amount.trim();
    return {
      expenseId,
      expenseDate: form.expenseDate || null,
      description: form.description,
      amount: amt === "" ? null : Number(amt),
      currency: form.currency || null,
      category: form.category || null,
      channel: form.channel,
      model: form.modelIds,
      vendor: form.vendor,
      billingType: form.billingType || null,
      status: form.status || null,
      notes: form.notes,
      createdBy: form.createdBy,
      sourceRef: form.sourceRef,
    } as any;
  }

  function submitForm() {
    if (!form.description.trim()) {
      toast.error("Description is required");
      return;
    }
    if (form.amount.trim() !== "" && isNaN(Number(form.amount.trim()))) {
      toast.error("Amount must be a number");
      return;
    }
    const when = toDate(form.expenseDate) ?? new Date();
    // The primary field can never be blank: an existing row keeps its id, a new
    // one (or a legacy row that somehow has none) gets a freshly derived one.
    const expenseId =
      form.expenseId.trim() || nextExpenseId(rows.map((r) => r.expenseId), when);
    const payload = buildPayload(expenseId);
    if (editingId) {
      if (!updateRecord.enabled) return;
      updateRecord.mutate({ recordId: editingId, fields: payload });
    } else {
      if (!createRecord.enabled) return;
      createRecord.mutate(payload);
    }
    setDialogOpen(false);
  }

  function onMarkPaid(row: any) {
    if (!markPaid.enabled) return;
    // Status only. Paid Date is no longer part of this block's UI or its write
    // map — the P&L keys off Status, not off a date.
    markPaid.mutate({
      recordId: row.id,
      fields: { status: "Paid" } as any,
    });
  }

  function confirmDelete() {
    if (!deleteTarget || !deleteRecord.enabled) return;
    deleteRecord.mutate(deleteTarget.id);
    setDeleteTarget(null);
  }

  const saving = createRecord.status === "pending" || updateRecord.status === "pending";

  /* -------------------------------------------------------- inline saves */

  const cellKey = (rowId: string, field: InlineField) => `${rowId}:${field}`;

  function setCell(rowId: string, field: InlineField, s: CellState | null) {
    setCellStates((prev) => {
      const next = { ...prev };
      const k = cellKey(rowId, field);
      if (s === null) delete next[k];
      else next[k] = s;
      return next;
    });
  }

  function isEditing(rowId: string, field: InlineField) {
    return editCell?.rowId === rowId && editCell?.field === field;
  }

  function startEdit(row: any, field: InlineField) {
    if (!inlineUpdate.enabled) return;
    if (field === "model") setInlineModels(row.modelIds);
    setEditCell({ rowId: row.id, field });
  }

  function cancelEdit() {
    setEditCell(null);
  }

  /**
   * The single write path for the grid. It always ends in one of three visible
   * outcomes — saving, saved, or a persistent error the row keeps carrying
   * until it is retried — so a half-applied edit can never sit there silently.
   */
  async function commitCell(
    row: any,
    field: InlineField,
    fields: Record<string, any>,
    display: string,
    models?: string[],
  ): Promise<boolean> {
    setEditCell(null);
    if (!inlineUpdate.enabled) return false;
    setCell(row.id, field, { status: "saving", display, models });
    try {
      await inlineUpdate.mutateAsync({ recordId: row.id, fields: fields as any });
      await refetch();
      setCell(row.id, field, { status: "saved", display, models });
      window.setTimeout(() => setCell(row.id, field, null), 2000);
      return true;
    } catch (e: any) {
      const message = e?.message ?? "Save failed";
      setCell(row.id, field, { status: "error", message, display, models });
      toast.error(`${row.expenseId || "Row"} — ${field} not saved: ${message}`);
      return false;
    }
  }

  /**
   * Category is the one inline field that can introduce a value the Airtable
   * field has never seen. `isNew` is true only when he clicked the explicit
   * create action, so the confirmation can never fire off a plain re-selection.
   */
  async function commitCategory(row: any, name: string, isNew = false) {
    if (isNew) registerNewCategory(name);
    if (name === row.category) {
      setEditCell(null);
      return;
    }
    const ok = await commitCell(row, "category", { category: name || null }, name);
    if (ok && isNew) {
      toast.success(
        `New category “${name}” created — it is now a real Airtable choice and shows up in the filter and the spend-by-category breakdown.`,
      );
    }
  }

  /** Maps one inline field + raw string to the Airtable write shape. */
  function buildInlineFields(field: InlineField, raw: string): Record<string, any> {
    switch (field) {
      case "description":
        return { description: raw };
      case "channel":
        return { channel: raw };
      case "vendor":
        return { vendor: raw };
      case "amount":
        return { amount: raw.trim() === "" ? null : Number(raw.trim()) };
      case "expenseDate":
        return { expenseDate: raw || null };
      case "category":
        return { category: raw || null };
      case "status":
        return { status: raw || null };
      default:
        return {};
    }
  }

  function retryCell(row: any, field: InlineField) {
    const st = cellStates[cellKey(row.id, field)];
    if (!st) return;
    if (field === "model") {
      commitCell(row, field, { model: st.models ?? [] }, "", st.models ?? []);
      return;
    }
    const v = st.display ?? "";
    commitCell(row, field, buildInlineFields(field, v), v);
  }

  function commitText(row: any, field: InlineField, raw: string, current: string) {
    if (raw === current) {
      setEditCell(null);
      return;
    }
    commitCell(row, field, buildInlineFields(field, raw), raw);
  }

  function commitAmount(row: any, raw: string) {
    const trimmed = raw.trim();
    const currentStr = row.amount === null ? "" : String(row.amount);
    if (trimmed === currentStr) {
      setEditCell(null);
      return;
    }
    if (trimmed !== "" && isNaN(Number(trimmed))) {
      setEditCell(null);
      toast.error("Amount must be a number — not saved");
      return;
    }
    commitCell(row, "amount", buildInlineFields("amount", trimmed), trimmed);
  }

  function commitModels(row: any, ids: string[]) {
    if (sameIds(ids, row.modelIds)) {
      setEditCell(null);
      return;
    }
    commitCell(row, "model", { model: ids }, "", ids);
  }

  /** Small saving / saved / failed marker rendered inside the edited cell. */
  function CellFlag({ row, field }: { row: any; field: InlineField }) {
    const st = cellStates[cellKey(row.id, field)];
    if (!st) return null;
    if (st.status === "saving") {
      return (
        <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          saving
        </span>
      );
    }
    if (st.status === "saved") {
      return (
        <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-[11px] text-emerald-600">
          <Check className="h-3 w-3" />
          saved
        </span>
      );
    }
    return (
      <button
        type="button"
        title={st.message}
        onClick={(e) => {
          e.stopPropagation();
          retryCell(row, field);
        }}
        className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
      >
        <TriangleAlert className="h-3 w-3" />
        not saved — retry
        <RotateCcw className="h-3 w-3" />
      </button>
    );
  }

  /** While a cell is saving or has failed, the value shown is what he typed. */
  function pendingText(row: any, field: InlineField, fallback: string): string {
    const st = cellStates[cellKey(row.id, field)];
    if (st && (st.status === "saving" || st.status === "error") && st.display !== undefined) {
      return st.display;
    }
    return fallback;
  }

  function pendingModels(row: any): string[] {
    const st = cellStates[cellKey(row.id, "model")];
    if (st && (st.status === "saving" || st.status === "error") && st.models) {
      return st.models;
    }
    return row.modelIds;
  }

  const unsavedCount = useMemo(
    () => Object.values(cellStates).filter((s) => s.status === "error").length,
    [cellStates],
  );

  /* ---------------------------------------------------------------- view */

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? null : sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );

  const headCls =
    "sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap";

  const editableCls =
    "cursor-text rounded-md px-1 -mx-1 hover:bg-muted/60 hover:ring-1 hover:ring-border";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        <Card className="w-full overflow-hidden rounded-xl border shadow-sm bg-card">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">Expense Log</h2>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                    {loadingAll ? "…" : sorted.length}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Every 20MG cost. Click a cell to edit it in place, or use Edit for
                  the full form. An expense can be tagged to several models — the P&amp;L
                  splits it evenly between them.
                </p>
              </div>
              {createRecord.enabled && (
                <Button size="sm" onClick={openAdd} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Add expense
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={fMonth} onValueChange={(v) => changeFilter(setFMonth, v)}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Calendar className="h-3.5 w-3.5 opacity-60" />
                  <SelectValue>
                    {fMonth === ALL ? "Month" : `Month: ${monthLabel(fMonth)}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All months</SelectItem>
                  {monthValues.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={fModel} onValueChange={(v) => changeFilter(setFModel, v)}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5 opacity-60" />
                  <SelectValue>
                    {fModel === ALL
                      ? "Model"
                      : `Model: ${fModel === NONE ? "Untagged" : fModel}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All models</SelectItem>
                  <SelectItem value={NONE}>Untagged</SelectItem>
                  {modelValues.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={fChannel} onValueChange={(v) => changeFilter(setFChannel, v)}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Store className="h-3.5 w-3.5 opacity-60" />
                  <SelectValue>
                    {fChannel === ALL
                      ? "Channel"
                      : `Channel: ${fChannel === NONE ? "None" : fChannel}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All channels</SelectItem>
                  <SelectItem value={NONE}>No channel</SelectItem>
                  {channelValues.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={fCategory} onValueChange={(v) => changeFilter(setFCategory, v)}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <Tag className="h-3.5 w-3.5 opacity-60" />
                  <SelectValue>
                    {fCategory === ALL
                      ? "Category"
                      : `Category: ${fCategory === NONE ? "None" : fCategory}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {categoryValues.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={fStatus} onValueChange={(v) => changeFilter(setFStatus, v)}>
                <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                  <CircleDot className="h-3.5 w-3.5 opacity-60" />
                  <SelectValue>
                    {fStatus === ALL
                      ? "Status"
                      : `Status: ${fStatus === NONE ? "None" : fStatus}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value={NONE}>No status</SelectItem>
                  {statusValues.map((s) => (
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
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search description, vendor, channel, ID, model"
                    className="h-8 w-[200px] lg:w-[260px] pl-8 text-sm"
                  />
                </div>
              </div>
            </div>

            {unsavedCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                <span>
                  {unsavedCount} inline edit{unsavedCount === 1 ? "" : "s"} did not
                  save. The cell keeps the value you typed and is marked in red —
                  click it to retry. Nothing was written to Airtable for those.
                </span>
              </div>
            )}
          </CardHeader>

          <CardContent className="p-0">
            <div className="relative w-full overflow-auto max-h-[70vh] border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={headCls}>
                      <span className="inline-flex items-center gap-1.5">
                        <Hash className="h-3 w-3 opacity-60" />
                        Expense ID
                      </span>
                    </TableHead>
                    <TableHead className={headCls}>
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("expenseDate")}
                      >
                        <Calendar className="h-3 w-3 opacity-60" />
                        Date
                        {sortIcon("expenseDate")}
                      </button>
                    </TableHead>
                    <TableHead className={headCls}>
                      <span className="inline-flex items-center gap-1.5">
                        <AlignLeft className="h-3 w-3 opacity-60" />
                        Description
                      </span>
                    </TableHead>
                    <TableHead className={headCls}>
                      <span className="inline-flex items-center gap-1.5">
                        <Store className="h-3 w-3 opacity-60" />
                        Vendor
                      </span>
                    </TableHead>
                    <TableHead className={headCls}>
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("category")}
                      >
                        <Tag className="h-3 w-3 opacity-60" />
                        Category
                        {sortIcon("category")}
                      </button>
                    </TableHead>
                    <TableHead className={headCls}>
                      <span className="inline-flex items-center gap-1.5">
                        <AlignLeft className="h-3 w-3 opacity-60" />
                        Channel
                      </span>
                    </TableHead>
                    <TableHead className={headCls}>
                      <span className="inline-flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 opacity-60" />
                        Model(s)
                      </span>
                    </TableHead>
                    <TableHead className={headCls + " text-right"}>
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("amount")}
                      >
                        <DollarSign className="h-3 w-3 opacity-60" />
                        Amount
                        {sortIcon("amount")}
                      </button>
                    </TableHead>
                    <TableHead className={headCls}>
                      <button
                        className="inline-flex items-center gap-1.5 hover:text-foreground"
                        onClick={() => toggleSort("status")}
                      >
                        <CircleDot className="h-3 w-3 opacity-60" />
                        Status
                        {sortIcon("status")}
                      </button>
                    </TableHead>
                    <TableHead className={headCls + " text-right"}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status === "pending" && (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="h-40 text-center text-sm text-muted-foreground"
                      >
                        Loading expenses…
                      </TableCell>
                    </TableRow>
                  )}

                  {status === "error" && (
                    <TableRow>
                      <TableCell colSpan={10} className="h-40 text-center text-sm text-destructive">
                        {(error as any)?.message ?? "Could not load the Expense Log."}
                      </TableCell>
                    </TableRow>
                  )}

                  {status === "success" && pageRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="h-40">
                        <div className="flex flex-col items-center justify-center gap-2 text-center">
                          <Inbox className="h-6 w-6 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            {filtersActive
                              ? "No expenses match these filters."
                              : "No expenses yet."}
                          </p>
                          {!filtersActive && (
                            <p className="text-xs text-muted-foreground/80">
                              Add the first one with “Add expense”.
                            </p>
                          )}
                          {filtersActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5"
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

                  {pageRows.map((r) => {
                    const shownModelIds = pendingModels(r);
                    const shownDate = pendingText(r, "expenseDate", displayDate(r.expenseDate));
                    const shownDesc = pendingText(r, "description", r.description);
                    const shownVendor = pendingText(r, "vendor", r.vendor);
                    const shownCategory = pendingText(r, "category", r.category);
                    const shownChannel = pendingText(r, "channel", r.channel);
                    const shownStatus = pendingText(r, "status", r.statusLabel);
                    const shownAmountRaw = pendingText(
                      r,
                      "amount",
                      r.amount === null ? "" : String(r.amount),
                    );
                    const shownAmount =
                      shownAmountRaw.trim() === "" || isNaN(Number(shownAmountRaw))
                        ? null
                        : Number(shownAmountRaw);
                    return (
                      <TableRow
                        key={r.id}
                        className="h-12 border-b transition-colors hover:bg-muted/40"
                      >
                        <TableCell className="px-3 py-2 text-sm font-medium tabular-nums whitespace-nowrap">
                          {r.expenseId || <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        {/* Date */}
                        <TableCell className="px-3 py-2 text-sm tabular-nums whitespace-nowrap">
                          {isEditing(r.id, "expenseDate") ? (
                            <InlineInput
                              initial={displayDate(r.expenseDate)}
                              type="date"
                              className="w-[150px] tabular-nums"
                              onCommit={(v) =>
                                commitText(r, "expenseDate", v, displayDate(r.expenseDate))
                              }
                              onCancel={cancelEdit}
                            />
                          ) : (
                            <span
                              className={editableCls}
                              onClick={() => startEdit(r, "expenseDate")}
                            >
                              {shownDate || <span className="text-muted-foreground">—</span>}
                              <CellFlag row={r} field="expenseDate" />
                            </span>
                          )}
                        </TableCell>

                        {/* Description */}
                        <TableCell className="px-3 py-2 text-sm">
                          {isEditing(r.id, "description") ? (
                            <InlineInput
                              initial={r.description}
                              className="w-[260px]"
                              onCommit={(v) => commitText(r, "description", v, r.description)}
                              onCancel={cancelEdit}
                            />
                          ) : (
                            <span
                              className={"block max-w-[280px] truncate " + editableCls}
                              title={shownDesc}
                              onClick={() => startEdit(r, "description")}
                            >
                              {shownDesc || <span className="text-muted-foreground">—</span>}
                              <CellFlag row={r} field="description" />
                            </span>
                          )}
                        </TableCell>

                        {/* Vendor */}
                        <TableCell className="px-3 py-2 text-sm">
                          {isEditing(r.id, "vendor") ? (
                            <InlineInput
                              initial={r.vendor}
                              className="w-[160px]"
                              onCommit={(v) => commitText(r, "vendor", v, r.vendor)}
                              onCancel={cancelEdit}
                            />
                          ) : (
                            <span className={editableCls} onClick={() => startEdit(r, "vendor")}>
                              {shownVendor || <span className="text-muted-foreground">—</span>}
                              <CellFlag row={r} field="vendor" />
                            </span>
                          )}
                        </TableCell>

                        {/* Category */}
                        <TableCell className="px-3 py-2 text-sm">
                          {isEditing(r.id, "category") ? (
                            <CategoryCombobox
                              autoOpen
                              compact
                              triggerClassName="w-[150px]"
                              placeholder="—"
                              value={r.category}
                              choices={categoryValues}
                              onChange={(name) => commitCategory(r, name)}
                              onCreate={(name) => commitCategory(r, name, true)}
                              onClose={cancelEdit}
                            />
                          ) : (
                            <span
                              className={"inline-flex items-center " + editableCls}
                              onClick={() => startEdit(r, "category")}
                            >
                              {shownCategory ? (
                                <Badge variant="secondary" className="rounded-md font-normal">
                                  {shownCategory}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              <CellFlag row={r} field="category" />
                            </span>
                          )}
                        </TableCell>

                        {/* Channel */}
                        <TableCell className="px-3 py-2 text-sm">
                          {isEditing(r.id, "channel") ? (
                            <InlineInput
                              initial={r.channel}
                              className="w-[150px]"
                              onCommit={(v) => commitText(r, "channel", v, r.channel)}
                              onCancel={cancelEdit}
                            />
                          ) : (
                            <span className={editableCls} onClick={() => startEdit(r, "channel")}>
                              {shownChannel || <span className="text-muted-foreground">—</span>}
                              <CellFlag row={r} field="channel" />
                            </span>
                          )}
                        </TableCell>

                        {/* Model(s) — several allowed, and the split is stated on the row */}
                        <TableCell className="px-3 py-2 text-sm">
                          {isEditing(r.id, "model") ? (
                            <div className="w-[220px] space-y-1.5">
                              <ModelMultiSelect
                                value={inlineModels}
                                options={modelRecords}
                                nameById={modelNameById}
                                onChange={setInlineModels}
                                compact
                                placeholder="Tag models"
                              />
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => commitModels(r, inlineModels)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={cancelEdit}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <span
                              className={"inline-flex flex-wrap items-center gap-1 " + editableCls}
                              onClick={() => startEdit(r, "model")}
                            >
                              {shownModelIds.length === 0 ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <TriangleAlert className="h-3 w-3 text-amber-500" />
                                  Unallocated
                                </span>
                              ) : (
                                shownModelIds.map((id) => (
                                  <Badge
                                    key={id}
                                    variant="secondary"
                                    className="rounded-md font-normal"
                                  >
                                    {modelNameById.get(id) ?? "Linked model"}
                                  </Badge>
                                ))
                              )}
                              {shownModelIds.length > 1 && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Split className="h-3 w-3" />
                                  split {shownModelIds.length} ways
                                  {shownAmount !== null &&
                                    ` · ${money(shownAmount / shownModelIds.length, r.currency)} each`}
                                </span>
                              )}
                              <CellFlag row={r} field="model" />
                            </span>
                          )}
                        </TableCell>

                        {/* Amount */}
                        <TableCell className="px-3 py-2 text-sm text-right tabular-nums whitespace-nowrap">
                          {isEditing(r.id, "amount") ? (
                            <InlineInput
                              initial={r.amount === null ? "" : String(r.amount)}
                              className="w-[110px] text-right tabular-nums"
                              onCommit={(v) => commitAmount(r, v)}
                              onCancel={cancelEdit}
                            />
                          ) : (
                            <span className={editableCls} onClick={() => startEdit(r, "amount")}>
                              {shownAmount === null ? (
                                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                                  <TriangleAlert className="h-3 w-3" />
                                  needs amount
                                </span>
                              ) : (
                                money(shownAmount, r.currency)
                              )}
                              <CellFlag row={r} field="amount" />
                            </span>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="px-3 py-2 text-sm whitespace-nowrap">
                          {isEditing(r.id, "status") ? (
                            <Select
                              defaultOpen
                              value={r.statusLabel || NONE}
                              onValueChange={(v) =>
                                commitText(r, "status", v === NONE ? "" : v, r.statusLabel)
                              }
                              onOpenChange={(o) => {
                                if (!o) cancelEdit();
                              }}
                            >
                              <SelectTrigger className="h-8 w-[130px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>—</SelectItem>
                                {statusValues.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className={editableCls} onClick={() => startEdit(r, "status")}>
                              {shownStatus ? (
                                <span className="inline-flex items-center gap-1.5 text-sm">
                                  <span
                                    className={
                                      "h-1.5 w-1.5 rounded-full " +
                                      (STATUS_TONE[shownStatus] ?? "bg-muted-foreground/40")
                                    }
                                  />
                                  {shownStatus}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              <CellFlag row={r} field="status" />
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="px-3 py-2 text-sm text-right">
                          <div className="flex items-center justify-end gap-1">
                            {markPaid.enabled && r.statusLabel !== "Paid" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                onClick={() => onMarkPaid(r)}
                                disabled={markPaid.status === "pending"}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Mark paid
                              </Button>
                            )}
                            {updateRecord.enabled && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                onClick={() => openEdit(r)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                            )}
                            {deleteRecord.enabled && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs text-destructive"
                                onClick={() => setDeleteTarget(r)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-sm text-muted-foreground">
              <span className="tabular-nums">
                Filtered total:{" "}
                <span className="font-medium text-foreground">
                  {status==="error"?"—":loadingAll?"…":money(totals.sum, totals.currency)}
                </span>
                {totals.mixed && " (mixed currencies, not converted)"}
              </span>
              <span className="tabular-nums">
                {Object.keys(totals.byStatus).length === 0
                  ? "No rows"
                  : Object.keys(totals.byStatus)
                      .sort()
                      .map((k) => `${k}: ${totals.byStatus[k]}`)
                      .join(" · ")}
              </span>
              {totals.split > 0 && (
                <span className="tabular-nums">
                  {totals.split} split across several models
                </span>
              )}
              {totals.untagged > 0 && (
                <span className="tabular-nums text-amber-700">
                  {totals.untagged} unallocated (no model)
                </span>
              )}
              {totals.missing > 0 && (
                <span className="tabular-nums text-amber-700">
                  {totals.missing} row{totals.missing === 1 ? "" : "s"} without an amount
                </span>
              )}
              {loadingAll && <span>Loading all rows…</span>}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Rows per page</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground tabular-nums">
                {firstRow}–{lastRow} of {sorted.length} rows
              </div>

              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage <= 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageNumbers(safePage, totalPages).map((p, i) =>
                  p === "…" ? (
                    <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === safePage ? "default" : "ghost"}
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => setPage(p as number)}
                    >
                      {p}
                    </Button>
                  )
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit expense" : "Add expense"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this row in the Expense Log."
                : "The Expense ID is generated on save — you never type one."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input
                id="exp-date"
                type="date"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The single date on an expense. Whether it counts in the P&amp;L is
                decided by Status, not by this.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status || NONE}
                onValueChange={(v) => setForm({ ...form, status: v === NONE ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {statusValues.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only <span className="font-medium">Paid</span> counts as a cost in
                the P&amp;L. Planned and Unpaid are shown there as excluded.
              </p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-desc">Description</Label>
              <Input
                id="exp-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What was bought"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <Input
                id="exp-amount"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select
                value={form.currency || NONE}
                onValueChange={(v) => setForm({ ...form, currency: v === NONE ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {currencyChoices.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <CategoryCombobox
                value={form.category}
                choices={categoryValues}
                onChange={(name) => {
                  setForm({ ...form, category: name });
                  setFormNewCat(null);
                }}
                onCreate={(name) => {
                  registerNewCategory(name);
                  setForm({ ...form, category: name });
                  setFormNewCat(name);
                }}
              />
              {formNewCat && form.category === formNewCat ? (
                <p className="flex items-start gap-1.5 text-xs text-emerald-700">
                  <Check className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    New category “{formNewCat}” — saving this expense adds it as a
                    real Airtable choice, and it then appears in the category
                    filter and the spend-by-category breakdown.
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Type to filter, or add a category of your own. Renaming or
                  removing one is done in Airtable.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-channel">Channel</Label>
              <Input
                id="exp-channel"
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Model(s)</Label>
              <ModelMultiSelect
                value={form.modelIds}
                options={modelRecords}
                nameById={modelNameById}
                onChange={(ids) => setForm({ ...form, modelIds: ids })}
              />
              <p className="text-xs text-muted-foreground">
                {form.modelIds.length > 1 && form.amount.trim() !== "" && !isNaN(Number(form.amount))
                  ? `Split evenly in the P&L: ${money(
                      Number(form.amount) / form.modelIds.length,
                      form.currency || "USD",
                    )} against each of the ${form.modelIds.length} models.`
                  : form.modelIds.length === 0
                    ? "Leave empty and the cost stays in the agency total as Unallocated — it is never dropped."
                    : "Linked to the Models table — pick from the list, it cannot be typed."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-vendor">Vendor</Label>
              <Input
                id="exp-vendor"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Billing Type</Label>
              <Select
                value={form.billingType || NONE}
                onValueChange={(v) => setForm({ ...form, billingType: v === NONE ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select billing type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {billingChoices.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-source">Source Ref</Label>
              <Input
                id="exp-source"
                value={form.sourceRef}
                onChange={(e) => setForm({ ...form, sourceRef: e.target.value })}
                placeholder="Original TXID, invoice no…"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="exp-notes">Notes</Label>
              <Textarea
                id="exp-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Created By</Label>
              <Input value={form.createdBy} readOnly className="bg-muted/40" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Add expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.expenseId} — ${deleteTarget.description || "no description"}${
                    deleteTarget.amount === null
                      ? ""
                      : ` (${money(deleteTarget.amount, deleteTarget.currency)})`
                  }. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}