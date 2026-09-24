"use client";
import { useEffect, useMemo, useState } from "react";
import {
  datasource,
  q,
  useRecords,
  useRecordUpdate,
} from "@/lib/datasource";
import { useCurrentUser } from "@/lib/user";
import { useTextSetting } from "@/lib/editable-settings";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  AlertTriangle,
  Briefcase,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  CircleDot,
  Info,
  MessageSquare,
  Percent,
  Search,
  Sparkles,
  Trash2,
  Pencil,
  Wallet,
  X,
} from "lucide-react";

const ds = datasource.define({
  models: "models",
});

/* ------------------------------------------------------------------------
   TWO BUSINESSES, TWO FIELDS.

   Managed   — 20MG's own model. 20MG takes the page revenue and PAYS the
               model her cut. "Model's Cut %" is that share.
   Chat-only — not 20MG's model. 20MG supplies chatters and RECEIVES a share
               of the page's net revenue. "Our Cut %" is that share; the rest
               is never 20MG's money and must not appear anywhere as revenue
               or as cost.

   The two are separate fields on purpose. One field that meant "the model's
   cut" on one row and "our cut" on the next is exactly what made the P&L
   report someone else's money as 20MG profit. Only the field that matches the
   row's Deal Type is ever shown or written.
   ------------------------------------------------------------------------ */

// Airtable -> field NAMES
const modelsSelect = q.select({
  model: "Model",
  dealType: "Deal Type",
  modelCut: "Model's Cut %",
  ourCut: "Our Cut %",
  basis: "Payout Basis",
  status: "Status",
  startDate: "Start Date",
  notes: "Notes",
});

// "Model" is the primary field and is never written from here.
const modelsWriteFields = q.select({
  dealType: "Deal Type",
  modelCut: "Model's Cut %",
  ourCut: "Our Cut %",
  basis: "Payout Basis",
  status: "Status",
  startDate: "Start Date",
  notes: "Notes",
});

const MANAGED = "Managed";
const CHAT_ONLY = "Chat-only";
// Exactly the choices that exist on Airtable Models.Deal Type - writing any
// other string would silently create a new choice.
const DEAL_TYPE_CHOICES = [MANAGED, CHAT_ONLY];

const PAYOUT_BASIS_DEFAULT = "Net revenue (after OnlyFans 20%)";
// Exactly the choices that exist on Airtable Models.Payout Basis.
const PAYOUT_BASIS_CHOICES = [
  "Net revenue (after OnlyFans 20%)",
  "Gross revenue",
  "Flat fee",
];
const STATUS_CHOICES = ["Active", "Paused", "Ended"];
const NONE = "__none__";

/* ---------------- helpers ---------------- */

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// SOFTR PRE-SCALES AIRTABLE PERCENT FIELDS. Both "Model's Cut %" and "Our Cut %" are Airtable
// PERCENT fields: Airtable's REST API represents 25% as 0.25, but Softr's datasource returns 25,
// and de-scales symmetrically on write (writing 30 through Softr stores 0.3 in Airtable, which
// reads back as 30). CONFIRMED at runtime in the browser against real records. So the scale
// factor is ALWAYS 1: display the number Softr gives you, write back the number the user typed.
//
// DO NOT reintroduce a scaling factor or a "<= 1" heuristic. The old shareScale() returned 100
// whenever no non-zero share existed in the dataset - a reachable state - so typing 30 wrote
// 30/100 = 0.3, which Softr de-scaled to 0.003 in Airtable: 0.3%, a hundredth of what was
// intended. Round-trip identity hid it completely. That is a silent 100x payout error.

// Percent points exactly as Softr reports them. null - NEVER 0 - when unset, so an unset model
// renders as "not set" and never silently gets a 0% cut.
function pointsFromRaw(v: unknown): number | null {
  const n = toNumOrNull(v);
  if (n === null) return null;
  return Math.round(n * 1e6) / 1e6;
}

// Written back unchanged - Softr does the de-scaling for Airtable.
function rawFromPoints(points: number): number {
  return Math.round(points * 1e8) / 1e8;
}

function isoDay(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function prettyDay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const mi = Number(m) - 1;
  if (mi < 0 || mi > 11) return iso;
  return `${Number(d)} ${MONTHS[mi]} ${y}`;
}

