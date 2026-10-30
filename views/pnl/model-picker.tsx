"use client";
import {useState} from "react";
import {Check, ChevronDown, X} from "lucide-react";
import {Popover} from "@/components/bh/menu";
import {ModelAvatar} from "@/components/bh/ui";
import {toast} from "@/components/bh/toast";

export type PickerModel = {id: string; name: string; handle: string; sub: string; avatar: string | null; index: number; ended: boolean; deal: string; disabled?: boolean};

const Face = ({m, size, className}: {m: PickerModel; size: number; className?: string}) =>
  <ModelAvatar name={m.name} src={m.avatar} index={m.index} size={size} className={"shadow-[inset_0_0_0_1px_#0a0a0a14] " + (className ?? "")}/>;

// Selected models as ink pills, plus a dashed trigger that opens the 340px account picker.
export function ModelPicker({models, selected, onChange, activeIds, focus}: {
  models: PickerModel[]; selected: string[]; onChange: (ids: string[]) => void; activeIds: string[]; focus: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null), [open, setOpen] = useState(false), [q, setQ] = useState("");
  const toggle = (id: string) => {
    if (!selected.includes(id)) return onChange([...selected, id]);
    if (selected.length === 1) return toast("Keep at least one model in the P&L");
    onChange(selected.filter(x => x !== id));
  };
  const ql = q.trim().toLowerCase();
  const list = models.filter(m => !ql || (m.handle + " " + m.sub).toLowerCase().includes(ql));
  return <div className="flex flex-wrap items-center gap-2">
    {models.filter(m => selected.includes(m.id)).map(m => <span key={m.id} className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--ink)] px-1 text-[var(--paper)]">
      <Face m={m} size={28}/>
      <span className="flex min-w-0 flex-col leading-[1.15]"><span className="truncate text-[12.5px] font-bold">{m.handle}</span><span className="truncate text-[10.5px] text-[#f4f1ea99]">{m.sub}</span></span>
      <button type="button" onClick={() => toggle(m.id)} aria-label={"Remove " + m.name} aria-disabled={selected.length === 1}
        className="grid size-[26px] place-items-center rounded-full hover:bg-[#f4f1ea26]" style={{opacity: selected.length === 1 ? .35 : 1}}><X className="size-3" strokeWidth={2.5}/></button>
    </span>)}
    <button ref={setAnchor} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setQ(""); setOpen(o => !o); }}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-[var(--ink-200)] bg-card pl-1.5 pr-3.5 text-[12.5px] font-semibold text-foreground hover:border-foreground">
      <span className="flex">{models.filter(m => !selected.includes(m.id) && !m.disabled).slice(0, 3).map(m => <Face key={m.id} m={m} size={24} className="-mr-1.5 border-2 border-[var(--surface-card)] !text-[8.5px]"/>)}</span>
      <span className="ml-1.5">Choose models</span>
      <ChevronDown className="size-[11px] opacity-60" strokeWidth={2.5}/>
    </button>
    <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={340} maxHeight={440} className="rounded-2xl">
      <div role="listbox" aria-multiselectable="true" className="flex min-h-0 flex-1 flex-col" onKeyDown={e => { if (e.key === "Escape") { setOpen(false); anchor?.focus(); } }}>
        <div className="px-2.5 pb-1.5 pt-2.5"><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search Creatorstaq accounts"
          className="h-9 w-full rounded-[10px] border border-[var(--ink-100)] bg-card px-3 text-[13px] outline-none focus:border-foreground"/></div>
        <div className="flex gap-1 px-2.5 pb-1.5">
          {([["All active", () => onChange(activeIds.length ? activeIds : selected)], ["Just one", () => onChange([focus])]] as const).map(([t, fn]) =>
            <button key={t} type="button" onClick={fn} className="h-[26px] rounded-full bg-[var(--ink-100)] px-2.5 text-[11.5px] font-semibold text-foreground hover:bg-[#dcd7ce]">{t}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1">
          {list.map(m => { const on = selected.includes(m.id);
            return <button key={m.id} type="button" role="option" aria-selected={on} disabled={m.disabled} onClick={() => toggle(m.id)}
              className={"flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left hover:bg-[var(--ink-100)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent " + (on ? "bg-[var(--paper)]" : "")}>
              <span className="relative"><Face m={m} size={36} className="!text-[12px]"/>{m.ended && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-[var(--ink-200)] shadow-[0_0_0_2px_var(--surface-card)]"/>}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-foreground">{m.handle}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{m.sub}{m.ended ? " · ended" : ""}{m.deal ? " · " + m.deal : ""}</span></span>
              <span className={"grid size-[18px] shrink-0 place-items-center rounded-md border-[1.5px] " + (on ? "border-[var(--ink)] bg-[var(--ink)]" : "border-[var(--ink-200)] bg-card")}>
                <Check className="size-3 text-[var(--paper)]" strokeWidth={3} style={{opacity: on ? 1 : 0}}/></span>
            </button>; })}
          {!list.length && <div className="px-2.5 py-4 text-[12.5px] text-muted-foreground">No accounts match.</div>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--ink-100)] py-2 pl-3.5 pr-2">
          <span className="num text-[12px] text-muted-foreground">{selected.length} of {models.filter(m => !m.disabled).length} selected</span>
          <button type="button" onClick={() => setOpen(false)} className="h-[30px] rounded-full bg-[var(--ink)] px-3.5 text-[12.5px] font-semibold text-[var(--paper)]">Done</button>
        </div>
      </div>
    </Popover>
  </div>;
}
