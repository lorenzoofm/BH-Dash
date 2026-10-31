"use client";
import {startTransition, useEffect, useMemo, useOptimistic, useRef, useState} from "react";
import {ArrowUpDown, CalendarDays, ChevronDown, CircleDot, Copy, DollarSign, Ellipsis, FilePlus, FileText, Layers, ListFilter, Pencil, Plus, Receipt, Repeat, Rows3, Tag, Trash2, UserRound, X} from "lucide-react";
import {toast} from "@/components/bh/toast";
import {Menu, Popover, Select, type MenuItem} from "@/components/bh/menu";
import {Btn, Drawer, Field, PageHeader, PageSkeleton, Panel, Segmented, Stat, TableError, inputClass} from "@/components/bh/ui";
import {addDays, label, linkIds, money, num, todayIso} from "@/lib/bh";
import {CHOICES, useModels, useTable} from "@/lib/tables";
import {cn} from "@/lib/utils";

type Range = "month" | "next-month" | "last-month" | "90d" | "all";
type Key = "category" | "status" | "model" | "billing";
type Filters = Record<Key, string[]>;
type Cfg = {filters: Filters; sort: string; group: string};
type View = Cfg & {id: string; name: string; system: boolean; position: number};
type Row = {id: string; date: string; description: string; category: string; vendor: string; model: string[]; billing: string; status: string; amount: number; notes: string};

const PROPS: Record<Key, string> = {category: "Category", status: "Status", model: "Model", billing: "Billing"};
const PROP_ICON = {category: Tag, status: CircleDot, model: UserRound, billing: Repeat};
const SORTS = [["date-desc", "Newest first"], ["date-asc", "Oldest first"], ["amount-desc", "Amount, high to low"], ["amount-asc", "Amount, low to high"]];
const GROUPS = [["none", "No grouping"], ["category", "Category"], ["status", "Status"], ["model", "Model"], ["billing", "Billing"]];
const STATUSES: string[] = [...CHOICES.expenseStatus];
const GRID = "grid grid-cols-[130px_minmax(180px,1.4fr)_140px_120px_130px_100px_100px_110px_48px] gap-2 items-center";
const noF = (): Filters => ({category: [], status: [], model: [], billing: []});
const SEED: Omit<View, "id">[] = [
  {name: "All expenses", system: true, filters: noF(), sort: "date-desc", group: "none", position: 0},
  {name: "Ads & traffic", system: false, filters: {...noF(), category: ["Paid traffic", "Paid ads", "Influencer"]}, sort: "date-desc", group: "category", position: 1},
  {name: "Infrastructure", system: false, filters: {...noF(), category: ["VPS", "Infrastructure", "Software"]}, sort: "date-desc", group: "none", position: 2},
  {name: "Outstanding", system: false, filters: {...noF(), status: ["Unpaid", "Planned"]}, sort: "amount-desc", group: "status", position: 3},
  {name: "Subscriptions", system: false, filters: {...noF(), billing: ["Monthly", "Annual"]}, sort: "amount-desc", group: "category", position: 4},
];
const viewFields = (v: Partial<View>) => ({
  ...(v.name != null && {name: v.name}), ...(v.filters && {filters: JSON.stringify(v.filters)}), ...(v.sort && {sort: v.sort}), ...(v.group && {group: v.group}),
  ...(v.system != null && {system: v.system}), ...(v.position != null && {position: v.position}),
});
function parseFilters(s: unknown): Filters {
  try { const f = JSON.parse(String(s || "{}")); return Object.fromEntries((Object.keys(PROPS) as Key[]).map(k => [k, Array.isArray(f[k]) ? f[k].map(String) : []])) as Filters; } catch { return noF(); }
}
// Seeding runs once per page load even if StrictMode or a remount re-runs the effect.
let seeding: Promise<unknown> | null = null;

// Optimistic overlay on a table: the change shows at once, reverts when the write settles (by then the refetch has landed) or fails.
// Writes to the same row are queued so each one's conflict check sees the previous write.
type Act = {id: string; fields?: Record<string, any>; add?: boolean};
function useLive(t: ReturnType<typeof useTable>) {
  const [rows, apply] = useOptimistic(t.rows, (rs, a: Act) => a.add ? [...rs, {id: a.id, fields: a.fields!}] : a.fields ? rs.map(r => r.id === a.id ? {...r, fields: {...r.fields, ...a.fields}} : r) : rs.filter(r => r.id !== a.id));
  const queue = useRef(new Map<string, Promise<unknown>>());
  const run = <T,>(a: Act, write: () => Promise<T>, ok?: string) => new Promise<T | null>(resolve => startTransition(async () => {
    apply(a);
    const prev = queue.current.get(a.id) ?? Promise.resolve();
    const p = prev.then(write); queue.current.set(a.id, p.catch(() => {}));
    try { const r = await p; if (ok) toast(ok); resolve(r); } catch (e: any) { toast.error(e?.message || "Could not save"); resolve(null); }
  }));
  return {rows, run};
}