function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function fmtShare(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2)}%`;
}

type Row = {
  key: string;
  name: string;
  recordId: string;
  dealType: string;
  modelCut: number | null;
  ourCut: number | null;
  basis: string;
  status: string;
  startDate: string;
  notes: string;
};

// The single place that decides which percentage a row actually uses. Everything
// else - the table cell, the inline editor, the dialog, the warnings - reads it
// from here, so the two fields can never be crossed over.
type CutSpec = {
  applies: boolean;
  field: "modelCut" | "ourCut" | null;
  value: number | null;
  heading: string;
  meaning: string;
};

function cutSpec(row: Row): CutSpec {
  if (row.dealType === MANAGED) {
    return {
      applies: true,
      field: "modelCut",
      value: row.modelCut,
      heading: "Model's Cut %",
      meaning: "the share the MODEL keeps; 20MG pays it out",
    };
  }
  if (row.dealType === CHAT_ONLY) {
    return {
      applies: true,
      field: "ourCut",
      value: row.ourCut,
      heading: "Our Cut %",
      meaning: "the share 20MG RECEIVES; the rest is not 20MG's money",
    };
  }
  return {
    applies: false,
    field: null,
    value: null,
    heading: "Cut %",
    meaning: "set a deal type first",
  };
}

const STATUS_TONE: Record<string, string> = {
  Active: "bg-emerald-500",
  Paused: "bg-amber-500",
  Ended: "bg-rose-500",
};

function DealTypeBadge({ dealType }: { dealType: string }) {
  if (dealType === MANAGED) {
    return (
      <Badge variant="secondary" className="gap-1.5 rounded-md font-normal">
        <Briefcase className="h-3 w-3 opacity-70" />
        Managed
      </Badge>
    );
  }
  if (dealType === CHAT_ONLY) {
    return (
      <Badge variant="secondary" className="gap-1.5 rounded-md font-normal">
        <MessageSquare className="h-3 w-3 opacity-70" />
        Chat-only
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      not set
    </span>
  );
}

/* ---- owner-only gate ----------------------------------------------------
   Softr Basic has no user groups, so page-level access control is unavailable
   and this lives in code. It is a curtain, not a lock: it keeps the figures
   out of the page for anyone not on the list, but anyone who can read the
   compiled bundle can read the list. ------------------------------------- */

function GateResolving() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <Card className="w-full max-w-xl">
        <CardContent className="p-6">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-3 w-64 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}

function GateUnavailable({ email }: { email: string }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <Card className="w-full max-w-xl">
        <CardContent className="p-6">
          <h2 className="text-base font-semibold tracking-tight">
            This page isn&apos;t available on your account.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            There is nothing further to do here.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {email || "no signed-in address"}
            </span>
            . If that address should have access, add it to &ldquo;Who can see
            this page&rdquo; in this block&apos;s settings in Softr Studio.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- block ---------------- */

export default function Block() {
  // Owner-only gate. The allow-list is an editable setting so an address can be
  // added or corrected in Studio without touching code.
  const allowedEmailsSetting = useTextSetting({
    name: "allowed-emails",
    label: "Who can see this page (comma-separated emails)",
    initialValue: "massi@20mg.co, massimo@otfagency.co",
  });
  const gateUser = useCurrentUser();
  const [gateTimedOut, setGateTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGateTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const viewerEmail = String(gateUser?.email ?? "").trim().toLowerCase();
  const allowList = useMemo(
    () =>
      String(allowedEmailsSetting ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e !== ""),
    [allowedEmailsSetting],
  );
  // useCurrentUser() returns null both while resolving and when signed out, so
  // a short grace period keeps the refusal panel from flashing on load.
  const gateResolved = viewerEmail !== "" || gateTimedOut;
  const allowed = viewerEmail !== "" && allowList.includes(viewerEmail);

  // The content lives in a child component that is only MOUNTED when the viewer
  // is allowed. Softr's useRecords silently drops its documented `enabled`
  // option (verified in the compiled runtime), so not mounting the hooks is the
  // only way to stop the datasource requests firing at all. `enabled` is still
  // passed on every hook below: the REST/proxy queries do honour it.
  if (!gateResolved) return <GateResolving />;
  if (!allowed) return <GateUnavailable email={viewerEmail} />;
  return <BlockContent allowed={allowed} />;
}

function BlockContent({ allowed }: { allowed: boolean }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dealFilter, setDealFilter] = useState("all");
  const [cutFilter, setCutFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"name" | "cut" | "dealType" | "status" | "startDate">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [editRow, setEditRow] = useState<Row | null>(null);
  const [fDeal, setFDeal] = useState(NONE);
  const [fCut, setFCut] = useState("");
  const [fBasis, setFBasis] = useState(PAYOUT_BASIS_DEFAULT);
  const [fStatus, setFStatus] = useState(NONE);
  const [fStart, setFStart] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [savingDialog, setSavingDialog] = useState(false);

  const [clearRow, setClearRow] = useState<Row | null>(null);

  const modelsQuery = useRecords({
    from: ds.models,
    select: modelsSelect,
    count: 100,
    enabled: allowed,
  });

  useEffect(() => {
    if (modelsQuery.hasNextPage && !modelsQuery.isFetching) {
      modelsQuery.fetchNextPage();
    }
  }, [modelsQuery.hasNextPage, modelsQuery.isFetching]);

  const modelItems = modelsQuery.data?.pages.flatMap((p: any) => p.items) ?? [];

  const rows: Row[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const it of modelItems) {
      const name = String(it.fields.model ?? "").trim();
      if (!name) continue;
      const key = norm(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        name,
        recordId: it.id,
        dealType: label(it.fields.dealType),
        modelCut: pointsFromRaw(it.fields.modelCut),
        ourCut: pointsFromRaw(it.fields.ourCut),
        basis: label(it.fields.basis),
        status: label(it.fields.status),
        startDate: isoDay(it.fields.startDate),
        notes: String(it.fields.notes ?? ""),
      });
    }
    return out;
  }, [modelItems]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (term && !r.name.toLowerCase().includes(term) && !r.notes.toLowerCase().includes(term)) {
        return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === NONE ? r.status !== "" : r.status !== statusFilter) return false;
      }
      if (dealFilter !== "all") {
        if (dealFilter === NONE ? r.dealType !== "" : r.dealType !== dealFilter) return false;
      }
      const spec = cutSpec(r);
      if (cutFilter === "set" && !(spec.applies && spec.value !== null)) return false;
      if (cutFilter === "unset" && spec.applies && spec.value !== null) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (sortKey === "cut") {
        const av = cutSpec(a).value;
        const bv = cutSpec(b).value;
        const an = av === null ? Number.NEGATIVE_INFINITY : av;
        const bn = bv === null ? Number.NEGATIVE_INFINITY : bv;
        return (an - bn) * dir;
      }
      if (sortKey === "dealType") return a.dealType.localeCompare(b.dealType) * dir;
      if (sortKey === "status") return a.status.localeCompare(b.status) * dir;
      if (sortKey === "startDate") return a.startDate.localeCompare(b.startDate) * dir;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * dir;
    });
    return out;
  }, [rows, search, statusFilter, dealFilter, cutFilter, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dealFilter, cutFilter, pageSize]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  // Three distinct data-integrity problems, each one a reason the P&L cannot
  // compute a figure for that model. None of them is ever guessed at.
  const noDealType = rows.filter((r) => r.dealType === "");
  const chatNoCut = rows.filter((r) => r.dealType === CHAT_ONLY && r.ourCut === null);
  const managedNoCut = rows.filter((r) => r.dealType === MANAGED && r.modelCut === null);

  const filtersActive =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    dealFilter !== "all" ||
    cutFilter !== "all";

  const updateModel = useRecordUpdate({
    from: ds.models,
    fields: modelsWriteFields,
  });

  const canWrite = updateModel.enabled;

  function clearDraft(key: string) {
    setDrafts((d) => {
      const n = { ...d };
      delete n[key];
      return n;
    });
  }

  function toggleSort(key: "name" | "cut" | "dealType" | "status" | "startDate") {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setDealFilter("all");
    setCutFilter("all");
  }

  // Writes ONLY the field the row's deal type calls for. The other stays exactly
  // as it is - a chat-only model must never acquire a "model's cut", and a
  // managed model must never acquire an "our cut".
  async function commitCut(row: Row, raw: string) {
    const spec = cutSpec(row);
    if (!spec.applies || !spec.field) {
      toast.error(`Set a deal type for ${row.name} before entering a percentage.`);
      clearDraft(row.key);
      return;
    }
    const trimmed = raw.trim();

    if (trimmed === "") {
      if (spec.value === null) {
        clearDraft(row.key);
        return;
      }
      if (!canWrite) {
        toast.error("You do not have permission to change model settings.");
        clearDraft(row.key);
        return;
      }
      setSavingKey(row.key);
      try {
        // Static field map: the compiler derives the block's writable-field list
        // from these literals, so every field this block may write has to appear
        // in one. The cut that does not apply is written null, never left to go
        // stale under a later change of deal type.
        await updateModel.mutateAsync({
          recordId: row.recordId,
          fields: { modelCut: null, ourCut: null },
        });
        await modelsQuery.refetch();
        clearDraft(row.key);
        toast.success(`${row.name} — ${spec.heading} cleared`);
      } catch (e: any) {
        toast.error(e?.message ?? "Could not clear the percentage");
      } finally {
        setSavingKey(null);
      }
      return;
    }

    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error(`"${trimmed}" is not a valid percentage. Enter a number between 0 and 100.`);
      clearDraft(row.key);
      return;
    }

    if (spec.value !== null && Math.abs(n - spec.value) < 1e-9) {
      clearDraft(row.key);
      return;
    }

    if (!canWrite) {
      toast.error("You do not have permission to change model settings.");
      clearDraft(row.key);
      return;
    }

    setSavingKey(row.key);
    try {
      const v = rawFromPoints(n);
      await updateModel.mutateAsync({
        recordId: row.recordId,
        fields: {
          modelCut: spec.field === "modelCut" ? v : null,
          ourCut: spec.field === "ourCut" ? v : null,
        },
      });
      await modelsQuery.refetch();
      clearDraft(row.key);
      toast.success(`${row.name} — ${spec.heading} set to ${fmtShare(n)}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the percentage");
    } finally {
      setSavingKey(null);
    }
  }

  function openEdit(row: Row) {
    const spec = cutSpec(row);
    setEditRow(row);
    setFDeal(row.dealType || NONE);
    setFCut(spec.value === null ? "" : String(spec.value));
    setFBasis(row.basis || PAYOUT_BASIS_DEFAULT);
    setFStatus(row.status || NONE);
    setFStart(row.startDate || "");
    setFNotes(row.notes || "");
  }

  // Switching deal type in the dialog reloads the number from the field that new
  // type actually uses rather than carrying it across: 25% meaning "the model
  // keeps a quarter" is a completely different fact from 25% meaning "20MG
  // receives a quarter".
  function onDealChange(v: string) {
    setFDeal(v);
    if (!editRow) {
      setFCut("");
      return;
    }
    if (v === MANAGED) setFCut(editRow.modelCut === null ? "" : String(editRow.modelCut));
    else if (v === CHAT_ONLY) setFCut(editRow.ourCut === null ? "" : String(editRow.ourCut));
    else setFCut("");
  }

  const dialogHeading =
    fDeal === MANAGED
      ? "Model's Cut %"
      : fDeal === CHAT_ONLY
        ? "Our Cut %"
        : "Cut %";
  const dialogMeaning =
    fDeal === MANAGED
      ? "The share the MODEL keeps of this page's net revenue. 20MG pays it out, and it is a cost on the P&L."
      : fDeal === CHAT_ONLY
        ? "The share 20MG RECEIVES of this page's net revenue for supplying chatters. The rest of the page's revenue is not 20MG's money and never appears on the P&L."
        : "Choose a deal type first — the percentage means opposite things on the two.";

  async function saveEdit() {
    if (!editRow) return;
    const dealValue = fDeal === NONE ? null : fDeal;
    const trimmed = fCut.trim();
    let cutValue: number | null = null;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        toast.error(`"${trimmed}" is not a valid percentage. Enter a number between 0 and 100.`);
        return;
      }
      if (dealValue === null) {
        toast.error("Choose a deal type before entering a percentage.");
        return;
      }
      cutValue = rawFromPoints(n);
    }
    if (!canWrite) {
      toast.error("You do not have permission to change model settings.");
      return;
    }
    setSavingDialog(true);
    try {
      // Only the cut the chosen deal type uses can hold a number; the other is
      // written null in the same breath, so a percentage entered under the old
      // deal type can never be reinterpreted as meaning the opposite thing.
      await updateModel.mutateAsync({
        recordId: editRow.recordId,
        fields: {
          dealType: dealValue,
          modelCut: dealValue === MANAGED ? cutValue : null,
          ourCut: dealValue === CHAT_ONLY ? cutValue : null,
          basis: fBasis || PAYOUT_BASIS_DEFAULT,
          status: fStatus === NONE ? null : fStatus,
          startDate: fStart ? fStart : null,
          notes: fNotes.trim() === "" ? null : fNotes,
        },
      });
      await modelsQuery.refetch();
      clearDraft(editRow.key);
      toast.success(`${editRow.name} — settings saved`);
      setEditRow(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the settings");
    } finally {
      setSavingDialog(false);
    }
  }

  async function doClear() {
    if (!clearRow) {
      setClearRow(null);
      return;
    }
    if (!canWrite) {
      toast.error("You do not have permission to clear model settings.");
      setClearRow(null);
      return;
    }
    const row = clearRow;
    const spec = cutSpec(row);
    setClearRow(null);
    if (!spec.field) return;
    try {
      await updateModel.mutateAsync({
        recordId: row.recordId,
        fields: { modelCut: null, ourCut: null },
      });
      await modelsQuery.refetch();
      clearDraft(row.key);
      toast.success(`${row.name} — ${spec.heading} cleared`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not clear the percentage");
    }
  }

  const loading = modelsQuery.status === "pending";
  const failed = modelsQuery.status === "error";

  const pageNumbers = useMemo(() => {
    const out: (number | "gap")[] = [];
    if (pageCount <= 5) {
      for (let i = 1; i <= pageCount; i++) out.push(i);
      return out;
    }
    const around = [safePage - 1, safePage, safePage + 1].filter((n) => n > 1 && n < pageCount);
    out.push(1);
    if (around.length && around[0] > 2) out.push("gap");
    for (const n of around) out.push(n);
    if (around.length && around[around.length - 1] < pageCount - 1) out.push("gap");
    else if (!around.length) out.push("gap");
    out.push(pageCount);
    return out;
  }, [pageCount, safePage]);

  function SortHead({
    label: text,
    icon,
    field,
    align,
  }: {
    label: string;
    icon: any;
    field: "name" | "cut" | "dealType" | "status" | "startDate";
    align?: string;
  }) {
    return (
      <button
        className={
          "inline-flex items-center gap-1.5 hover:text-foreground " + (align === "right" ? "justify-end w-full" : "")
        }
        onClick={() => toggleSort(field)}
      >
        {icon}
        {text}
        {sortKey === field ? (
          sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : null}
      </button>
    );
  }

  const clearSpec = clearRow ? cutSpec(clearRow) : null;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        <Card className="w-full overflow-hidden bg-card border rounded-xl shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">Model settings</h2>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                    {rows.length}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Deal type, the percentage that goes with it, and status for every model on the Models table.
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-0 pb-0">
            <div className="px-6 pb-4 space-y-3">
              <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                <div className="space-y-1">
                  <p>
                    <span className="font-medium text-foreground">Managed</span> — 20MG&rsquo;s own model. 20MG takes the
                    page revenue and pays her <span className="font-medium text-foreground">Model&rsquo;s Cut %</span>,
                    which is a cost on the P&amp;L.
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Chat-only</span> — not 20MG&rsquo;s model. 20MG supplies
                    chatters and receives <span className="font-medium text-foreground">Our Cut %</span> of the page&rsquo;s
                    net revenue. The rest of that page&rsquo;s revenue is not 20MG&rsquo;s money and never reaches the P&amp;L.
                  </p>
                  <p>Only the percentage that matches the deal type is shown, stored or used.</p>
                </div>
              </div>

              {(noDealType.length > 0 || chatNoCut.length > 0 || managedNoCut.length > 0) && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" /> Data check —{" "}
                    {[noDealType.length, chatNoCut.length, managedNoCut.length].filter((n) => n > 0).length} issue
                    {[noDealType.length, chatNoCut.length, managedNoCut.length].filter((n) => n > 0).length === 1 ? "" : "s"}{" "}
                    found
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {noDealType.length > 0 && (
                      <li>
                        <span className="font-medium">
                          {noDealType.length} model{noDealType.length === 1 ? "" : "s"} with no deal type
                        </span>{" "}
                        <span className="opacity-80">
                          — {noDealType.map((r) => r.name).join(", ")}. The P&amp;L cannot tell whether 20MG takes this
                          page&rsquo;s revenue or only a slice of it, so it excludes them from every revenue figure rather
                          than guessing.
                        </span>
                      </li>
                    )}
                    {chatNoCut.length > 0 && (
                      <li>
                        <span className="font-medium">
                          {chatNoCut.length} chat-only model{chatNoCut.length === 1 ? "" : "s"} with no Our Cut %
                        </span>{" "}
                        <span className="opacity-80">
                          — {chatNoCut.map((r) => r.name).join(", ")}. 20MG&rsquo;s revenue from{" "}
                          {chatNoCut.length === 1 ? "this page" : "these pages"} cannot be worked out until the percentage
                          is entered.
                        </span>
                      </li>
                    )}
                    {managedNoCut.length > 0 && (
                      <li>
                        <span className="font-medium">
                          {managedNoCut.length} managed model{managedNoCut.length === 1 ? "" : "s"} with no Model&rsquo;s Cut %
                        </span>{" "}
                        <span className="opacity-80">
                          — {managedNoCut.map((r) => r.name).join(", ")}. Their payout cannot be calculated, so the
                          P&amp;L shows a dash for their profit rather than a figure that would be too high by the whole
                          payout.
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Select value={dealFilter} onValueChange={setDealFilter}>
                  <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                    <Briefcase className="h-3.5 w-3.5 opacity-60" />
                    <span>Deal{dealFilter !== "all" ? `: ${dealFilter === NONE ? "Not set" : dealFilter}` : ""}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All deal types</SelectItem>
                    {DEAL_TYPE_CHOICES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                    <SelectItem value={NONE}>Not set</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                    <CircleDot className="h-3.5 w-3.5 opacity-60" />
                    <span>Status{statusFilter !== "all" ? `: ${statusFilter === NONE ? "Not set" : statusFilter}` : ""}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {STATUS_CHOICES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                    <SelectItem value={NONE}>Not set</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={cutFilter} onValueChange={setCutFilter}>
                  <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                    <Percent className="h-3.5 w-3.5 opacity-60" />
                    <span>
                      Cut
                      {cutFilter !== "all" ? `: ${cutFilter === "set" ? "Set" : "Not set"}` : ""}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All models</SelectItem>
                    <SelectItem value="set">Cut set</SelectItem>
                    <SelectItem value="unset">Cut not set</SelectItem>
                  </SelectContent>
                </Select>

                {filtersActive && (
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={resetFilters}>
                    <X className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search models"
                      className="h-8 w-[200px] lg:w-[260px] pl-8 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="relative w-full overflow-auto max-h-[70vh] border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <SortHead label="Model" icon={<Sparkles className="h-3 w-3 opacity-60" />} field="name" />
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <SortHead label="Deal type" icon={<Briefcase className="h-3 w-3 opacity-60" />} field="dealType" />
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap text-right">
                      <SortHead
                        label="Cut %"
                        icon={<Percent className="h-3 w-3 opacity-60" />}
                        field="cut"
                        align="right"
                      />
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <Wallet className="h-3 w-3 opacity-60" />
                        Payout Basis
                      </span>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <SortHead label="Status" icon={<CircleDot className="h-3 w-3 opacity-60" />} field="status" />
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      <SortHead label="Start Date" icon={<Calendar className="h-3 w-3 opacity-60" />} field="startDate" />
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        Loading models…
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && failed && (
                    <TableRow>
                      <TableCell colSpan={7} className="px-3 py-10 text-center text-sm text-destructive">
                        Could not load model settings.
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && !failed && paged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="px-3 py-12">
                        <div className="flex flex-col items-center gap-2 text-center">
                          <Sparkles className="h-6 w-6 text-muted-foreground/50" />
                          <p className="text-sm text-muted-foreground">
                            {rows.length === 0
                              ? "No models on the Models table yet."
                              : "No models match these filters."}
                          </p>
                          {filtersActive && (
                            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={resetFilters}>
                              <X className="h-3.5 w-3.5" />
                              Clear filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading &&
                    !failed &&
                    paged.map((row) => {
                      const spec = cutSpec(row);
                      const draft = drafts[row.key];
                      const value = draft !== undefined ? draft : spec.value === null ? "" : String(spec.value);
                      const busy = savingKey === row.key;
                      return (
                        <TableRow key={row.key} className="h-12 border-b transition-colors hover:bg-muted/40">
                          <TableCell className="px-3 py-2 text-sm">
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                                {initials(row.name)}
                              </span>
                              <span className="font-medium">{row.name}</span>
                            </div>
                          </TableCell>

                          <TableCell className="px-3 py-2 text-sm">
                            <DealTypeBadge dealType={row.dealType} />
                          </TableCell>

                          <TableCell className="px-3 py-2 text-sm text-right">
                            {!spec.applies ? (
                              // No deal type, so neither percentage means anything yet. An em
                              // dash and nothing to type into - never a 0, never a guess.
                              <span className="inline-flex items-center justify-end gap-1.5 text-sm text-muted-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                <span>— deal type not set</span>
                              </span>
                            ) : (
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center justify-end gap-2">
                                  {spec.value === null && draft === undefined && (
                                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                      not set
                                    </span>
                                  )}
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.01"
                                    inputMode="decimal"
                                    disabled={busy || !canWrite}
                                    value={value}
                                    placeholder="—"
                                    aria-label={`${spec.heading} for ${row.name}`}
                                    onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                                    onBlur={(e) => {
                                      if (drafts[row.key] === undefined) return;
                                      commitCut(row, e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                      if (e.key === "Escape") clearDraft(row.key);
                                    }}
                                    className="h-8 w-[84px] text-right text-sm tabular-nums"
                                  />
                                </div>
                                <span className="text-[11px] text-muted-foreground">{spec.heading}</span>
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="px-3 py-2 text-sm">
                            {row.basis ? (
                              <Badge variant="secondary" className="rounded-md font-normal">
                                {row.basis}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="px-3 py-2 text-sm">
                            {row.status ? (
                              <span className="inline-flex items-center gap-1.5 text-sm">
                                <span
                                  className={
                                    "h-1.5 w-1.5 rounded-full " + (STATUS_TONE[row.status] ?? "bg-muted-foreground/40")
                                  }
                                />
                                {row.status}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="px-3 py-2 text-sm tabular-nums">
                            {row.startDate ? (
                              prettyDay(row.startDate)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="px-3 py-2 text-sm text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs"
                                disabled={!canWrite}
                                onClick={() => openEdit(row)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs text-destructive"
                                disabled={spec.value === null || !canWrite}
                                onClick={() => setClearRow(row)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Clear
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[15, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-muted-foreground tabular-nums">
                {total === 0 ? "0 rows" : `${start + 1}–${Math.min(start + pageSize, total)} of ${total} rows`}
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
                {pageNumbers.map((n, i) =>
                  n === "gap" ? (
                    <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={n}
                      variant={n === safePage ? "default" : "ghost"}
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </Button>
                  ),
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage(safePage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage(pageCount)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={editRow !== null} onOpenChange={(o) => { if (!o) setEditRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editRow ? editRow.name : "Model settings"}</DialogTitle>
            <DialogDescription>
              The deal type decides what the percentage means. Only the one that applies is saved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Deal type</Label>
              <Select value={fDeal} onValueChange={onDealChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {DEAL_TYPE_CHOICES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Managed — 20MG&rsquo;s own model, 20MG pays her a cut. Chat-only — 20MG supplies chatters and receives a
                cut. Leaving it unset keeps this model out of every revenue figure on the P&amp;L.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ms-cut">{dialogHeading}</Label>
              <Input
                id="ms-cut"
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                value={fCut}
                disabled={fDeal === NONE}
                placeholder={fDeal === NONE ? "Choose a deal type first" : "Leave blank for not set"}
                onChange={(e) => setFCut(e.target.value)}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">{dialogMeaning}</p>
              {fDeal !== NONE && (
                <p className="text-xs text-muted-foreground">
                  0–100. Leave blank to mark this model as not set — that is not the same as 0%.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Payout Basis</Label>
              <Select value={fBasis} onValueChange={setFBasis}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYOUT_BASIS_CHOICES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={fStatus} onValueChange={setFStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {STATUS_CHOICES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ms-start">Start Date</Label>
                <Input id="ms-start" type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ms-notes">Notes</Label>
              <Textarea id="ms-notes" rows={3} value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditRow(null)} disabled={savingDialog}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingDialog || !canWrite}>
              {savingDialog ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearRow !== null} onOpenChange={(o) => { if (!o) setClearRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear {clearSpec ? clearSpec.heading : "the percentage"} for {clearRow ? clearRow.name : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This empties {clearSpec ? clearSpec.heading : "the percentage"} on the model, so she goes back to
              &ldquo;not set&rdquo; and the P&amp;L stops computing that figure for her. Deal type, Payout Basis, Status,
              Start Date and Notes are left alone, and the model itself is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doClear}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
