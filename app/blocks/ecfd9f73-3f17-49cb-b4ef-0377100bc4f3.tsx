"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  datasource,
  q,
  useProxyFetch,
  useRecordCreate,
  useRecordUpdate,
  useRecords,
} from "@/lib/datasource";
import { useCurrentUser } from "@/lib/user";
import { useTextSetting } from "@/lib/editable-settings";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import {
  AlertTriangle,
  AtSign,
  CheckCircle2,
  Hash,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  User,
  X,
} from "lucide-react";

const ds = datasource.define({
  staq: "23c2a0b3-fddb-456e-8aa4-1c0822c7521c",
  map: "map",
  models: "models",
});

// Airtable -> field NAMES
const mapSelect = q.select({
  slug: "Account Slug",
  accountId: "Account ID",
  ofUsername: "OF Username",
  model: "Model",
  include: "Include in P&L",
  notes: "Notes",
});

const mapUpdateFields = q.select({
  model: "Model",
  include: "Include in P&L",
});

const mapCreateFields = q.select({
  slug: "Account Slug",
  accountId: "Account ID",
  ofUsername: "OF Username",
  model: "Model",
  include: "Include in P&L",
  notes: "Notes",
});

const modelsSelect = q.select({ model: "Model" });
const modelsCreateFields = q.select({ model: "Model" });

const NONE = "__unassigned__";
const STAQ_MONTHLY =
  "https://api.creatorstaq.com/v1/computed/revenue/monthly?months=24";

type StaqAccount = { id: number; slug: string; of_username: string };
type StaqMonthRow = {
  month: string;
  accounts?: { account_id: number; slug: string; name: string; net: number }[];
};
type StaqMe = {
  agency?: { id: number; slug: string; name: string };
  key?: { prefix: string; name: string };
  accounts?: StaqAccount[];
  monthly_by_account?: StaqMonthRow[];
};

// Airtable SELECT values arrive as { id, label }. Everything else passes through.
function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

// Airtable LINKED_RECORD values arrive as an array of { id, name } (or of ids).
function linkName(v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    return label(v[0]);
  }
  return label(v);
}