export default function Expenses() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIso()), []);
  const exp = useTable("expenses"), models = useModels(), viewsT = useTable("expenseViews");
  const E = useLive(exp), V = useLive(viewsT);
  const [range, setRange] = useState<Range>("month");
  const [viewId, setViewId] = useState("");
  const [draft, setDraft] = useState<Cfg | null>(null);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{kind: string; anchor: HTMLElement} | null>(null);

  useEffect(() => {
    if (viewsT.loading || viewsT.error || viewsT.rows.length || seeding) return;
    seeding = Promise.all(SEED.map(v => viewsT.create(viewFields(v)))).catch(e => { seeding = null; toast.error(e.message); });
  }, [viewsT.loading, viewsT.error, viewsT.rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelList = useMemo(() => models.rows.map(m => ({id: m.id, name: label(m.fields.model) || "Untitled", ended: label(m.fields.status) === "Ended"})), [models.rows]);
  const rows: Row[] = useMemo(() => E.rows.map(r => ({id: r.id, date: String(r.fields.date ?? "").slice(0, 10), description: label(r.fields.description), category: label(r.fields.category),
    vendor: label(r.fields.vendor), model: linkIds(r.fields.model), billing: label(r.fields.billing), status: label(r.fields.status), amount: num(r.fields.amount), notes: label(r.fields.notes)})), [E.rows]);
  const views: View[] = useMemo(() => {
    const vs = V.rows.map(r => ({id: r.id, name: label(r.fields.name) || "Untitled view", system: !!r.fields.system, position: num(r.fields.position),
      filters: parseFilters(r.fields.filters), sort: label(r.fields.sort) || "date-desc", group: label(r.fields.group) || "none"})).sort((a, b) => a.position - b.position);
    return vs.length ? vs : [{...SEED[0], id: ""}];
  }, [V.rows]);

  const tables = [exp, models, viewsT];
  if (tables.some(t => t.error)) return <TableError tables={tables}/>;
  if (!today || exp.loading || models.loading || viewsT.loading) return <PageSkeleton/>;

  // Calendar months, so costs booked ahead (later this month or next month) still land in their month's tally.
  const nextStart = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 10);
  const nextEnd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) + 1, 0)).toISOString().slice(0, 10);
  const nextRows = rows.filter(r => r.date >= nextStart && r.date <= nextEnd);
  let a = "0000-00-00", b = "9999-99-99";
  if (range === "month") { a = today.slice(0, 8) + "01"; b = addDays(nextStart, -1); }
  if (range === "next-month") { a = nextStart; b = nextEnd; }
  if (range === "last-month") { b = addDays(today.slice(0, 8) + "01", -1); a = b.slice(0, 8) + "01"; }
  if (range === "90d") { a = addDays(today, -89); b = today; }
  const inRange = rows.filter(r => r.date >= a && r.date <= b);
  const sum = (rs: Row[]) => rs.reduce((s, r) => s + r.amount, 0);
  const paid = inRange.filter(r => r.status === "Paid"), open = inRange.filter(r => r.status !== "Paid");
  const recurring = rows.filter(r => r.billing === "Monthly" && r.status !== "Planned" && r.date >= addDays(today, -30));
  const catMap = new Map<string, number>(); inRange.forEach(r => catMap.set(r.category || "Uncategorised", (catMap.get(r.category || "Uncategorised") ?? 0) + r.amount));
  const cats = [...catMap].sort((x, y) => y[1] - x[1]), top = cats[0]?.[1] || 1;
  const catChoices = [...new Set([...CHOICES.category, ...rows.map(r => r.category).filter(Boolean)])].sort((x, y) => x.localeCompare(y));
  const mName = (id: string) => modelList.find(m => m.id === id)?.name ?? (label(models.all.find(m => m.id === id)?.fields.model) || "Unknown");
  const mLabel = (ids: string[]) => ids.length ? ids.map(mName).join(" + ") : "Shared";

  const view = views.find(v => v.id === viewId) ?? views[0];
  const cfg: Cfg = draft ?? view;
  const sig = (c: Cfg) => JSON.stringify([c.filters, c.sort, c.group]);
  const dirty = !!draft && sig(draft) !== sig(view);
  const setCfg = (fn: (d: Cfg) => void) => { const d: Cfg = JSON.parse(JSON.stringify(cfg)); fn(d); setDraft(d); };
  const matches = (r: Row, c: Cfg) => { const f = c.filters;
    return (!f.category.length || f.category.includes(r.category)) && (!f.status.length || f.status.includes(r.status)) && (!f.billing.length || f.billing.includes(r.billing))
      && (!f.model.length || f.model.some(m => m === "shared" ? !r.model.length : r.model.includes(m))); };
  const valLabel = (k: Key, v: string) => k === "model" ? (v === "shared" ? "Shared" : mName(v)) : v;
  const describe = (c: Cfg) => (Object.keys(PROPS) as Key[]).filter(k => c.filters[k].length).map(k => c.filters[k].map(v => valLabel(k, v)).join(" + ")).join(" · ") || "New view";
  const ql = q.trim().toLowerCase();
  let list = inRange.filter(r => matches(r, cfg));
  if (ql) list = list.filter(r => [r.description, r.vendor, r.notes, r.category].join(" ").toLowerCase().includes(ql));
  const [sk, sd] = cfg.sort.split("-");
  list = [...list].sort((x, y) => (sk === "amount" ? x.amount - y.amount : x.date.localeCompare(y.date)) * (sd === "desc" ? -1 : 1));
  const keyOf = (r: Row) => cfg.group === "category" ? (r.category || "Uncategorised") : cfg.group === "status" ? r.status : cfg.group === "billing" ? r.billing : cfg.group === "model" ? mLabel(r.model) : "";
  const gmap = new Map<string, Row[]>(); list.forEach(r => { const k = keyOf(r); gmap.set(k, [...(gmap.get(k) ?? []), r]); });
  const groups = [...gmap];
  if (cfg.group === "status") groups.sort((x, y) => STATUSES.indexOf(x[0]) - STATUSES.indexOf(y[0])); else if (cfg.group !== "none") groups.sort((x, y) => sum(y[1]) - sum(x[1]));

  // Writes
  const edit = (r: Row, fields: Record<string, any>, ok = "Saved") => E.run({id: r.id, fields}, () => exp.update(r.id, fields), ok);
  const setModels = (r: Row, ids: string[]) => E.run({id: r.id, fields: {model: ids.map(id => ({id, label: mName(id)}))}}, () => exp.update(r.id, {model: ids}), "Model: " + mLabel(ids));
  const switchView = (id: string) => { setViewId(id); setDraft(null); setCollapsed({}); setMenu(null); };
  const newView = async (name: string, c: Cfg) => {
    setMenu(null);
    const v = {name, filters: c.filters, sort: c.sort, group: c.group, system: false, position: Math.max(0, ...views.map(x => x.position)) + 1};
    const tmp = "tmp-" + Date.now();
    switchView(tmp);
    // Switch to the real id inside the write, before the optimistic row is dropped, so the tab never flickers.
    const r = await V.run({id: tmp, add: true, fields: viewFields(v)}, async () => { const c: any = await viewsT.create(viewFields(v)); setViewId(c.id); return c; }, "View “" + name + "” created");
    if (!r) switchView(view.id);
  };
  const saveView = () => {
    if (view.system || !view.id) { newView(describe(cfg), cfg); return; }
    const fields = viewFields(cfg); setDraft(null);
    V.run({id: view.id, fields}, () => viewsT.update(view.id, fields), "“" + view.name + "” saved");
  };
  const renameView = (name: string) => {
    setMenu(null); name = name.trim();
    if (!name || name === view.name || view.system) return;
    V.run({id: view.id, fields: {name}}, () => viewsT.update(view.id, {name}), "Renamed to “" + name + "”");
  };
  const deleteView = () => { const id = view.id; switchView(views.find(v => v.system)?.id ?? ""); V.run({id}, () => viewsT.remove(id), "View deleted"); };
  const remove = (r: Row) => { setConfirm(null); E.run({id: r.id}, () => exp.remove(r.id), "Deleted"); };

  // Toolbar menus
  const openMenu = (kind: string) => (e: React.MouseEvent<HTMLElement>) => { const el = e.currentTarget; setMenu(m => m?.anchor === el && m.kind === kind ? null : {kind, anchor: el}); };
  const closeIf = (kind: string) => () => setMenu(m => m?.kind === kind ? null : m);
  const mk = menu?.kind ?? "";
  const filterKey = mk.startsWith("filter:") ? mk.slice(7) as Key : null;
  const filterOpts = (k: Key): {v: string; l: string}[] => k === "category" ? catChoices.map(v => ({v, l: v})) : k === "status" ? STATUSES.map(v => ({v, l: v}))
    : k === "billing" ? CHOICES.billing.map(v => ({v, l: v})) : [{v: "shared", l: "Shared (no model)"}, ...modelList.map(m => ({v: m.id, l: m.name}))];
  const countFor = (k: Key, v: string) => inRange.filter(r => k === "model" ? (v === "shared" ? !r.model.length : r.model.includes(v)) : r[k] === v).length;
  const singleCat = (c: string) => views.find(v => v.filters.category.length === 1 && v.filters.category[0] === c && !v.filters.status.length && !v.filters.model.length && !v.filters.billing.length);
  const newViewSections = [
    {title: "New view", items: [{value: "blank", label: "Blank view", icon: FilePlus}, {value: "copy", label: "Copy of “" + view.name + "”", icon: Copy}]},
    {title: "A page per category", items: catChoices.map(c => ({value: "cat:" + c, label: c, text: c, icon: Tag, note: singleCat(c) ? "Open" : String(inRange.filter(r => r.category === c).length || "")}))},
    {title: "A page per model", items: modelList.map(m => ({value: "model:" + m.id, label: m.name, text: m.name, icon: UserRound}))},
  ];
  const pickNewView = (v: string) => {
    if (v === "blank") newView("Untitled view", {filters: noF(), sort: "date-desc", group: "none"});
    else if (v === "copy") newView(view.name + " copy", cfg);
    else if (v.startsWith("cat:")) { const c = v.slice(4), ex = singleCat(c); if (ex) switchView(ex.id); else newView(c, {filters: {...noF(), category: [c]}, sort: "date-desc", group: "none"}); }
    else { const id = v.slice(6); newView(mName(id), {filters: {...noF(), model: [id]}, sort: "date-desc", group: "none"}); }
  };

  const chips = (Object.keys(PROPS) as Key[]).filter(k => cfg.filters[k].length).map(k => ({k, vals: cfg.filters[k].map(v => valLabel(k, v))}));
  const toolBtn = "inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium text-[var(--ink-600)] hover:bg-[var(--ink-100)] [&_svg]:size-[13px]";

  return <div className="space-y-6">
    <PageHeader eyebrow="Finance" title="Expenses" subtitle="Every operational cost. Paid expenses are deducted in the P&L; planned and unpaid ones are tracked here."
      actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus/>Add expense</Btn>}/>

    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={() => setRange("next-month")} className="text-[12.5px] text-muted-foreground hover:text-foreground">
        Booked for {new Date(nextStart + "T00:00:00Z").toLocaleString("en-US", {month: "long", timeZone: "UTC"})}: <span className="num font-semibold text-foreground">{money(sum(nextRows))}</span> across {nextRows.length} cost{nextRows.length === 1 ? "" : "s"}</button>
      <Segmented size="sm" value={range} onChange={setRange} options={[["last-month", "Last month"], ["month", "This month"], ["next-month", "Next month"], ["90d", "90 days"], ["all", "All time"]] as const}/>
    </div>

    <div className="grid gap-4" style={{gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))"}}>
      <Stat label="Total recorded" icon={Receipt} value={money(sum(inRange))} sub={`${inRange.length} expenses`}/>
      <Stat label="Paid" icon={DollarSign} value={money(sum(paid))} sub="Deducted in the P&L"/>
      <Stat label="Unpaid & planned" icon={CalendarDays} value={money(sum(open))} tone={open.length ? "negative" : ""} sub={`${open.length} outstanding`}/>
      <Stat label="Monthly recurring" icon={Repeat} value={money(sum(recurring))} sub={`${recurring.length} monthly subscriptions`}/>
    </div>

    <Panel title="By category" subtitle="Click a category to filter the log, or open it as its own page from New view.">
      <div className="grid gap-x-8 gap-y-4" style={{gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))"}}>
        {cats.map(([n, v]) => { const only = cfg.filters.category.length === 1 && cfg.filters.category[0] === n;
          return <button key={n} type="button" title="Filter the log by this category" className="text-left" onClick={() => setCfg(d => { d.filters.category = only ? [] : [n]; })}>
            <div className="mb-1.5 flex justify-between text-[13px] text-[var(--text-body)]"><span className={cfg.filters.category.includes(n) ? "font-bold" : ""}>{n}</span><span className="num font-medium">{money(v)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ink-100)]"><div className="h-full rounded-full bg-[var(--signal)]" style={{width: `${v / top * 100}%`}}/></div>
          </button>; })}
        {!cats.length && <div className="text-[13px] text-[var(--text-faint)]">No expenses in this period.</div>}
      </div>
    </Panel>

    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--edge-card)] bg-card shadow-[var(--shadow-card)]">
      <header className="px-6 pt-6">
        <h2 className="text-[18px] font-bold tracking-[-0.02em] text-[var(--ink)]">Expense log</h2>
        <p className="mt-1 text-[13px] text-[var(--text-faint)]">Each tab is a saved page of filters, sorting and grouping. Click any cell to edit.</p>
      </header>

      <div className="flex items-end gap-0.5 overflow-x-auto border-b border-[var(--ink-100)] px-4 pt-[14px]">
        {views.map(v => { const on = v.id === view.id, Icon = v.system ? Layers : FileText;
          return <button key={v.id} type="button" aria-current={on ? "page" : undefined} onClick={() => switchView(v.id)}
            className={cn("-mb-px inline-flex h-[38px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[13px] hover:text-[var(--ink)]", on ? "border-[var(--ink)] font-bold text-[var(--ink)]" : "border-transparent font-medium text-[var(--text-faint)]")}>
            <Icon className="size-3.5 shrink-0 opacity-70"/>{v.name}
            <span className={cn("num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold", on ? "bg-[var(--ink)] text-[var(--paper)]" : "bg-[var(--ink-100)] text-[var(--text-faint)]")}>{inRange.filter(r => matches(r, v)).length}</span>
          </button>; })}
        <button type="button" onClick={openMenu("newView")} className="inline-flex h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium text-[var(--text-faint)] hover:text-[var(--ink)]"><Plus className="size-3.5"/>New view</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ink-100)] px-5 py-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, vendor, notes"
          className="h-8 min-w-[180px] flex-[0_1_260px] rounded-[8px] border border-[var(--ink-100)] bg-[var(--surface-card)] px-3 text-[13px] outline-none focus:border-[var(--signal)]"/>
        {chips.map(({k, vals}) => <span key={k} className="inline-flex h-[30px] max-w-[320px] items-center rounded-full bg-[var(--signal-tint)] text-[12.5px] font-semibold text-[var(--signal-deep)]">
          <button type="button" title={PROPS[k] + " is any of " + vals.join(", ")} onClick={openMenu("filter:" + k)} className="h-full truncate pl-3 pr-1">
            {PROPS[k]}: {vals.slice(0, 2).join(", ")}{vals.length > 2 && " +" + (vals.length - 2)}
          </button>
          <button type="button" aria-label={"Remove " + PROPS[k] + " filter"} onClick={() => setCfg(d => { d.filters[k] = []; })} className="grid h-full w-[26px] place-items-center rounded-r-full hover:bg-[#ffcfc2]"><X className="size-3"/></button>
        </span>)}
        <button type="button" onClick={openMenu("addFilter")} className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-dashed border-[var(--ink-200)] px-3 text-[12.5px] font-semibold text-[var(--text-faint)] hover:border-[var(--ink)] hover:text-[var(--ink)]"><ListFilter className="size-[13px]"/>Filter</button>
        <span className="flex-1"/>
        <button type="button" onClick={openMenu("sort")} className={toolBtn}><ArrowUpDown/>{(SORTS.find(s => s[0] === cfg.sort) ?? SORTS[0])[1]}</button>
        <button type="button" onClick={openMenu("group")} className={toolBtn}><Rows3/>{cfg.group === "none" ? "Group" : "Grouped by " + PROPS[cfg.group as Key].toLowerCase()}</button>
        <button type="button" onClick={openMenu("viewMenu")} aria-label="View options" title="Rename, duplicate or delete this view" className="grid size-[30px] place-items-center rounded-[8px] text-[var(--ink-600)] hover:bg-[var(--ink-100)]"><Ellipsis className="size-[15px]"/></button>
        {dirty && <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => setDraft(null)} className="h-[30px] rounded-full px-3 text-[12.5px] font-semibold text-[var(--ink)] hover:bg-[var(--wash)]">Reset</button>
          <button type="button" onClick={saveView} className="h-[30px] rounded-full bg-[var(--ink)] px-3.5 text-[12.5px] font-semibold text-[var(--paper)]">{view.system ? "Save as new view" : "Save view"}</button>
        </span>}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1200px]">
          <div className={cn(GRID, "h-9 bg-[var(--surface-thead)] px-5 text-[11.5px] font-medium text-[var(--text-faint)]")}><span>Date</span><span>Description</span><span>Category</span><span>Vendor</span><span>Model</span><span>Billing</span><span>Status</span><span className="text-right">Amount</span><span/></div>
          {groups.map(([g, rs]) => { const isOpen = !collapsed[g];
            return <div key={g}>
              {cfg.group !== "none" && <button type="button" onClick={() => setCollapsed(c => ({...c, [g]: isOpen}))}
                className="flex h-[38px] w-full items-center justify-between gap-3 border-b border-[var(--ink-100)] bg-[var(--paper)] px-5 text-left hover:bg-[#efebe3]">
                <span className="flex items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
                  <ChevronDown className={cn("size-3 text-[var(--text-faint)] transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)]", !isOpen && "-rotate-90")}/>{g}
                  <span className="text-[12px] font-medium text-[var(--text-faint)]">{rs.length} {rs.length === 1 ? "expense" : "expenses"}</span>
                </span>
                <span className="num text-[13px] font-bold text-[var(--ink)]">{money(sum(rs), 2)}</span>
              </button>}
              {isOpen && rs.map(r => <ExpenseRow key={r.id} r={r} catChoices={catChoices} modelList={modelList} mLabel={mLabel} edit={edit} setModels={setModels}
                confirming={confirm === r.id} onAsk={() => setConfirm(r.id)} onDelete={() => remove(r)}/>)}
            </div>; })}
          {!list.length && <div className="px-5 py-12 text-center text-[13px] text-[var(--text-faint)]">{ql || Object.values(cfg.filters).some(x => x.length) ? "Nothing in this view for the selected period." : "No records"}</div>}
        </div>
      </div>
      <div className="flex gap-3 px-5 py-3 text-[12.5px] text-[var(--text-faint)]"><span>{list.length} expenses in {view.name}{dirty && " (edited)"}</span><span className="num font-medium text-[var(--ink)]">{money(sum(list), 2)}</span></div>
    </section>

    {/* Toolbar menus. Each closes only itself, so "+ Filter" can hand over to a property's filter menu in the same spot. */}
    <Menu key="newView" anchor={menu?.anchor ?? null} open={mk === "newView"} onClose={closeIf("newView")} width={272} sections={newViewSections} onPick={pickNewView}/>
    <Menu key="addFilter" anchor={menu?.anchor ?? null} open={mk === "addFilter"} onClose={closeIf("addFilter")} width={272}
      sections={[{title: "Filter by", items: (Object.keys(PROPS) as Key[]).map(k => ({value: k, label: PROPS[k], icon: PROP_ICON[k], note: cfg.filters[k].length ? cfg.filters[k].length + " set" : ""}))}]}
      onPick={k => setMenu(m => m && {...m, kind: "filter:" + k})}/>
    {filterKey && <Menu key={mk} anchor={menu!.anchor} open onClose={closeIf(mk)} width={272} multi selected={cfg.filters[filterKey]}
      search={filterKey === "category" ? "Search categories" : undefined} empty="Nothing matches."
      summary={cfg.filters[filterKey].length ? cfg.filters[filterKey].length + " selected" : "Pick one or more"}
      sections={[{title: PROPS[filterKey] + " is any of", items: filterOpts(filterKey).map(o => ({value: o.v, label: o.l, text: o.l, note: String(countFor(filterKey, o.v))}))}]}
      onPick={v => setCfg(d => { const s = d.filters[filterKey]; d.filters[filterKey] = s.includes(v) ? s.filter(x => x !== v) : [...s, v]; })}
      actions={cfg.filters[filterKey].length ? [{label: "Remove filter", icon: X, danger: true, onClick: () => setCfg(d => { d.filters[filterKey] = []; })}] : undefined}/>}
    <Menu key="sort" anchor={menu?.anchor ?? null} open={mk === "sort"} onClose={closeIf("sort")} width={272} selected={[cfg.sort]}
      sections={[{title: "Sort by", items: SORTS.map(([value, l]) => ({value, label: l}))}]} onPick={v => setCfg(d => { d.sort = v; })}/>
    <Menu key="group" anchor={menu?.anchor ?? null} open={mk === "group"} onClose={closeIf("group")} width={272} selected={[cfg.group]}
      sections={[{title: "Group by", items: GROUPS.map(([value, l]) => ({value, label: l}))}]} onPick={v => { setCfg(d => { d.group = v; }); setCollapsed({}); }}/>
    <Popover anchor={menu?.anchor ?? null} open={mk === "viewMenu"} onClose={closeIf("viewMenu")} width={272} maxHeight={380}>
      <ViewMenu key={view.id} view={view} onRename={renameView} onDuplicate={() => newView(view.name + " copy", cfg)} onDelete={() => { setMenu(null); deleteView(); }}/>
    </Popover>

    {adding && <AddExpense onClose={() => setAdding(false)} create={exp.create} today={range === "next-month" ? nextStart : today} catChoices={catChoices} modelList={modelList}
      initial={{category: cfg.filters.category.length === 1 ? cfg.filters.category[0] : "Other", model: cfg.filters.model.filter(x => x !== "shared")}}/>}
  </div>;
}

