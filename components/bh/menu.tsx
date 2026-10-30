"use client";
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Check, ChevronDown, Plus} from "lucide-react";
import {cn} from "@/lib/utils";

// The design-system dropdown. Every picker in the dashboard uses this instead of a native <select>.

export type MenuItem = {value: string; label: React.ReactNode; text?: string; note?: React.ReactNode; disabled?: boolean; icon?: any};
export type MenuSection = {title?: string; items: MenuItem[]};
export type MenuAction = {label: string; icon?: any; danger?: boolean; onClick: () => void};

const textOf = (i: MenuItem) => (i.text ?? (typeof i.label === "string" ? i.label : i.value)).toLowerCase();

// Fixed-position panel that stays anchored to its trigger while any ancestor scrolls.
// The up/down direction is chosen once at open; it closes when the trigger leaves the viewport.
export function Popover({anchor, open, onClose, width, minWidth = 160, maxHeight = 320, className, children}: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void; width?: number; minWidth?: number; maxHeight?: number; className?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null), dir = useRef<"up" | "down" | null>(null);
  const [pos, setPos] = useState<{left: number; top: number; w: number} | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    if (!open || !anchor) { dir.current = null; setPos(null); return; }
    const place = () => {
      const r = anchor.getBoundingClientRect(), el = ref.current;
      if (r.bottom < 0 || r.top > innerHeight) { close.current(); return; }
      const w = width ?? Math.max(minWidth, r.width), h = el?.offsetHeight ?? maxHeight;
      if (!dir.current) dir.current = r.bottom + 6 + h > innerHeight - 8 && r.top - 6 - h > 8 ? "up" : "down";
      setPos({w, left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), top: dir.current === "up" ? r.top - 6 - h : r.bottom + 6});
    };
    place(); requestAnimationFrame(place);
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) place(); };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) close.current(); };
    addEventListener("scroll", onScroll, true); addEventListener("resize", place); document.addEventListener("mousedown", onDown, true);
    return () => { removeEventListener("scroll", onScroll, true); removeEventListener("resize", place); document.removeEventListener("mousedown", onDown, true); };
  }, [open, anchor, width, minWidth, maxHeight]);
  if (!open || !anchor || typeof document === "undefined") return null;
  return createPortal(<div ref={ref} style={{left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: width ?? undefined, minWidth: pos?.w, maxHeight}}
    className={cn("bh-pop fixed z-[80] flex flex-col overflow-hidden rounded-[14px] border border-[var(--ink-100)] bg-[var(--surface-card)] text-[var(--text-body)] shadow-[0_16px_48px_#0a0a0a29,0_1px_2px_#0a0a0a0f]", className)}>
    {children}
  </div>, document.body);
}

