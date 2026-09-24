"use client";
import {ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Loader2, Minus, X} from "lucide-react";
import {useEffect} from "react";
import {cn} from "@/lib/utils";

// Small, opinionated building blocks shared by every page.

export function PageHeader({title, subtitle, actions, eyebrow}: {title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode}) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      {eyebrow && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">{eyebrow}</div>}
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function Panel({title, subtitle, icon: Icon, actions, children, className, bodyClass, flush}: {title?: React.ReactNode; subtitle?: React.ReactNode; icon?: any; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string; flush?: boolean}) {
  return <section className={cn("rounded-xl border bg-card shadow-[0_1px_2px_rgba(16,19,16,0.04)]", className)}>
    {(title || actions) && <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-5">
      <div className="min-w-0">
        {title && <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">{Icon && <Icon className="size-4 text-muted-foreground"/>}{title}</h2>}
        {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>}
    <div className={cn(flush ? "" : "p-5", bodyClass)}>{children}</div>
  </section>;
}

export function Stat({label, value, sub, icon: Icon, delta, deltaLabel, tone, accent}: {label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: any; delta?: number | null; deltaLabel?: string; tone?: "positive" | "negative" | ""; accent?: boolean}) {
  return <div className={cn("relative overflow-hidden rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,19,16,0.04)]", accent && "border-foreground bg-foreground text-white")}>
    <div className={cn("flex items-center justify-between text-[12px] font-medium", accent ? "text-white/60" : "text-muted-foreground")}>
      {label}{Icon && <Icon className={cn("size-4", accent ? "text-brand" : "text-muted-foreground/70")}/>}
    </div>
    <div className={cn("num mt-3 text-[28px] font-semibold leading-none tracking-[-0.03em]", tone === "positive" && "text-positive", tone === "negative" && "text-negative", accent && tone === "positive" && "text-emerald-400", accent && tone === "negative" && "text-red-400")}>{value}</div>
    <div className={cn("mt-2.5 flex flex-wrap items-center gap-2 text-[12px]", accent ? "text-white/55" : "text-muted-foreground")}>
      {delta != null && <Delta value={delta} label={deltaLabel}/>}
      {sub}
    </div>
  </div>;
}

export function Delta({value, label, invert}: {value: number; label?: string; invert?: boolean}) {
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", value === 0 ? "bg-muted text-muted-foreground" : good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative")}>
    <Icon className="size-3"/>{Math.abs(value).toLocaleString()}{label && <span className="font-medium opacity-80">&nbsp;{label}</span>}
  </span>;
}

const pillTones: Record<string, string> = {
  green: "bg-positive-soft text-positive ring-positive/15",
  amber: "bg-warning-soft text-warning ring-warning/15",
  red: "bg-negative-soft text-negative ring-negative/15",
  orange: "bg-brand-soft text-brand ring-brand/15",
  gray: "bg-muted text-muted-foreground ring-foreground/5",
  ink: "bg-foreground text-white ring-foreground",
};
export function Pill({tone = "gray", children, dot}: {tone?: keyof typeof pillTones | string; children: React.ReactNode; dot?: boolean}) {
  return <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium ring-1 ring-inset", pillTones[tone] ?? pillTones.gray)}>
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
  return <div className="inline-flex rounded-lg border bg-muted/60 p-0.5">
    {options.map(([v, text]) => <button key={v} type="button" onClick={() => onChange(v)}
      className={cn("rounded-md font-medium transition-all", size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]", value === v ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/5" : "text-muted-foreground hover:text-foreground")}>{text}</button>)}
  </div>;
}

