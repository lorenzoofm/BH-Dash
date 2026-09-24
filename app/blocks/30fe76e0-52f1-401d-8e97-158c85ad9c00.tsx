"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { datasource, q, useProxyFetch, useRecords } from "@/lib/datasource";
import { useCurrentUser } from "@/lib/user";
import { useTextSetting } from "@/lib/editable-settings";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  Calendar,
  DollarSign,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";

const ds = datasource.define({
  staq: "23c2a0b3-fddb-456e-8aa4-1c0822c7521c",
  map: "map",
});

// Airtable -> field NAMES
const mapSelect = q.select({
  slug: "Account Slug",
  accountId: "Account ID",
  ofUsername: "OF Username",
  model: "Model",
  include: "Include in P&L",
});

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const AGENCY_MONTHLY = "https://api.creatorstaq.com/v1/computed/revenue/monthly";

type StaqAccountMonth = {
  account_id: number;
  slug: string;
  name: string;
  net: number;
};
type StaqMonthlyByAccount = { month: string; accounts: StaqAccountMonth[] };
type StaqCohort = {
  month: string;
  new_fan_revenue: string;
  existing_fan_revenue: string;
  ghost_revenue: string;
};
type StaqAgencyMonthly = {
  months?: number;
  monthly_by_account?: StaqMonthlyByAccount[];
  cohorts?: StaqCohort[];
};

type AccountRow = {
  accountId: number;
  slug: string;
  apiName: string;
  model: string;
  include: boolean;
  mapped: boolean;
  byMonth: Map<string, number>;
  total: number;
};

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

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