// A list menu: single or multi select, optional search, "Add '…'" creation, sections, and action rows.
export function Menu({anchor, open, onClose, sections, items, selected = [], multi, onPick, search, onCreate, actions, summary, header, width, empty = "No matches", maxHeight}: {
  anchor: HTMLElement | null; open: boolean; onClose: () => void;
  sections?: MenuSection[]; items?: MenuItem[]; selected?: string[]; multi?: boolean; onPick?: (value: string) => void;
  search?: string; onCreate?: (text: string) => void; actions?: MenuAction[]; summary?: React.ReactNode; header?: React.ReactNode;
  width?: number; empty?: string; maxHeight?: number;
}) {
  const [q, setQ] = useState(""), [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const ql = q.trim().toLowerCase();
  const shown = useMemo(() => (sections ?? [{items: items ?? []}]).map(s => ({...s, items: ql ? s.items.filter(i => textOf(i).includes(ql)) : s.items})).filter(s => s.items.length), [sections, items, ql]);
  const flat = shown.flatMap(s => s.items);
  const canCreate = !!onCreate && !!q.trim() && !flat.some(i => textOf(i) === ql);
  useEffect(() => {
    if (!open) return;
    setQ("");
    const first = flat.findIndex(i => selected.includes(i.value));
    setActive(first >= 0 ? first : flat.findIndex(i => !i.disabled));
    const t = setTimeout(() => (inputRef.current ?? listRef.current)?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({block: "nearest"}); }, [active]);

  const finish = () => { onClose(); anchor?.focus(); };
  const pick = (i: MenuItem) => { if (i.disabled) return; onPick?.(i.value); if (!multi) finish(); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); return; }
    if (e.key === "Tab") { onClose(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!flat.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1; let i = active;
      for (let k = 0; k < flat.length; k++) { i = (i + d + flat.length) % flat.length; if (!flat[i].disabled) break; }
      setActive(i); return;
    }
    if (e.key === "Enter" || (e.key === " " && !search)) {
      e.preventDefault();
      if (flat[active]) pick(flat[active]); else if (canCreate) { onCreate!(q.trim()); finish(); }
    }
  };
  let n = -1;
  return <Popover anchor={anchor} open={open} onClose={onClose} width={width} maxHeight={maxHeight ?? (search != null || multi ? 380 : 320)}>
    <div onKeyDown={keys} className="flex min-h-0 flex-1 flex-col">
      {header}
      {search != null && <div className="px-2 pb-1 pt-2">
        <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setActive(0); }} placeholder={search}
          className="h-[34px] w-full rounded-[9px] border border-[var(--ink-100)] bg-[var(--surface-card)] px-2.5 text-[13px] outline-none focus:border-[var(--ink)]"/>
      </div>}
      <div ref={listRef} tabIndex={-1} role="listbox" aria-multiselectable={multi || undefined} className="min-h-0 flex-1 overflow-y-auto p-1 outline-none">
        {shown.map((s, si) => <div key={si}>
          {s.title && <div className="px-2.5 pb-1.5 pt-2.5 font-mono text-[10.5px] uppercase tracking-[.12em] text-[var(--text-faint)]">{s.title}</div>}
          {s.items.map(i => {
            const k = ++n, on = selected.includes(i.value), Icon = i.icon;
            return <button key={i.value} type="button" role="option" aria-selected={on} disabled={i.disabled} data-i={k}
              onMouseEnter={() => setActive(k)} onClick={() => pick(i)}
              className={cn("flex h-[34px] w-full items-center gap-2.5 whitespace-nowrap rounded-[9px] px-2.5 text-left text-[13px] text-[var(--text-body)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)]/50",
                on ? "font-bold text-[var(--ink)]" : "font-medium", active === k && !i.disabled && "bg-[var(--ink-100)]")}>
              {multi
                ? <span className={cn("grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px]", on ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--ink-200)] bg-[var(--surface-card)]")}>{on && <Check className="size-[11px]" strokeWidth={3}/>}</span>
                : Icon ? <Icon className="size-3.5 shrink-0 text-[var(--text-faint)]"/> : <Check className={cn("size-3.5 shrink-0 text-[var(--signal)]", !on && "opacity-0")} strokeWidth={2.5}/>}
              <span className="truncate">{i.label}</span>
              {i.note != null && i.note !== "" && <span className="num ml-auto pl-2 text-[11.5px] font-medium text-[var(--text-faint)]">{i.note}</span>}
            </button>;
          })}
        </div>)}
        {canCreate && <button type="button" onClick={() => { onCreate!(q.trim()); finish(); }}
          className={cn("flex h-[34px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] font-semibold text-[var(--signal-deep)] hover:bg-[var(--signal-tint)]", active >= flat.length && "bg-[var(--signal-tint)]")}>
          <Plus className="size-3.5 shrink-0"/>Add “{q.trim()}”
        </button>}
        {!flat.length && !canCreate && <div className="p-2.5 text-[12.5px] text-[var(--text-faint)]">{empty}</div>}
        {!!actions?.length && <div className={cn(flat.length > 0 && "mt-1 border-t border-[var(--ink-100)] pt-1")}>
          {actions.map(a => { const Icon = a.icon; return <button key={a.label} type="button" onClick={() => { a.onClick(); onClose(); }}
            className={cn("flex h-[34px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13px] font-medium", a.danger ? "text-[var(--negative-fg)] hover:bg-[#f4dad7]" : "text-[var(--text-body)] hover:bg-[var(--ink-100)]")}>
            {Icon && <Icon className="size-3.5 shrink-0"/>}{a.label}
          </button>; })}
        </div>}
      </div>
      {multi && <div className="flex items-center justify-between gap-2 border-t border-[var(--ink-100)] py-2 pl-3.5 pr-2">
        <span className="text-[12px] text-[var(--text-faint)]">{summary ?? (selected.length ? selected.length + " selected" : "None selected")}</span>
        <button type="button" onClick={finish} className="h-[30px] rounded-full bg-[var(--ink)] px-3.5 text-[12.5px] font-semibold text-[var(--paper)]">Done</button>
      </div>}
    </div>
  </Popover>;
}