export function Btn({variant = "outline", size = "md", className, children, loading, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: "primary" | "outline" | "ghost" | "danger" | "brand"; size?: "sm" | "md" | "icon"; loading?: boolean}) {
  return <button {...props} disabled={props.disabled || loading} className={cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
    size === "sm" ? "h-8 px-2.5 text-[12.5px]" : size === "icon" ? "size-8" : "h-9 px-3.5 text-[13px]",
    variant === "primary" && "bg-foreground text-white hover:bg-foreground/85",
    variant === "brand" && "bg-brand text-white hover:bg-brand/90",
    variant === "outline" && "border bg-card hover:bg-muted",
    variant === "ghost" && "hover:bg-muted",
    variant === "danger" && "text-negative hover:bg-negative-soft",
    className)}>{loading && <Loader2 className="animate-spin"/>}{children}</button>;
}

export const inputClass = "h-9 w-full rounded-lg border border-input bg-card px-3 text-[13px] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-muted disabled:text-muted-foreground";

export function Field({label, children, hint, className}: {label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string}) {
  return <label className={cn("grid gap-1.5", className)}>
    <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="text-[11.5px] text-muted-foreground">{hint}</span>}
  </label>;
}

export function Skeleton({className}: {className?: string}) {
  return <div className={cn("animate-pulse rounded-xl bg-foreground/[0.06]", className)}/>;
}

export function PageSkeleton() {
  return <div className="space-y-6">
    <Skeleton className="h-12 w-72"/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[118px]"/>)}</div>
    <Skeleton className="h-96"/>
  </div>;
}

export function Empty({icon: Icon, title, children}: {icon?: any; title: string; children?: React.ReactNode}) {
  return <div className="grid place-items-center rounded-lg border border-dashed px-6 py-12 text-center">
    {Icon && <span className="mb-3 grid size-10 place-items-center rounded-full bg-muted"><Icon className="size-5 text-muted-foreground"/></span>}
    <div className="text-sm font-medium">{title}</div>
    {children && <div className="mt-1 text-[13px] text-muted-foreground">{children}</div>}
  </div>;
}

export function Notice({tone = "amber", icon: Icon, children}: {tone?: "amber" | "red" | "gray"; icon?: any; children: React.ReactNode}) {
  return <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px]",
    tone === "amber" && "border-warning/20 bg-warning-soft text-warning",
    tone === "red" && "border-negative/20 bg-negative-soft text-negative",
    tone === "gray" && "bg-muted text-muted-foreground")}>
    {Icon && <Icon className="mt-0.5 size-4 shrink-0"/>}<div>{children}</div>
  </div>;
}

export function WeekStepper({label, onPrev, onNext, nextDisabled, badge}: {label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean; badge?: React.ReactNode}) {
  return <div className="inline-flex h-9 items-center rounded-lg border bg-card">
    <button onClick={onPrev} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground" aria-label="Previous"><ChevronLeft className="size-4"/></button>
    <span className="flex items-center gap-2 px-1 text-[13px] font-medium">{label}{badge}</span>
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
    <div className="absolute inset-0 bg-foreground/25 backdrop-blur-[1px]" onClick={onClose}/>
    <div role="dialog" aria-modal="true" aria-label={title} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-card shadow-2xl">
      <div className="flex items-start justify-between border-b px-6 py-5">
        <div><h2 className="text-base font-semibold">{title}</h2>{subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}</div>
        <Btn variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X/></Btn>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
    </div>
  </div>;
}

export function Avatar({name, className}: {name: string; className?: string}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold", className)} style={{background: `hsl(${h} 30% 93%)`, color: `hsl(${h} 35% 30%)`}}>{initials}</span>;
}

export function Bar({value, max, className}: {value: number; max: number; className?: string}) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-foreground/80", className)} style={{width: `${max > 0 ? Math.min(100, value / max * 100) : 0}%`}}/></div>;
}

export function TableError({tables}: {tables: {error: Error | null; refetch: () => unknown}[]}) {
  const failed=tables.filter(t=>t.error);
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-5 text-sm"><p className="font-medium">Data could not finish loading.</p><p className="my-2 text-muted-foreground">{failed[0]?.error?.message || "Please retry before editing records."}</p><Btn onClick={()=>failed.forEach(t=>t.refetch())}>Retry loading</Btn></div>;
}