function ViewMenu({view, onRename, onDuplicate, onDelete}: {view: View; onRename: (name: string) => void; onDuplicate: () => void; onDelete: () => void}) {
  const [name, setName] = useState(view.name);
  const row = "flex h-[34px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] font-medium [&_svg]:size-3.5 [&_svg]:shrink-0";
  return <div className="flex flex-col">
    {view.system
      ? <div className="px-2.5 pb-1.5 pt-2.5 font-mono text-[10.5px] uppercase tracking-[.12em] text-[var(--text-faint)]">{view.name} can’t be renamed</div>
      : <div className="px-2 pb-1 pt-2"><input autoFocus onFocus={e => e.target.select()} value={name} onChange={e => setName(e.target.value)} placeholder="View name"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onRename(name); } }}
          className="h-[34px] w-full rounded-[9px] border border-[var(--ink-100)] bg-[var(--surface-card)] px-2.5 text-[13px] outline-none focus:border-[var(--ink)]"/></div>}
    <div className="m-1 border-t border-[var(--ink-100)] pt-1">
      {!view.system && <button type="button" onClick={() => onRename(name)} className={cn(row, "text-[var(--ink)] hover:bg-[var(--ink-100)]")}><Pencil/>Save name</button>}
      <button type="button" onClick={onDuplicate} className={cn(row, "text-[var(--ink)] hover:bg-[var(--ink-100)]")}><Copy/>Duplicate view</button>
      {!view.system && <button type="button" onClick={onDelete} className={cn(row, "text-[var(--negative-fg)] hover:bg-[#f4dad7]")}><Trash2/>Delete view</button>}
    </div>
  </div>;
}

