"use client";
import {useEffect, useMemo, useRef, useState} from "react";
import {ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ListFilter, Loader2, Search, Trash2} from "lucide-react";
import {toast} from "sonner";
import {cn} from "@/lib/utils";
import {label, linkIds, num, shortDate} from "@/lib/bh";
import {Btn, Pill, statusTone} from "./ui";

export type Row = {id: string; fields: Record<string, any>};
export type Option = {value: string; label: string};
export type Column = {
  key: string;
  label: string;
  icon?: any;
  type?: "text" | "longtext" | "number" | "money" | "date" | "select" | "link" | "checkbox";
  options?: Option[];
  editable?: boolean;
  filter?: boolean;
  align?: "left" | "right";
  width?: string;
  render?: (row: Row) => React.ReactNode;
  sortValue?: (row: Row) => string | number;
  searchValue?: (row: Row) => string;
  hideBelow?: "md" | "lg" | "xl";
};

function display(col: Column, v: any): string {
  if (v === null || v === undefined || v === "") return "";
  switch (col.type) {
    case "money": return num(v).toLocaleString("en-US", {style: "currency", currency: "USD", minimumFractionDigits: 2});
    case "number": return num(v).toLocaleString();
    case "date": return shortDate(String(v).slice(0, 10)) + " " + String(v).slice(0, 4);
    case "link": return (Array.isArray(v) ? v : [v]).map(label).join(", ");
    case "checkbox": return v ? "Yes" : "No";
    default: return label(v);
  }
}

function sortKey(col: Column, row: Row) {
  if (col.sortValue) return col.sortValue(row);
  const v = row.fields[col.key];
  if (col.type === "money" || col.type === "number") return v == null || v === "" ? -Infinity : num(v);
  if (col.type === "date") return String(v ?? "");
  return display(col, v).toLowerCase();
}

