"use client";
import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {toast} from "sonner";
import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from "recharts";
import {AlertTriangle, Banknote, CalendarDays, CircleDot, Hash, Link2, Percent, Plus, Store, Tag, TrendingUp, Trophy, User} from "lucide-react";
import {ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent} from "@/components/ui/chart";
import {TableError, Btn, Drawer, Field, Notice, PageHeader, PageSkeleton, Panel, Stat, inputClass} from "@/components/bh/ui";
import {DataGrid} from "@/components/bh/grid";
import {label, linkIds, money, num, todayIso} from "@/lib/bh";
import {completeDapMonth} from "@/lib/finance";
import {useProxyFetch} from "@/lib/datasource";
import {CHOICES, linkOptions, opts, useAccountRevenues, useCreators, useDapAccounts, useTable} from "@/lib/tables";

const MONTHLY = "https://api.creatorstaq.com/v1/computed/revenue/monthly?months=12";
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)", "var(--chart-4)"];

export default function Revenue() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const models = useTable("models"), map = useTable("map");
  const proxyFetch = useProxyFetch("live");
  const monthly = useQuery({queryKey: ["bh-monthly"], staleTime: 300000, retry: 1, queryFn: async () => {
    const res = await proxyFetch(MONTHLY);
    const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Creator Staq returned ${res.status}`);
    return (body.monthly_by_account ?? []) as {month: string; accounts: {account_id: number; name: string; net: number | string}[]}[];
  }});
  const mtd = useCreators(today ? today.slice(0, 8) + "01" : null, today);
  const dap = useDapAccounts();
  const inKey = new Set((dap.data ?? []).map(a => a.slug.toLowerCase()));
  const liveIds = new Set(models.rows.filter(m => label(m.fields.status) !== "Ended").map(m => m.id));
  const dapRows = map.rows.filter(r => r.fields.include !== false && inKey.has(label(r.fields.slug).toLowerCase()) && linkIds(r.fields.model).some(id => liveIds.has(id)));
  const dapSlugs = [...new Set(dapRows.map(r => label(r.fields.slug).toLowerCase()))];
  const accountRevenue = useAccountRevenues(dapSlugs, today ? today.slice(0, 8) + "01" : null, today);
  const revenue = !dap.isSuccess || (dapSlugs.length > 0 && !accountRevenue.isSuccess) || dapSlugs.some(slug => accountRevenue.data?.[slug]?.net == null) ? null : dapSlugs.reduce((sum, slug) => sum + accountRevenue.data![slug].net!, 0);
  const [adding, setAdding] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);

  const d = useMemo(() => {
    const pageModel = new Map(dapRows.map(r => [String(r.fields.accountId), linkIds(r.fields.model)[0]]));
    const modelName = new Map(models.rows.map(m => [m.id, label(m.fields.model)]));
    const shown = [...new Set([...pageModel.values()].filter(Boolean))] as string[];
    const chart = (monthly.data ?? []).map(m => {
      const row: Record<string, any> = {month: m.month.slice(0, 7), total: 0};
      for (const a of m.accounts) {
        const mid = pageModel.get(String(a.account_id));
        if (!mid) continue;
        row[mid] = (row[mid] ?? 0) + num(a.net);
        row.total += num(a.net);
      }
      return row;
    }).sort((a, b) => a.month.localeCompare(b.month));
    const config: ChartConfig = Object.fromEntries(shown.map((id, i) => [id, {label: modelName.get(id) ?? "Model", color: COLORS[i % COLORS.length]}]));
    const thisMonth = today?.slice(0, 7);
    const full = chart.filter(r => r.month !== thisMonth);
    const last = full.at(-1), prev = full.at(-2);
    const dapIds = new Set(dapRows.map(r => String(r.fields.accountId)));
    const completeMonth = (month: string | undefined) => !!month && completeDapMonth([...dapIds], monthly.data?.find(m => m.month.slice(0, 7) === month)?.accounts);
    const fullComplete = full.length > 0 && full.every(r => completeMonth(r.month));
    const best = [...full].sort((a, b) => b.total - a.total)[0];
    const activeNames = models.rows.filter(m => label(m.fields.status) !== "Ended").map(m => label(m.fields.model).toLowerCase());
    const unlinked = (mtd.data ?? []).filter(c => !activeNames.includes(c.name.trim().toLowerCase()));
    return {chart, config, shown, last, prev, best, completeMonth, fullComplete, trailing: full.slice(-6).reduce((s, r) => s + r.total, 0), unlinked};
  }, [monthly.data, map.rows, models.rows, mtd.data, today, dap.data]);

  if ([models, map].some(t => t.error)) return <TableError tables={[models, map]}/>;
  if (!today || models.loading || map.loading) return <PageSkeleton/>;
  const fmtMonth = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", {month: "short", year: "2-digit", timeZone: "UTC"});

  return <div className="space-y-6">
    <PageHeader eyebrow="Finance" title="Revenue" subtitle="DAP account assignments, model deals and available account-level history."
      actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus/>Add model</Btn>}/>

    {(monthly.isError || mtd.isError) && <Notice tone="red" icon={AlertTriangle}>Creator Staq is unavailable: {((monthly.error ?? mtd.error) as Error).message}</Notice>}
    {(dap.isError || accountRevenue.isError || (accountRevenue.isSuccess && dapSlugs.some(slug => accountRevenue.data?.[slug]?.net == null))) && <Notice tone="red" icon={AlertTriangle}>DAP account revenue could not be verified. Current revenue remains unavailable.</Notice>}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat accent label="This month so far" icon={Banknote} value={revenue === null ? "—" : money(revenue)} sub="Included DAP accounts"/>
      <Stat label="Last full month" icon={CalendarDays} value={dap.isSuccess && d.completeMonth(d.last?.month) ? money(d.last!.total) : "—"} delta={dap.isSuccess && d.completeMonth(d.last?.month) && d.completeMonth(d.prev?.month) ? Math.round(d.last!.total - d.prev!.total) : null} deltaLabel="vs prior" sub={d.last ? fmtMonth(d.last.month) : undefined}/>
      <Stat label="Last 6 months" icon={TrendingUp} value={dap.isSuccess && monthly.isSuccess && d.fullComplete && d.chart.length > 0 ? money(d.trailing) : "—"} sub="Full months only"/>
      <Stat label="Best month" icon={Trophy} value={dap.isSuccess && d.fullComplete && d.best ? money(d.best.total) : "—"} sub={d.best ? fmtMonth(d.best.month) : undefined}/>
    </div>

    <Panel title="Monthly net revenue" subtitle="Last 12 months, account-level history for pages visible to the API key.">
      {monthly.isPending ? <div className="h-[280px] animate-pulse rounded-lg bg-muted"/> : !d.chart.some(r => r.total) ? <Notice icon={Link2}>Creator Staq returned no account-level monthly revenue history for the selected key.</Notice> :
        <ChartContainer config={d.config} className="aspect-auto h-[280px] w-full">
          <BarChart data={d.chart} margin={{left: 4, right: 4, top: 8}}>
            <CartesianGrid vertical={false} strokeDasharray="3 3"/>
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={fmtMonth}/>
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}/>
            <ChartTooltip cursor={{fill: "var(--muted)", opacity: 0.6}} content={<ChartTooltipContent labelFormatter={(v: any) => fmtMonth(String(v))}/>}/>
            {d.shown.map((id, i) => <Bar key={id} dataKey={id} stackId="a" fill={`var(--color-${id})`} radius={i === d.shown.length - 1 ? [5, 5, 0, 0] : 0}/>)}
          </BarChart>
        </ChartContainer>}
    </Panel>

    <Panel title="Model deals" icon={Percent} subtitle="Managed: we keep page revenue and pay the model her cut. Chat-only: we earn our cut of page revenue." flush>
      <div className="mt-4 border-t">
        <DataGrid rows={models.rows} initialSort={{key: "model", dir: "asc"}} searchPlaceholder="Search models"
          columns={[
            {key: "model", label: "Model", icon: User, render: r => <span className="font-medium">{label(r.fields.model)}</span>},
            {key: "status", label: "Status", icon: CircleDot, type: "select", options: opts(CHOICES.modelStatus), editable: true},
            {key: "dealType", label: "Deal", icon: Tag, type: "select", options: opts(CHOICES.dealType), editable: true},
            {key: "modelCut", label: "Model’s cut %", icon: Percent, type: "number", editable: true},
            {key: "ourCut", label: "Our cut %", icon: Percent, type: "number", editable: true},
            {key: "basis", label: "Payout basis", type: "select", options: opts(CHOICES.basis), editable: true, render: r => label(r.fields.basis), hideBelow: "lg"},
            {key: "start", label: "Started", icon: CalendarDays, type: "date", editable: true, hideBelow: "lg"},
          ]}
          onUpdate={(id, key, value) => models.update(id, {[key]: value})}/>
      </div>
    </Panel>

    <Panel title="Creator Staq pages" icon={Store} subtitle="Assign only each model’s DAP account here. Turn off DAP account for her other accounts." actions={<Btn size="sm" onClick={() => setAddingAccount(true)}><Plus/>Add account</Btn>} flush>
      <div className="mt-4 border-t">
        <DataGrid rows={map.rows} initialSort={{key: "slug", dir: "asc"}} searchPlaceholder="Search pages"
          columns={[
            {key: "slug", label: "Page", icon: Store, render: r => <span className="font-medium">{label(r.fields.slug)}</span>},
            {key: "accountId", label: "Account ID", icon: Hash, render: r => <span className="num text-muted-foreground">{String(r.fields.accountId ?? "")}</span>},
            {key: "ofUsername", label: "OF username", hideBelow: "lg"},
            {key: "model", label: "Model", icon: User, type: "link", options: linkOptions(models.rows, "model"), editable: true, filter: true},
            {key: "include", label: "DAP account", type: "checkbox", editable: true},
          ]}
          onUpdate={(id, key, value) => map.update(id, {[key]: value})}/>
        {d.unlinked.length > 0 && <div className="border-t px-5 py-3 text-[12.5px] text-muted-foreground">
          Creator Staq names not matched to a model this month: {d.unlinked.map(c => `${c.name} (${money(c.net)})`).join(" · ")}
        </div>}
      </div>
    </Panel>

    <AddModel open={adding} onClose={() => setAdding(false)} create={models.create}/>
    <AddAccount open={addingAccount} onClose={() => setAddingAccount(false)} create={map.create} models={models.rows} existing={map.rows}/>
  </div>;
}

function AddAccount({open, onClose, create, models, existing}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>; models: {id: string; fields: Record<string, any>}[]; existing: {fields: Record<string, any>}[]}) {
  const [slug, setSlug] = useState("");
  const [accountId, setAccountId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSlug(""); setAccountId(""); setModelId(""); } }, [open]);
  async function submit() {
    const id = Number(accountId);
    if (!/^[a-z0-9_-]+$/i.test(slug.trim()) || !Number.isSafeInteger(id) || id <= 0 || !modelId) return toast.error("Enter an account slug, numeric ID and model");
    if (existing.some(r => label(r.fields.slug).toLowerCase() === slug.trim().toLowerCase() || Number(r.fields.accountId) === id)) return toast.error("This account is already mapped");
    setBusy(true);
    try { await create({slug: slug.trim(), accountId: id, model: [modelId], include: true}); toast.success("Account added"); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Add DAP account" subtitle="Use the exact account slug and ID from Creatorstaq. Only selected DAP accounts will count in account-level reports."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Add account</Btn></>}>
    <div className="space-y-4">
      <Field label="Creatorstaq account slug"><input className={inputClass} value={slug} onChange={e => setSlug(e.target.value)} placeholder="irlapril"/></Field>
      <Field label="Account ID"><input className={inputClass} type="number" min="1" step="1" value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="329"/></Field>
      <Field label="Model"><select className={inputClass} value={modelId} onChange={e => setModelId(e.target.value)}><option value="">Choose model</option>{models.map(m => <option key={m.id} value={m.id}>{label(m.fields.model)}</option>)}</select></Field>
    </div>
  </Drawer>;
}

function AddModel({open, onClose, create}: {open: boolean; onClose: () => void; create: (f: any) => Promise<any>}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(""); }, [open]);
  async function submit() {
    setBusy(true);
    try { await create({model: name.trim()}); toast.success(`${name} added — set her deal in the table`); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Drawer open={open} onClose={onClose} title="Add model" subtitle="Then set her deal type and cut in Model deals, and map her pages in the accounts table."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!name.trim()}>Add model</Btn></>}>
    <Field label="Model name"><input className={inputClass} value={name} onChange={e => setName(e.target.value)} autoFocus/></Field>
  </Drawer>;
}