type ModelOpt = {id: string; name: string; ended: boolean};
// "Shared" (value "") is exclusive with picking models; models keep the models-table order.
const modelSections = (modelList: ModelOpt[]) => [{title: "Split across models", items: [{value: "", label: "Shared (no model)", text: "Shared"}, ...modelList.map(m => ({value: m.id, label: m.name, note: m.ended ? "Ended" : ""}))] as MenuItem[]}];
const nextModels = (cur: string[], next: string[], modelList: ModelOpt[]) => next.includes("") && !cur.includes("") && cur.length ? [] : modelList.map(m => m.id).filter(id => next.includes(id));

function ExpenseRow({r, catChoices, modelList, mLabel, edit, setModels, confirming, onAsk, onDelete}: {
  r: Row; catChoices: string[]; modelList: ModelOpt[]; mLabel: (ids: string[]) => string; edit: (r: Row, f: Record<string, any>, ok?: string) => void;
  setModels: (r: Row, ids: string[]) => void; confirming: boolean; onAsk: () => void; onDelete: () => void;
}) {
  const ghost = "h-8 w-full rounded-[6px] border border-transparent bg-transparent px-1.5 outline-none hover:border-[var(--ink-100)] focus:border-[var(--signal)] focus:bg-[var(--surface-card)]";
  const text = (k: "description" | "vendor") => (e: React.FocusEvent<HTMLInputElement>) => { const v = e.target.value.trim(); if (v !== r[k]) edit(r, {[k]: v || null}); };
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
  return <div className={cn(GRID, "min-h-11 border-b border-[var(--ink-100)] px-5 py-0.5 text-[13px] hover:bg-[#e7e3dc4d]")}>
    <input type="date" key={"d" + r.date} defaultValue={r.date} onChange={e => e.target.value && e.target.value !== r.date && edit(r, {date: e.target.value})} className={cn(ghost, "px-1 text-[12.5px]")}/>
    <input key={"t" + r.description} defaultValue={r.description} onBlur={text("description")} onKeyDown={enter} className={cn(ghost, "font-medium")}/>
    <Select variant="none" value={r.category} options={catChoices.map(c => ({value: c, label: c}))} width={272} searchable="Search or add a category"
      onChange={v => v !== r.category && edit(r, {category: v})} onCreate={v => edit(r, {category: v}, "Category “" + v + "” added")} display={r.category || "—"}
      className="h-[26px] w-max max-w-full rounded-[6px] bg-[var(--ink-100)] px-2 text-[12px] text-[var(--text-body)] hover:bg-[#dcd7ce]"/>
    <input key={"v" + r.vendor} defaultValue={r.vendor} placeholder="—" onBlur={text("vendor")} onKeyDown={enter} className={ghost}/>
    <Select variant="cell" multi value={r.model.length ? r.model : [""]} sections={modelSections(modelList)} width={272} display={mLabel(r.model)}
      onChange={(next: string[]) => setModels(r, nextModels(r.model, next, modelList))}
      className={cn("px-1.5 text-[12.5px]", r.model.length ? "text-[var(--text-body)]" : "text-[var(--text-faint)]")}/>
    <Select variant="cell" value={r.billing} options={CHOICES.billing.map(v => ({value: v, label: v}))} onChange={v => v !== r.billing && edit(r, {billing: v})} className="px-1 text-[12.5px]"/>
    <Select variant="none" value={r.status} options={STATUSES.map(v => ({value: v, label: v}))} onChange={v => v !== r.status && edit(r, {status: v})}
      className={cn("h-[26px] w-max rounded-full px-2 text-[11px] font-semibold", r.status === "Paid" ? "bg-positive-soft text-[var(--positive-fg)]" : "bg-warning-soft text-[var(--warning-fg)]")}/>
    <input type="number" min={0} step="0.01" key={"a" + r.amount} defaultValue={r.amount} onKeyDown={enter}
      onBlur={e => { const v = Number(e.target.value); if (e.target.value === "" || !Number.isFinite(v) || v < 0) { toast.error("Enter a number"); e.target.value = String(r.amount); return; } if (v !== r.amount) edit(r, {amount: v}); }}
      className={cn(ghost, "num px-2 text-right font-semibold")}/>
    <div className="flex justify-end">
      {confirming
        ? <button type="button" onClick={onDelete} className="h-7 rounded-full bg-[#f4dad7] px-2.5 text-[12px] font-semibold text-[var(--negative-fg)]">Delete</button>
        : <button type="button" onClick={onAsk} aria-label="Delete row" className="grid size-8 place-items-center rounded-full text-[var(--text-faint)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"><Trash2 className="size-[15px]"/></button>}
    </div>
  </div>;
}