function Cell({col, row, onSave}: {col: Column; row: Row; onSave?: (value: any) => Promise<unknown>}) {
  const raw = row.fields[col.key];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<any>(null);
  const editable = !!onSave && col.editable;
  useEffect(() => { if (editing) ref.current?.focus?.(); }, [editing]);

  function start() {
    if (!editable || saving) return;
    if (col.type === "checkbox") { void commit(!raw); return; }
    setDraft(col.type === "link" ? linkIds(raw)[0] ?? "" : col.type === "date" ? String(raw ?? "").slice(0, 10) : raw == null ? "" : col.type === "select" ? label(raw) : String(raw));
    setEditing(true);
  }
  async function commit(value = draft) {
    setEditing(false);
    let out: any = value;
    if (col.type === "number" || col.type === "money") out = value === "" ? null : Number(value);
    if (col.type === "link") out = value ? [value] : [];
    if (col.type !== "link" && col.type !== "checkbox" && out === "") out = null;
    const same = col.type === "link" ? (linkIds(raw)[0] ?? "") === value : col.type === "date" ? String(raw ?? "").slice(0, 10) === (value ?? "") : (raw ?? null) === out || label(raw) === value;
    if (same) return;
    if ((col.type === "number" || col.type === "money") && out !== null && !Number.isFinite(out)) { toast.error("Enter a number"); return; }
    setSaving(true);
    try { await onSave!(out); } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }
  const keys = (e: {key: string}) => {
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Enter" && col.type !== "longtext") commit();
  };

  const align = col.align ?? (col.type === "money" || col.type === "number" ? "right" : "left");
  if (editing) {
    const cls = "h-8 w-full rounded-md border border-brand bg-card px-2 text-[13px] outline-none ring-2 ring-brand/15 " + (align === "right" ? "text-right num" : "");
    if (col.type === "select" || col.type === "link")
      return <select ref={ref} className={cls} value={draft} onChange={e => commit(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={keys}>
        <option value="">—</option>
        {(col.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>;
    return <input ref={ref} className={cls} type={col.type === "date" ? "date" : col.type === "number" || col.type === "money" ? "number" : "text"} step="any"
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => commit()} onKeyDown={keys}/>;
  }

  let content: React.ReactNode;
  if (col.render) content = col.render(row);
  else if (col.type === "select") content = raw ? <Pill tone={statusTone(label(raw))} dot>{label(raw)}</Pill> : null;
  else if (col.type === "checkbox") content = <span className={cn("inline-grid size-4 place-items-center rounded border", raw ? "border-foreground bg-foreground text-white" : "bg-card")}>{raw ? "✓" : ""}</span>;
  else content = display(col, raw);
  const empty = content === "" || content === null || content === undefined;

  return <div onClick={start} title={editable ? "Click to edit" : undefined}
    className={cn("-mx-2 flex min-h-8 items-center rounded-md px-2", align === "right" && "justify-end", (col.type === "money" || col.type === "number") && "num", editable && "cursor-text hover:bg-muted/70 hover:ring-1 hover:ring-border", col.type === "longtext" && "max-w-[260px]")}>
    {saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground"/> : empty ? <span className="text-muted-foreground/50">—</span> : col.type === "longtext" ? <span className="truncate">{content}</span> : content}
  </div>;
}

export function DataGrid({rows, columns, onUpdate, onDelete, loading, toolbar, footer, initialSort, pageSize = 20, rowActions, searchPlaceholder = "Search…", empty = "No records"}: {
  rows: Row[]; columns: Column[];
  onUpdate?: (id: string, key: string, value: any) => Promise<unknown>;
  onDelete?: (row: Row) => Promise<unknown>;
  loading?: boolean; toolbar?: React.ReactNode; footer?: (rows: Row[]) => React.ReactNode;
  initialSort?: {key: string; dir: "asc" | "desc"}; pageSize?: number;
  rowActions?: (row: Row) => React.ReactNode; searchPlaceholder?: string; empty?: string;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let out = rows.filter(r => Object.entries(filters).every(([k, v]) => {
      if (!v) return true;
      const col = columns.find(c => c.key === k)!;
      const raw = r.fields[k];
      return col.type === "link" ? linkIds(raw).includes(v) : label(raw) === v;
    }));
    if (term) out = out.filter(r => columns.some(c => (c.searchValue ? c.searchValue(r) : display(c, r.fields[c.key])).toLowerCase().includes(term)));
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      if (col) out = [...out].sort((a, b) => {
        const x = sortKey(col, a), y = sortKey(col, b);
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1);
      });
    }
    return out;
  }, [rows, columns, search, filters, sort]);

  useEffect(() => setPage(0), [search, filters, sort, rows.length]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const hide = (c: Column) => c.hideBelow === "md" ? "hidden md:table-cell" : c.hideBelow === "lg" ? "hidden lg:table-cell" : c.hideBelow === "xl" ? "hidden xl:table-cell" : "";

  return <div>
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={searchPlaceholder} className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"/>
      </div>
      {columns.filter(c => c.filter).map(c => <div key={c.key} className={cn("relative flex h-8 items-center rounded-lg border bg-card pl-2.5 text-[12.5px]", filters[c.key] && "border-foreground/30 bg-muted")}>
        <ListFilter className="mr-1.5 size-3.5 text-muted-foreground"/>
        <select aria-label={`Filter by ${c.label}`} value={filters[c.key] ?? ""} onChange={e => setFilters(f => ({...f, [c.key]: e.target.value}))} className="h-full appearance-none bg-transparent pr-3 outline-none">
          <option value="">{c.label}: All</option>
          {(c.options ?? []).map(o => <option key={o.value} value={o.value}>{c.label}: {o.label}</option>)}
        </select>
      </div>)}
      <div className="ml-auto flex items-center gap-2">{toolbar}</div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-[13px]">
        <thead>
          <tr className="border-b bg-muted/40">
            {columns.map(c => <th key={c.key} style={{width: c.width}} className={cn("h-9 px-4 text-[11.5px] font-medium text-muted-foreground", hide(c), (c.align ?? (c.type === "money" || c.type === "number" ? "right" : "left")) === "right" ? "text-right" : "text-left")}>
              <button className={cn("inline-flex items-center gap-1.5 hover:text-foreground", sort?.key === c.key && "text-foreground")} onClick={() => setSort(s => s?.key === c.key ? (s.dir === "asc" ? {key: c.key, dir: "desc"} : null) : {key: c.key, dir: "asc"})}>
                {c.icon && <c.icon className="size-3.5 opacity-70"/>}{c.label}
                {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="size-3"/> : <ArrowDown className="size-3"/>)}
              </button>
            </th>)}
            {(onDelete || rowActions) && <th className="w-px"/>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading ? [0, 1, 2, 3, 4].map(i => <tr key={i}><td colSpan={columns.length + 1} className="px-4 py-2.5"><div className="h-5 animate-pulse rounded bg-muted"/></td></tr>)
          : visible.length === 0 ? <tr><td colSpan={columns.length + 1} className="px-4 py-12 text-center text-muted-foreground">{search || Object.values(filters).some(Boolean) ? "Nothing matches these filters." : empty}</td></tr>
          : visible.map(r => <tr key={r.id} className="group hover:bg-muted/30">
            {columns.map(c => <td key={c.key} className={cn("px-4 py-1", hide(c))}>
              <Cell col={c} row={r} onSave={onUpdate ? v => onUpdate(r.id, c.key, v) : undefined}/>
            </td>)}
            {(onDelete || rowActions) && <td className="px-3 py-1">
              <div className="flex items-center justify-end gap-1">
                {rowActions?.(r)}
                {onDelete && (confirm === r.id
                  ? <><Btn size="sm" variant="danger" onClick={async () => { setConfirm(null); try { await onDelete(r); toast.success("Deleted"); } catch (e: any) { toast.error(e.message); } }}>Delete</Btn><Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Btn></>
                  : <Btn size="icon" variant="ghost" className="text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setConfirm(r.id)} aria-label="Delete row"><Trash2/></Btn>)}
              </div>
            </td>}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[12.5px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">{footer ? footer(filtered) : <span>{filtered.length} {filtered.length === 1 ? "row" : "rows"}</span>}</div>
      {pages > 1 && <div className="flex items-center gap-1">
        <span className="mr-2 num">{page * pageSize + 1}–{Math.min(filtered.length, (page + 1) * pageSize)} of {filtered.length}</span>
        <Btn size="icon" variant="ghost" onClick={() => setPage(p => p - 1)} disabled={page === 0} aria-label="Previous page"><ChevronLeft/></Btn>
        <Btn size="icon" variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= pages - 1} aria-label="Next page"><ChevronRight/></Btn>
      </div>}
    </div>
  </div>;
}
