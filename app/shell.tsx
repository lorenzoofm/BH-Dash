"use client";
import {useEffect, useState} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {ArrowUpRight, BarChart3, CircleUserRound, Clock, LayoutDashboard, LogOut, Menu, Moon, Receipt, Sun, TrendingUp, UserCog, Users, Wallet, X} from "lucide-react";
import type {Page} from '@/lib/page-access-constants';

const groups = [
  {title: "", items: [["/", "Overview", LayoutDashboard]]},
  {title: "Operations", items: [["/conversions", "Conversions", BarChart3], ["/staff", "Staff", Users], ["/pay-hours", "Pay & Hours", Clock]]},
  {title: "Finance", items: [["/pnl", "Profit & Loss", Wallet], ["/expenses", "Expenses", Receipt], ["/revenue", "Revenue", TrendingUp]]},
] as const;

export default function Shell({children, email, otherUrl, isAdmin, pages}: {children: React.ReactNode; email: string; otherUrl: string; isAdmin: boolean; pages:Page[]}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  // Lets an in-browser agent read the visible report without changing anything.
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(context.registerTool({
        name: "read_visible_bh_report",
        description: "Read the currently visible BH report, including selected period, totals, table rows and loading or error messages. Does not change filters or records.",
        inputSchema: {type: "object", properties: {}, additionalProperties: false},
        annotations: {readOnlyHint: true, untrustedContentHint: true},
        execute(input: any) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("This tool takes no parameters.");
          return {path: window.location.pathname, report: document.querySelector("main")?.innerText.slice(0, 30000) || "Report is not available yet."};
        },
      }, {signal: lifecycle.signal})).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);

  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("bh-theme", next ? "dark" : "light"); } catch {}
  };
  const row = "flex h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[13px] font-medium transition-colors duration-[var(--dur-fast)]";
  const idle = row + " text-muted-foreground hover:bg-accent hover:text-foreground";

  const nav = <nav className="flex h-full flex-col">
    <Link href="/" className="flex items-baseline gap-3 px-6 pb-7 pt-7">
      <span className="text-[30px] font-extrabold leading-none tracking-[-0.07em] text-foreground">20</span>
      <span className="label-mono text-muted-foreground">BH Operations</span>
    </Link>
    <div className="flex-1 space-y-6 overflow-y-auto px-3">
      {groups.map(g => <div key={g.title}>
        {g.title && <div className="label-mono px-3 pb-2 text-muted-foreground">{g.title}</div>}
        <ul className="space-y-0.5">{g.items.filter(([href]) => pages.includes((href==='/'?'overview':href.slice(1)) as Page)).map(([href, text, Icon]) => {
          const active = path === href || path === "/detailed" + (href === "/" ? "/overview" : href);
          return <li key={href}><Link href={href} aria-current={active ? "page" : undefined} className={active ? row + " bg-surface-inverse text-text-inverse" : idle}>
            <Icon className="size-4" strokeWidth={1.75}/>{text}
            {active && <span className="ml-auto size-1.5 rounded-full bg-signal"/>}
          </Link></li>;
        })}</ul>
      </div>)}
    </div>
    <div className="space-y-0.5 border-t px-3 py-4">
      <a href={otherUrl} className={idle + " justify-between"}>Content Studio<ArrowUpRight className="size-3.5"/></a>
      <Link href="/account" className={idle}><CircleUserRound className="size-4" strokeWidth={1.75}/>My account</Link>
      {isAdmin && <Link href="/account/users" className={idle}><UserCog className="size-4" strokeWidth={1.75}/>Manage users</Link>}
      <button type="button" onClick={toggleTheme} className={idle + " w-full"} aria-pressed={dark}>
        {dark ? <Sun className="size-4" strokeWidth={1.75}/> : <Moon className="size-4" strokeWidth={1.75}/>}{dark ? "Paper theme" : "Ink theme"}
      </button>
      <div className="mt-2 flex items-center gap-2.5 rounded-[var(--radius-row)] bg-muted px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-inverse text-[11px] font-bold uppercase text-text-inverse">{email[0]}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{email}</span>
        <a href="/sign-out" aria-label="Sign out" className="text-muted-foreground hover:text-signal"><LogOut className="size-4"/></a>
      </div>
    </div>
  </nav>;

  return <div className="min-h-screen">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">{nav}</aside>
    {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-[var(--veil)]" onClick={() => setOpen(false)}/><aside className="absolute inset-y-0 left-0 w-72 bg-sidebar shadow-[var(--shadow-overlay)]">{nav}<button className="absolute right-4 top-7 text-muted-foreground" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5"/></button></aside></div>}
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="grid size-10 place-items-center rounded-full border bg-card"><Menu className="size-4"/></button>
        <span className="text-[22px] font-extrabold tracking-[-0.07em]">20</span>
        <span className="label-mono text-muted-foreground">BH Operations</span>
      </header>
      <main className="mx-auto max-w-[var(--container-max)] px-4 py-7 sm:px-8 lg:px-12 lg:py-12">{children}</main>
    </div>
  </div>;
}