// Mounted only while open, so each opening starts from a fresh form pre-filled from the current view.
function AddExpense({onClose, create, today, catChoices, modelList, initial}: {
  onClose: () => void; create: (f: any) => Promise<any>; today: string; catChoices: string[]; modelList: ModelOpt[]; initial: {category: string; model: string[]};
}) {
  const [f, setF] = useState(() => ({date: today, description: "", amount: "", category: initial.category, vendor: "", model: initial.model, billing: "One-off", status: "Paid", notes: ""}));
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF(x => ({...x, [k]: e.target.value}));
  const ok = !!f.description.trim() && f.amount !== "" && Number(f.amount) >= 0 && !!f.date;
  async function submit() {
    if (!ok) return;
    setBusy(true);
    try {
      const id = `EXP-${f.date.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await create({expenseId: id, date: f.date, description: f.description.trim(), amount: Number(f.amount), currency: "USD", category: f.category.trim() || null,
        vendor: f.vendor || null, model: f.model, billing: f.billing, status: f.status, notes: f.notes || null});
      toast("Expense added"); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const names = f.model.map(id => modelList.find(m => m.id === id)?.name ?? "Unknown");
  return <Drawer open onClose={onClose} title="Add expense" subtitle="Leave Model empty for a shared cost."
    footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!ok}>Add expense</Btn></>}>
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <Field label="Description" className="col-span-2"><input className={inputClass} value={f.description} onChange={set("description")} autoFocus/></Field>
      <Field label="Amount (USD)"><input type="number" min={0} step="0.01" className={inputClass + " num"} value={f.amount} onChange={set("amount")}/></Field>
      <Field label="Date"><input type="date" className={inputClass} value={f.date} onChange={set("date")}/></Field>
      <Field label="Category"><Select value={f.category} options={[...new Set([...catChoices, f.category].filter(Boolean))].map(c => ({value: c, label: c}))} width={272}
        searchable="Search or add a category" onChange={v => setF(x => ({...x, category: v}))} onCreate={v => setF(x => ({...x, category: v}))}/></Field>
      <Field label="Vendor"><input className={inputClass} value={f.vendor} onChange={set("vendor")}/></Field>
      <Field label="Billing"><Select value={f.billing} options={CHOICES.billing.map(v => ({value: v, label: v}))} onChange={v => setF(x => ({...x, billing: v}))}/></Field>
      <Field label="Status"><Select value={f.status} options={STATUSES.map(v => ({value: v, label: v}))} onChange={v => setF(x => ({...x, status: v}))}/></Field>
      <Field label="Models · pick one or more" className="col-span-2">
        <Select multi value={f.model.length ? f.model : [""]} sections={modelSections(modelList)} onChange={(next: string[]) => setF(x => ({...x, model: nextModels(x.model, next, modelList)}))}
          className="h-auto min-h-10 py-1.5" display={<span className="flex flex-wrap gap-1">{names.length
            ? names.map((n, i) => <span key={i} className="inline-flex h-6 items-center rounded-full bg-[var(--ink)] px-[9px] text-[12px] font-semibold text-[var(--paper)]">{n}</span>)
            : <span className="inline-flex h-6 items-center rounded-full bg-[var(--ink-100)] px-[9px] text-[12px] font-semibold text-[var(--ink-600)]">Shared (no model)</span>}</span>}/>
      </Field>
      <Field label="Notes" className="col-span-2"><textarea rows={3} className={inputClass + " h-auto resize-y py-2"} value={f.notes} onChange={set("notes")}/></Field>
    </div>
  </Drawer>;
}