// Opens a Menu from any trigger element: const m = useMenu(); <button ref={m.ref} onClick={m.toggle}>…</button><Menu {...m.props} …/>
export function useMenu<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false), [anchor, setAnchor] = useState<T | null>(null);
  return {open, setOpen, ref: setAnchor, anchor, toggle: () => setOpen(o => !o), close: () => setOpen(false), props: {anchor, open, onClose: () => setOpen(false)}};
}

export const triggerKeys = (open: () => void) => (e: React.KeyboardEvent) => { if (["ArrowDown", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); } };

// Single (or multi) value picker with a styled trigger and the shared menu.
// `variant` keeps each call site's look: a 40px form field, a ghost table cell, or a pill.
export function Select({value, options, onChange, placeholder = "—", variant = "field", className, disabled, searchable, onCreate, multi, display, sections, ariaLabel, width}: {
  value: string | string[] | null | undefined; options?: {value: string; label: React.ReactNode; text?: string; note?: React.ReactNode; disabled?: boolean}[]; sections?: MenuSection[];
  onChange: (value: any) => void; placeholder?: string; variant?: "field" | "cell" | "pill" | "none"; className?: string; disabled?: boolean;
  searchable?: boolean | string; onCreate?: (text: string) => void; multi?: boolean; display?: React.ReactNode; ariaLabel?: string; width?: number;
}) {
  const m = useMenu();
  const selected = value == null ? [] : Array.isArray(value) ? value : [value];
  const all = sections ? sections.flatMap(s => s.items) : options ?? [];
  const shown = display ?? (selected.length ? selected.map(v => all.find(o => o.value === v)?.label ?? v).reduce<React.ReactNode[]>((a, l, i) => i ? [...a, " + ", l] : [l], []) : <span className="text-[var(--text-faint)]">{placeholder}</span>);
  const look = {
    field: "h-10 w-full rounded-[var(--radius-control)] border border-[var(--edge-control)] bg-[var(--surface-card)] px-3 text-[13px] hover:border-[var(--edge-control-hover)] focus-visible:border-[var(--ink)]",
    cell: "h-8 w-full rounded-[8px] border border-transparent bg-transparent px-2 text-[13px] hover:border-[var(--ink-100)] focus-visible:border-[var(--signal)] focus-visible:bg-[var(--surface-card)]",
    pill: "h-7 rounded-full px-2.5 text-[12px] font-semibold",
    none: "",
  }[variant];
  return <>
    <button ref={m.ref} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={m.open} aria-label={ariaLabel}
      onClick={m.toggle} onKeyDown={triggerKeys(() => m.setOpen(true))}
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-left outline-none disabled:cursor-not-allowed disabled:opacity-60", look, className)}>
      <span className="min-w-0 flex-1 truncate">{shown}</span>
      <ChevronDown className="size-[11px] shrink-0 opacity-60" strokeWidth={2.5}/>
    </button>
    <Menu {...m.props} sections={sections} items={sections ? undefined : options} selected={selected} multi={multi} width={width}
      search={searchable || onCreate ? (typeof searchable === "string" ? searchable : "Search") : undefined} onCreate={onCreate}
      onPick={v => multi ? onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]) : onChange(v)}/>
  </>;
}