function initials(v: string) {
  const s = String(v || "").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
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
  const proxyFetch = useProxyFetch(ds.staq);
  const [search, setSearch] = useState("");
  const [newModel, setNewModel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const me = useQuery<StaqMe>({
    queryKey: ["creatorstaq", "agency-roster"],
    queryFn: async () => {
      const res = await proxyFetch(STAQ_MONTHLY);
      if (res.status === 403) {
        throw new Error(
          "Sign in with an authorised manager account to access Creatorstaq.",
        );
      }
      if (!res.ok) {
        throw new Error(`Creator Staq returned ${res.status}`);
      }
      const json = (await res.json()) as StaqMe;
      const seen = new Map<number, StaqAccount>();
      (json.monthly_by_account ?? []).forEach((m) =>
        (m.accounts ?? []).forEach((a) => {
          if (!seen.has(a.account_id)) {
            seen.set(a.account_id, {
              id: a.account_id,
              slug: String(a.slug ?? ""),
              of_username: String(a.name ?? a.slug ?? ""),
            });
          }
        }),
      );
      return { ...json, accounts: Array.from(seen.values()) };
    },
    staleTime: 60000,
    retry: 1,
    enabled: allowed,
  });

  const mapRes = useRecords({
    from: ds.map,
    select: mapSelect,
    count: 100,
    enabled: allowed,
  });
  const modelsRes = useRecords({
    from: ds.models,
    select: modelsSelect,
    count: 100,
    enabled: allowed,
  });

  const createMapping = useRecordCreate({
    from: ds.map,
    fields: mapCreateFields,
    onSuccess: async () => {
      await mapRes.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMapping = useRecordUpdate({
    from: ds.map,
    fields: mapUpdateFields,
    onSuccess: async () => {
      await mapRes.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const createModel = useRecordCreate({
    from: ds.models,
    fields: modelsCreateFields,
    onSuccess: async () => {
      await modelsRes.refetch();
      toast.success("Model added");
    },
    onError: (e) => toast.error(e.message),
  });

  const mappings = useMemo(
    () =>
      (mapRes.data?.pages.flatMap((p) => p.items) ?? []).map((r) => ({
        id: r.id,
        slug: String(r.fields.slug ?? "").trim(),
        accountId: Number(r.fields.accountId ?? 0),
        ofUsername: String(r.fields.ofUsername ?? "").trim(),
        model: linkName(r.fields.model),
        include: r.fields.include === true,
        notes: String(r.fields.notes ?? "").trim(),
      })),
    [mapRes.data],
  );

  const modelRecords = useMemo(
    () =>
      (modelsRes.data?.pages.flatMap((p) => p.items) ?? [])
        .map((r) => ({ id: r.id, name: String(r.fields.model ?? "").trim() }))
        .filter((r) => r.name !== ""),
    [modelsRes.data],
  );

  const modelNames = useMemo(() => {
    const names = modelRecords.map((r) => r.name);
    return Array.from(new Set(names)).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [modelRecords]);

  // Model is a LINKED_RECORD on Airtable, so a write needs the record id.
  const modelIdByName = useMemo(() => {
    const m = new Map<string, string>();
    modelRecords.forEach((r) => {
      const k = r.name.toLowerCase();
      if (!m.has(k)) m.set(k, r.id);
    });
    return m;
  }, [modelRecords]);

  const liveAccounts = me.data?.accounts ?? [];
  const bySlug = useMemo(() => {
    const m = new Map<string, (typeof mappings)[number]>();
    mappings.forEach((r) => m.set(r.slug.toLowerCase(), r));
    return m;
  }, [mappings]);

  const rows = useMemo(() => {
    const liveSlugs = new Set(
      liveAccounts.map((a) => String(a.slug).toLowerCase()),
    );
    const merged = liveAccounts.map((a) => {
      const rec = bySlug.get(String(a.slug).toLowerCase());
      return {
        key: a.slug,
        slug: a.slug,
        accountId: a.id,
        ofUsername: a.of_username,
        recordId: rec?.id ?? null,
        model: rec?.model ?? "",
        include: rec ? rec.include : true,
        notes: rec?.notes ?? "",
        state: (rec ? "linked" : "unlinked") as "linked" | "unlinked" | "orphan",
      };
    });
    mappings
      .filter((r) => r.slug && !liveSlugs.has(r.slug.toLowerCase()))
      .forEach((r) =>
        merged.push({
          key: r.slug,
          slug: r.slug,
          accountId: r.accountId,
          ofUsername: r.ofUsername,
          recordId: r.id,
          model: r.model,
          include: r.include,
          notes: r.notes,
          state: "orphan" as const,
        }),
      );
    const term = search.trim().toLowerCase();
    if (!term) return merged;
    return merged.filter(
      (r) =>
        r.slug.toLowerCase().includes(term) ||
        r.ofUsername.toLowerCase().includes(term) ||
        r.model.toLowerCase().includes(term) ||
        String(r.accountId).includes(term),
    );
  }, [liveAccounts, bySlug, mappings, search]);

  const assignedCount = rows.filter(
    (r) => r.model && r.state !== "orphan",
  ).length;
  const unlinked = rows.filter((r) => r.state === "unlinked");

  async function ensureRecord(row: (typeof rows)[number]) {
    if (row.recordId) return row.recordId;
    const created = await createMapping.mutateAsync({
      slug: row.slug,
      accountId: row.accountId,
      ofUsername: row.ofUsername,
      model: [],
      include: true,
      notes: null,
    });
    return created?.id ?? null;
  }

  async function setModel(row: (typeof rows)[number], value: string) {
    if (!updateMapping.enabled || !createMapping.enabled) return;
    let linkIds: string[] = [];
    if (value !== NONE) {
      const modelId = modelIdByName.get(value.toLowerCase());
      if (!modelId) {
        toast.error(`Could not find "${value}" in the Models table`);
        return;
      }
      linkIds = [modelId];
    }
    setBusy(row.key);
    try {
      const id = await ensureRecord(row);
      if (!id) throw new Error("Could not create the mapping row");
      await updateMapping.mutateAsync({
        recordId: id,
        fields: { model: linkIds },
      });
      toast.success(
        value === NONE ? `${row.slug} unassigned` : `${row.slug} to ${value}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function setInclude(row: (typeof rows)[number], value: boolean) {
    if (!updateMapping.enabled || !createMapping.enabled) return;
    setBusy(row.key);
    try {
      const id = await ensureRecord(row);
      if (!id) throw new Error("Could not create the mapping row");
      await updateMapping.mutateAsync({
        recordId: id,
        fields: { include: value },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function linkAll() {
    if (!createMapping.enabled) return;
    setBusy("__all__");
    try {
      for (const row of unlinked) {
        await createMapping.mutateAsync({
          slug: row.slug,
          accountId: row.accountId,
          ofUsername: row.ofUsername,
          model: [],
          include: true,
          notes: null,
        });
      }
      toast.success(`Added ${unlinked.length} account(s) to the mapping`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  function addModel() {
    const name = newModel.trim();
    if (!name) return;
    if (!createModel.enabled) return;
    if (modelNames.some((m) => m.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" is already in the Models list`);
      return;
    }
    createModel.mutate({ model: name });
    setNewModel("");
  }

  const connectionOk = me.status === "success";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        <Card className="w-full overflow-hidden">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="flex items-center gap-2.5">
              <span
                className={
                  "grid h-9 w-9 place-items-center rounded-full " +
                  (connectionOk
                    ? "bg-emerald-500/10 text-emerald-600"
                    : me.status === "pending"
                      ? "bg-muted text-muted-foreground"
                      : "bg-rose-500/10 text-rose-600")
                }
              >
                {connectionOk ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : me.status === "pending" ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold">
                  {connectionOk
                    ? "Connected to Creator Staq"
                    : me.status === "pending"
                      ? "Checking Creator Staq"
                      : "Creator Staq unreachable"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {connectionOk
                    ? `${liveAccounts.length} account${liveAccounts.length === 1 ? "" : "s"} with revenue · ${mappings.length} saved in the mapping`
                    : me.status === "error"
                      ? (me.error as Error)?.message
                      : "api.creatorstaq.com"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="leading-tight">
                <div className="text-xl font-semibold tabular-nums">
                  {assignedCount}
                  <span className="text-muted-foreground">
                    /{liveAccounts.length}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Accounts assigned to a model
                </div>
              </div>
              <div className="leading-tight">
                <div className="text-xl font-semibold tabular-nums">
                  {modelNames.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  Models on file
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => me.refetch()}
                disabled={me.isFetching}
              >
                <RefreshCw
                  className={
                    "h-3.5 w-3.5 " + (me.isFetching ? "animate-spin" : "")
                  }
                />
                Re-check
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="w-full overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Creator Staq accounts
                  </h2>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                    {rows.length}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Assign each OnlyFans account to a model so revenue rolls up
                  correctly on the P&amp;L. Creator Staq&apos;s own name for an
                  account is shown under its slug as a hint.
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {unlinked.length > 0 && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={linkAll}
                    disabled={busy !== null || !createMapping.enabled}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Add {unlinked.length} new account
                    {unlinked.length === 1 ? "" : "s"}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Input
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addModel();
                  }}
                  placeholder="New model name"
                  className="h-8 w-[180px] text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={addModel}
                  disabled={!newModel.trim() || !createModel.enabled}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add model
                </Button>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search accounts"
                    className="h-8 w-[200px] pl-8 text-sm lg:w-[260px]"
                  />
                </div>
                {search && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="relative max-h-[70vh] w-full overflow-auto border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground backdrop-blur">
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3 w-3 opacity-60" />
                        Account
                      </span>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground backdrop-blur">
                      <span className="inline-flex items-center gap-1.5">
                        <AtSign className="h-3 w-3 opacity-60" />
                        OF username
                      </span>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-right text-xs font-medium text-muted-foreground backdrop-blur">
                      <span className="inline-flex items-center gap-1.5">
                        <Hash className="h-3 w-3 opacity-60" />
                        ID
                      </span>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground backdrop-blur">
                      <span className="inline-flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 opacity-60" />
                        Model
                      </span>
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground backdrop-blur">
                      In P&amp;L
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground backdrop-blur">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {me.status === "pending" && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        Loading accounts from Creator Staq
                      </TableCell>
                    </TableRow>
                  )}
                  {me.status === "error" && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        {(me.error as Error)?.message}
                      </TableCell>
                    </TableRow>
                  )}
                  {me.status === "success" && rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        No accounts match that search.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => (
                    <TableRow
                      key={row.key}
                      className="h-12 border-b transition-colors hover:bg-muted/40"
                    >
                      <TableCell className="px-3 py-2 text-sm">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                            {initials(row.slug)}
                          </span>
                          <span className="font-medium">{row.slug}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm text-muted-foreground">
                        {row.ofUsername || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right text-sm tabular-nums">
                        {row.accountId || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm">
                        <Select
                          value={row.model ? row.model : NONE}
                          onValueChange={(v) => setModel(row, v)}
                          disabled={busy !== null || row.state === "orphan"}
                        >
                          <SelectTrigger className="h-8 w-[170px] gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Unassigned</SelectItem>
                            {modelNames.map((m) => (
                              <SelectItem key={m} value={m}>
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm">
                        <Checkbox
                          checked={row.include}
                          onCheckedChange={(v) => setInclude(row, v === true)}
                          disabled={busy !== null || row.state === "orphan"}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm">
                        {row.state === "orphan" ? (
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            Not on the API
                          </span>
                        ) : row.model ? (
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Assigned
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            Needs a model
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {rows.length} account{rows.length === 1 ? "" : "s"} ·{" "}
                {assignedCount} assigned ·{" "}
                {rows.filter((r) => r.state === "unlinked").length} not yet saved
              </span>
              {modelNames.length > 0 && (
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  {modelNames.map((m) => (
                    <Badge
                      key={m}
                      variant="secondary"
                      className="rounded-md font-normal"
                    >
                      {m}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}