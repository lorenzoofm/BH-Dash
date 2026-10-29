"use client";
import {ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Loader2, Minus, X} from "lucide-react";
import {useEffect} from "react";
import {cn} from "@/lib/utils";

// Small, opinionated building blocks shared by every page.

export function PageHeader({title, subtitle, actions, eyebrow}: {title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode}) {
  return <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
    <div className="min-w-0">
      {eyebrow && <div className="label-mono mb-4 flex items-center gap-2 text-muted-foreground"><span className="size-1.5 rounded-full bg-signal"/>{eyebrow}</div>}
      <h1 className="text-[40px] font-extrabold leading-[var(--leading-tight)] tracking-[-0.045em] sm:text-[56px]">{title}</h1>
      {subtitle && <p className="mt-3 text-[15px] text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function Panel({title, subtitle, icon: Icon, actions, children, className, bodyClass, flush}: {title?: React.ReactNode; subtitle?: React.ReactNode; icon?: any; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string; flush?: boolean}) {
  return <section className={cn("rounded-[var(--radius-card)] border border-[var(--edge-card)] bg-card shadow-[var(--shadow-card)]", className)}>
    {(title || actions) && <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-1 pt-6">
      <div className="min-w-0">
        {title && <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-[-0.02em]">{Icon && <Icon className="size-4 text-muted-foreground" strokeWidth={1.75}/>}{title}</h2>}
        {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>}
    <div className={cn(flush ? "" : "p-6", bodyClass)}>{children}</div>
  </section>;
}

export function Stat({label, value, sub, icon: Icon, delta, deltaLabel, tone, accent}: {label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: any; delta?: number | null; deltaLabel?: string; tone?: "positive" | "negative" | ""; accent?: boolean}) {
  return <div className={cn("relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--edge-card)] bg-card p-6 text-foreground shadow-[var(--shadow-card)]", accent && "border-surface-inverse bg-surface-inverse text-text-inverse [&_a:hover]:text-signal")}>
    <div className={cn("flex items-center justify-between text-[13px] font-medium", accent ? "text-text-inverse/60" : "text-muted-foreground")}>
      {label}{Icon && <Icon className={cn("size-4", accent ? "text-signal" : "text-muted-foreground/70")} strokeWidth={1.75}/>}
    </div>
    <div className={cn("num mt-5 text-[40px] font-bold leading-none tracking-[-0.05em]", tone === "positive" && "text-[var(--positive-fg)]", tone === "negative" && "text-[var(--negative-fg)]", accent && tone === "positive" && "text-[#3fa86a]", accent && tone === "negative" && "text-[#ff6a4d]")}>{value}</div>
    <div className={cn("mt-4 flex flex-wrap items-center gap-2 text-[12px]", accent ? "text-text-inverse/60" : "text-muted-foreground")}>
      {delta != null && <Delta value={delta} label={deltaLabel}/>}
      {sub}
    </div>
  </div>;
}

export function Delta({value, label, invert}: {value: number; label?: string; invert?: boolean}) {
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", value === 0 ? "bg-muted text-muted-foreground" : good ? "bg-positive-soft text-[var(--positive-fg)]" : "bg-negative-soft text-[var(--negative-fg)]")}>
    <Icon className="size-3"/>{Math.abs(value).toLocaleString()}{label && <span className="font-medium opacity-80">&nbsp;{label}</span>}
  </span>;
}

const pillTones: Record<string, string> = {
  green: "bg-positive-soft text-[var(--positive-fg)] ring-transparent",
  amber: "bg-warning-soft text-[var(--warning-fg)] ring-transparent",
  red: "bg-negative-soft text-[var(--negative-fg)] ring-transparent",
  orange: "bg-brand-soft text-[var(--signal-tint-fg)] ring-transparent",
  gray: "bg-transparent text-muted-foreground ring-[var(--border-subtle)]",
  ink: "bg-surface-inverse text-text-inverse ring-surface-inverse",
};
export function Pill({tone = "gray", children, dot}: {tone?: keyof typeof pillTones | string; children: React.ReactNode; dot?: boolean}) {
  return <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold ring-1 ring-inset", pillTones[tone] ?? pillTones.gray)}>
    {dot && <span className="size-1.5 rounded-full bg-current"/>}{children}
  </span>;
}

// Map common Airtable status labels to a pill tone.
export function statusTone(value: string) {
  const v = value.toLowerCase();
  if (["paid", "active", "above target", "on target", "managed"].includes(v)) return "green";
  if (["unpaid", "setup", "paused", "planned", "below target"].includes(v)) return "amber";
  if (["inactive", "ended", "missed"].includes(v)) return "red";
  if (["scheduled", "chat-only"].includes(v)) return "orange";
  return "gray";
}

export function Segmented<T extends string>({value, options, onChange, size = "md"}: {value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; size?: "sm" | "md"}) {
  return <div className="inline-flex gap-0.5 rounded-full border border-[var(--border-subtle)] bg-muted p-1">
    {options.map(([v, text]) => <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
      className={cn("rounded-full font-semibold transition-colors duration-[var(--dur-fast)]", size === "sm" ? "h-7 px-3 text-[12px]" : "h-8 px-4 text-[13px]", value === v ? "bg-surface-inverse text-text-inverse" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}
  </div>;
}

type BtnStyle = {variant?: "primary" | "outline" | "ghost" | "danger" | "brand"; size?: "sm" | "md" | "icon"};
const btnClass = ({variant = "outline", size = "md"}: BtnStyle, className?: string) => cn(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
  size === "sm" ? "h-8 px-3 text-[12.5px]" : size === "icon" ? "size-9" : "h-10 px-5 text-[13px]",
  variant === "primary" && "bg-surface-inverse text-text-inverse hover:bg-surface-inverse/85",
  variant === "brand" && "bg-signal text-white hover:bg-[var(--signal-deep)]",
  variant === "outline" && "border border-[var(--border-subtle)] bg-card text-foreground hover:border-foreground",
  variant === "ghost" && "text-foreground hover:bg-accent",
  variant === "danger" && "bg-negative-soft text-[var(--negative-fg)] hover:bg-negative/20",
  className);

export function Btn({variant, size, className, children, loading, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & BtnStyle & {loading?: boolean}) {
  return <button {...props} disabled={props.disabled || loading} className={btnClass({variant, size}, className)}>{loading && <Loader2 className="animate-spin"/>}{children}</button>;
}

// A link that looks like Btn.
export function LinkBtn({variant, size, className, ...props}: React.AnchorHTMLAttributes<HTMLAnchorElement> & BtnStyle) {
  return <a {...props} className={btnClass({variant, size}, className)}/>;
}

// On/off control: the whole tile is the switch, so the label is part of the hit area.
export function Switch({checked, onChange, disabled, children, className}: {checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; children: React.ReactNode; className?: string}) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
    className={cn("group flex h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-card px-3 text-left text-[13px] font-medium transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed",
      checked ? "border-[var(--border-subtle)] text-foreground" : "border-[var(--edge-control)] text-muted-foreground",
      !disabled && "hover:border-foreground", className)}>
    <span className="min-w-0 truncate">{children}</span>
    <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur-fast)]", checked ? "bg-surface-inverse" : "bg-muted ring-1 ring-inset ring-[var(--border-subtle)]", disabled && "opacity-40")}>
      <span className={cn("absolute top-0.5 size-4 rounded-full shadow-sm transition-[left] duration-[var(--dur-base)] ease-[var(--ease-snap)]", checked ? "left-[18px] bg-card" : "left-0.5 bg-muted-foreground/70")}/>
    </span>
  </button>;
}

export const inputClass = "h-10 w-full rounded-[var(--radius-control)] border border-[var(--edge-control)] bg-card px-3 text-[13px] text-foreground outline-none transition hover:border-[var(--edge-control-hover)] focus:border-foreground focus:ring-2 focus:ring-signal/20 disabled:bg-muted disabled:text-muted-foreground";

export function Field({label, children, hint, className}: {label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string}) {
  return <label className={cn("grid gap-1.5", className)}>
    <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="text-[11.5px] text-muted-foreground">{hint}</span>}
  </label>;
}

export function Skeleton({className}: {className?: string}) {
  return <div className={cn("animate-pulse rounded-[var(--radius-card)] bg-foreground/[0.06]", className)}/>;
}

export function PageSkeleton() {
  return <div className="space-y-6">
    <Skeleton className="h-12 w-72"/>
    <div className="skeleton-help rounded-[var(--radius-card)] border bg-card p-6 text-sm" role="status">
      <p className="font-medium">This page is taking longer than expected to load.</p>
      <p className="mt-1 text-muted-foreground">Please <a className="underline" href="">reload the page</a>. If it stays here, tell the dashboard administrator which page you opened.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[118px]"/>)}</div>
    <Skeleton className="h-96"/>
  </div>;
}

export function Empty({icon: Icon, title, children}: {icon?: any; title: string; children?: React.ReactNode}) {
  return <div className="grid place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-6 py-14 text-center">
    {Icon && <span className="mb-4 grid size-12 place-items-center rounded-full border border-[var(--border-subtle)] bg-card"><Icon className="size-5 text-foreground" strokeWidth={1.75}/></span>}
    <div className="text-[18px] font-bold tracking-[-0.02em] text-foreground">{title}</div>
    {children && <div className="mt-1 text-[13px] text-muted-foreground">{children}</div>}
  </div>;
}

export function Notice({tone = "amber", icon: Icon, children, role}: {tone?: "amber" | "red" | "green" | "gray"; icon?: any; children: React.ReactNode; role?: "alert" | "status"}) {
  return <div role={role} className={cn("flex items-start gap-2.5 rounded-[var(--radius-row)] border px-4 py-3 text-[13px]",
    tone === "amber" && "border-transparent bg-warning-soft text-[var(--warning-fg)]",
    tone === "green" && "border-transparent bg-positive-soft text-[var(--positive-fg)]",
    tone === "red" && "border-transparent bg-negative-soft text-[var(--negative-fg)]",
    tone === "gray" && "bg-muted text-muted-foreground")}>
    {Icon && <Icon className="mt-0.5 size-4 shrink-0"/>}<div>{children}</div>
  </div>;
}

export function WeekStepper({label, onPrev, onNext, nextDisabled, badge}: {label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean; badge?: React.ReactNode}) {
  return <div className="inline-flex h-10 items-center rounded-full border border-[var(--border-subtle)] bg-card px-1">
    <button onClick={onPrev} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground" aria-label="Previous"><ChevronLeft className="size-4"/></button>
    <span className="flex items-center gap-2 px-1 text-[13px] font-semibold text-foreground">{label}{badge}</span>
    <button onClick={onNext} disabled={nextDisabled} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Next"><ChevronRight className="size-4"/></button>
  </div>;
}

export function Drawer({open, onClose, title, subtitle, children, footer}: {open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-[var(--veil)]" onClick={onClose}/>
    <div role="dialog" aria-modal="true" aria-label={title} className="absolute inset-y-2 right-2 flex w-[calc(100%-1rem)] max-w-md flex-col overflow-hidden rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-overlay)]">
      <div className="flex items-start justify-between border-b px-8 py-6">
        <div><h2 className="text-[22px] font-bold tracking-[-0.03em]">{title}</h2>{subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}</div>
        <Btn variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X/></Btn>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-8 py-6">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t px-8 py-5">{footer}</div>}
    </div>
  </div>;
}

export function Avatar({name, className}: {name: string; className?: string}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?";
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground", className)}>{initials}</span>;
}

export function Bar({value, max, className}: {value: number; max: number; className?: string}) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-foreground", className)} style={{width: `${max > 0 ? Math.min(100, value / max * 100) : 0}%`}}/></div>;
}

export function TableError({tables}: {tables: {error: Error | null; refetch: () => unknown}[]}) {
  const failed=tables.filter(t=>t.error);
  return <div role="alert" className="rounded-[var(--radius-card)] border border-destructive/30 bg-card p-6 text-sm"><p className="font-medium">Data could not finish loading.</p><p className="my-2 text-muted-foreground">{failed[0]?.error?.message || "Please retry before editing records."}</p><Btn onClick={()=>failed.forEach(t=>t.refetch())}>Retry loading</Btn></div>;
}