function money(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function money2(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthLabel(iso: string) {
  const [y, m] = String(iso).split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function safeKey(v: string) {
  return String(v).replace(/[^a-zA-Z0-9]+/g, "_");
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
  const [months, setMonths] = useState("12");
  const [grouping, setGrouping] = useState<"model" | "account">("model");

  const mapRes = useRecords({
    from: ds.map,
    select: mapSelect,
    count: 100,
    enabled: allowed,
  });

  const agency = useQuery<StaqAgencyMonthly>({
    queryKey: ["creatorstaq", "agency-monthly", months],
    queryFn: async () => {
      const res = await proxyFetch(`${AGENCY_MONTHLY}?months=${months}`);
      if (res.status === 403) {
        throw new Error(
          "Sign in with an authorised manager account to access Creatorstaq.",
        );
      }
      if (!res.ok) {
        throw new Error(`Creator Staq returned ${res.status}`);
      }
      return res.json();
    },
    staleTime: 60000,
    retry: 1,
    enabled: allowed,
  });

  const mappings = useMemo(
    () =>
      (mapRes.data?.pages.flatMap((p) => p.items) ?? []).map((r) => ({
        recordId: r.id,
        slug: String(r.fields.slug ?? "").trim(),
        accountId: num(r.fields.accountId),
        ofUsername: String(r.fields.ofUsername ?? "").trim(),
        model: linkName(r.fields.model),
        include: r.fields.include === true,
      })),
    [mapRes.data],
  );

  const mapByAccountId = useMemo(() => {
    const m = new Map<number, (typeof mappings)[number]>();
    mappings.forEach((r) => {
      if (r.accountId) m.set(r.accountId, r);
    });
    return m;
  }, [mappings]);

  const buckets = agency.data?.monthly_by_account ?? [];
  const monthKeys = useMemo(
    () => buckets.map((b) => b.month).filter(Boolean),
    [buckets],
  );

  // account id -> { slug, apiName, model, include, byMonth, total }
  const perAccount = useMemo(() => {
    const acc = new Map<number, AccountRow>();

    // seed from the mapping table so a zero-revenue account still shows
    mappings.forEach((r) => {
      if (!r.accountId) return;
      acc.set(r.accountId, {
        accountId: r.accountId,
        slug: r.slug,
        apiName: "",
        model: r.model,
        include: r.include,
        mapped: true,
        byMonth: new Map<string, number>(),
        total: 0,
      });
    });

    buckets.forEach((b) => {
      (b.accounts ?? []).forEach((a) => {
        const id = num(a.account_id);
        let t = acc.get(id);
        if (!t) {
          const rec = mapByAccountId.get(id);
          t = {
            accountId: id,
            slug: String(a.slug ?? ""),
            apiName: "",
            model: rec?.model ?? "",
            include: rec ? rec.include : true,
            mapped: Boolean(rec),
            byMonth: new Map<string, number>(),
            total: 0,
          };
          acc.set(id, t);
        }
        if (a.name && !t.apiName) t.apiName = String(a.name);
        if (!t.slug && a.slug) t.slug = String(a.slug);
        const v = num(a.net);
        t.byMonth.set(b.month, (t.byMonth.get(b.month) ?? 0) + v);
        t.total += v;
      });
    });

    return Array.from(acc.values());
  }, [buckets, mappings, mapByAccountId]);

  const included = useMemo(
    () => perAccount.filter((a) => a.include),
    [perAccount],
  );

  function groupLabel(a: AccountRow) {
    if (grouping === "account") return a.slug || `#${a.accountId}`;
    if (a.model) return a.model;
    return "Unassigned";
  }

  const byGroup = useMemo(() => {
    const m = new Map<
      string,
      { byMonth: Map<string, number>; total: number; accounts: string[] }
    >();
    included.forEach((a) => {
      const key = groupLabel(a);
      if (!m.has(key))
        m.set(key, { byMonth: new Map(), total: 0, accounts: [] });
      const g = m.get(key)!;
      g.accounts.push(a.slug || `#${a.accountId}`);
      a.byMonth.forEach((v, k) => g.byMonth.set(k, (g.byMonth.get(k) ?? 0) + v));
      g.total += a.total;
    });
    return m;
  }, [included, grouping]);

  const groupNames = useMemo(
    () =>
      Array.from(byGroup.keys()).sort(
        (a, b) => (byGroup.get(b)?.total ?? 0) - (byGroup.get(a)?.total ?? 0),
      ),
    [byGroup],
  );

  const chartConfig = useMemo(() => {
    const cfg: Record<string, { label: string; color: string }> = {};
    groupNames.forEach((g, i) => {
      cfg[safeKey(g)] = { label: g, color: PALETTE[i % PALETTE.length] };
    });
    return cfg as ChartConfig;
  }, [groupNames]);

  const chartData = useMemo(
    () =>
      monthKeys.map((mk) => {
        const row: Record<string, string | number> = { month: monthLabel(mk) };
        groupNames.forEach((g) => {
          row[safeKey(g)] = Number(
            (byGroup.get(g)?.byMonth.get(mk) ?? 0).toFixed(2),
          );
        });
        return row;
      }),
    [monthKeys, groupNames, byGroup],
  );

  const totalsByMonth = useMemo(() => {
    const m = new Map<string, number>();
    included.forEach((a) =>
      a.byMonth.forEach((v, k) => m.set(k, (m.get(k) ?? 0) + v)),
    );
    return m;
  }, [included]);

  const latest = monthKeys[monthKeys.length - 1];
  const prior = monthKeys[monthKeys.length - 2];
  const netLatest = latest ? (totalsByMonth.get(latest) ?? 0) : 0;
  const netPrior = prior ? (totalsByMonth.get(prior) ?? 0) : 0;
  const momDelta =
    netPrior > 0 ? ((netLatest - netPrior) / netPrior) * 100 : null;
  const windowTotal = monthKeys.reduce(
    (s, k) => s + (totalsByMonth.get(k) ?? 0),
    0,
  );
  const earning = included.filter((a) => a.total > 0);
  const top = groupNames[0];
  const topTotal = top ? (byGroup.get(top)?.total ?? 0) : 0;

  const unassigned = included.filter((a) => !a.model && a.total > 0);
  const unmappedFromApi = perAccount.filter((a) => !a.mapped);

  const cohortLatest = useMemo(() => {
    const rows = agency.data?.cohorts ?? [];
    return rows.find((c) => c.month === latest) ?? null;
  }, [agency.data, latest]);

  const cohortTotal = cohortLatest
    ? num(cohortLatest.new_fan_revenue) +
      num(cohortLatest.existing_fan_revenue) +
      num(cohortLatest.ghost_revenue)
    : 0;

  const shownMonths = monthKeys.slice(-7);
  const loading = agency.status === "pending" || mapRes.status === "pending";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 opacity-60" />
                Latest full month
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {loading ? "-" : money(netLatest)}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {momDelta === null ? (
                  latest ? monthLabel(latest) : "no data"
                ) : (
                  <>
                    {momDelta >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-rose-600" />
                    )}
                    <span
                      className={
                        momDelta >= 0 ? "text-emerald-600" : "text-rose-600"
                      }
                    >
                      {momDelta >= 0 ? "+" : ""}
                      {momDelta.toFixed(0)}%
                    </span>
                    <span>
                      {monthLabel(latest)} vs {monthLabel(prior)}
                    </span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5 opacity-60" />
                Net across the window
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {loading ? "-" : money(windowTotal)}
              </div>
              <div className="text-xs text-muted-foreground">
                {monthKeys.length} month{monthKeys.length === 1 ? "" : "s"} ·{" "}
                {earning.length} earning account
                {earning.length === 1 ? "" : "s"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 opacity-60" />
                Top {grouping === "model" ? "model" : "account"}
              </div>
              <div className="mt-1 truncate text-2xl font-semibold">
                {loading || !top ? "-" : top}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {top && windowTotal > 0
                  ? `${money(topTotal)} · ${((topTotal / windowTotal) * 100).toFixed(0)}% of net`
                  : "no revenue in this window"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <User className="h-3.5 w-3.5 opacity-60" />
                New-fan share
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {cohortLatest && cohortTotal > 0
                  ? `${((num(cohortLatest.new_fan_revenue) / cohortTotal) * 100).toFixed(0)}%`
                  : "-"}
              </div>
              <div className="text-xs text-muted-foreground">
                {cohortLatest
                  ? `of ${monthLabel(latest)} · rest from existing and ghost fans`
                  : "no cohort data"}
              </div>
            </CardContent>
          </Card>
        </div>

        {agency.status === "error" && (
          <Card className="border-rose-500/40">
            <CardContent className="flex items-start gap-2.5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <div className="font-medium">Could not load revenue</div>
                <div className="text-muted-foreground">
                  {(agency.error as Error)?.message}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {unassigned.length > 0 && (
          <Card className="border-amber-500/40">
            <CardContent className="flex items-start gap-2.5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <div className="font-medium">
                  {money(
                    unassigned.reduce((s, a) => s + a.total, 0),
                  )}{" "}
                  of revenue has no model assigned
                </div>
                <div className="text-muted-foreground">
                  {unassigned
                    .map(
                      (a) =>
                        `${a.slug}${a.apiName ? ` (Creator Staq calls this "${a.apiName}")` : ""}`,
                    )
                    .join(", ")}{" "}
                  — set a model in the accounts table above and it moves out of
                  &quot;Unassigned&quot;.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {unmappedFromApi.length > 0 && (
          <Card className="border-amber-500/40">
            <CardContent className="flex items-start gap-2.5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <div className="font-medium">
                  {unmappedFromApi.length} account
                  {unmappedFromApi.length === 1 ? "" : "s"} earned revenue but
                  are not in your accounts table
                </div>
                <div className="text-muted-foreground">
                  {unmappedFromApi
                    .map((a) => `${a.slug || `#${a.accountId}`}`)
                    .join(", ")}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="w-full overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-start gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  Monthly net revenue
                </h2>
                <p className="text-sm text-muted-foreground">
                  Post-chargeback net from the Creator Staq earnings ledger, after
                  OnlyFans&apos; 20%. Complete calendar months only — the month in
                  progress is excluded until it closes.
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Select
                  value={grouping}
                  onValueChange={(v) => setGrouping(v as "model" | "account")}
                >
                  <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                    <Sparkles className="h-3 w-3 opacity-60" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="model">By model</SelectItem>
                    <SelectItem value="account">By account</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={months} onValueChange={setMonths}>
                  <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                    <Calendar className="h-3 w-3 opacity-60" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">Last 6 months</SelectItem>
                    <SelectItem value="12">Last 12 months</SelectItem>
                    <SelectItem value="24">Last 24 months</SelectItem>
                    <SelectItem value="all">All time</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => agency.refetch()}
                  disabled={agency.isFetching}
                >
                  <RefreshCw
                    className={
                      "h-3.5 w-3.5 " + (agency.isFetching ? "animate-spin" : "")
                    }
                  />
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                Loading revenue from Creator Staq
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                No revenue returned for this window.
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[300px] w-full">
                <BarChart data={chartData} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    fontSize={12}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    fontSize={12}
                    tickFormatter={(v) => money(Number(v))}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {groupNames.map((g) => (
                    <Bar
                      key={g}
                      dataKey={safeKey(g)}
                      stackId="net"
                      fill={`var(--color-${safeKey(g)})`}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="w-full overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">
                {grouping === "model"
                  ? "Revenue by model"
                  : "Revenue by account"}
              </h2>
              <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                {groupNames.length}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Net per month, newest on the right. The total column covers the
              whole selected window, not just the columns shown.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative max-h-[70vh] w-full overflow-auto border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-xs font-medium text-muted-foreground backdrop-blur">
                      <span className="inline-flex items-center gap-1.5">
                        {grouping === "model" ? (
                          <Sparkles className="h-3 w-3 opacity-60" />
                        ) : (
                          <User className="h-3 w-3 opacity-60" />
                        )}
                        {grouping === "model" ? "Model" : "Account"}
                      </span>
                    </TableHead>
                    {shownMonths.map((mk) => (
                      <TableHead
                        key={mk}
                        className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-right text-xs font-medium text-muted-foreground backdrop-blur"
                      >
                        {monthLabel(mk)}
                      </TableHead>
                    ))}
                    <TableHead className="sticky top-0 z-10 h-9 whitespace-nowrap bg-muted/40 px-3 text-right text-xs font-medium text-muted-foreground backdrop-blur">
                      <span className="inline-flex items-center gap-1.5">
                        <DollarSign className="h-3 w-3 opacity-60" />
                        Window total
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell
                        colSpan={shownMonths.length + 2}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        Loading
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && groupNames.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={shownMonths.length + 2}
                        className="h-24 text-center text-sm text-muted-foreground"
                      >
                        Nothing to show yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading &&
                    groupNames.map((g) => {
                      const row = byGroup.get(g);
                      return (
                        <TableRow
                          key={g}
                          className="h-12 border-b transition-colors hover:bg-muted/40"
                        >
                          <TableCell className="px-3 py-2 text-sm">
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                                {initials(g)}
                              </span>
                              <div className="leading-tight">
                                <div className="font-medium">{g}</div>
                                {grouping === "model" && (
                                  <div className="text-xs text-muted-foreground">
                                    {row?.accounts.join(", ")}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          {shownMonths.map((mk) => {
                            const v = row?.byMonth.get(mk) ?? 0;
                            return (
                              <TableCell
                                key={mk}
                                className="px-3 py-2 text-right text-sm tabular-nums"
                              >
                                {v ? (
                                  money2(v)
                                ) : (
                                  <span className="text-muted-foreground">
                                    -
                                  </span>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="px-3 py-2 text-right text-sm font-medium tabular-nums">
                            {money2(row?.total ?? 0)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  {!loading && groupNames.length > 0 && (
                    <TableRow className="h-12 border-b bg-muted/30">
                      <TableCell className="px-3 py-2 text-sm font-semibold">
                        Total
                      </TableCell>
                      {shownMonths.map((mk) => (
                        <TableCell
                          key={mk}
                          className="px-3 py-2 text-right text-sm font-semibold tabular-nums"
                        >
                          {money2(totalsByMonth.get(mk) ?? 0)}
                        </TableCell>
                      ))}
                      <TableCell className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                        {money2(windowTotal)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3 text-sm text-muted-foreground">
              <span>
                Figures are net of OnlyFans&apos; 20% cut and post-chargeback.
              </span>
              {cohortLatest && (
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="rounded-md font-normal">
                    New fans {money(num(cohortLatest.new_fan_revenue))}
                  </Badge>
                  <Badge variant="secondary" className="rounded-md font-normal">
                    Existing {money(num(cohortLatest.existing_fan_revenue))}
                  </Badge>
                  <Badge variant="secondary" className="rounded-md font-normal">
                    Ghost {money(num(cohortLatest.ghost_revenue))}
                  </Badge>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}