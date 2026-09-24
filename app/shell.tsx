"use client";
import {useEffect, useState} from "react";
import {usePathname} from "next/navigation";
import {ArrowUpRight, BarChart3, CircleUserRound, Clock, LayoutDashboard, LogOut, Menu, Receipt, TrendingUp, UserCog, Users, Wallet, X} from "lucide-react";

const groups = [
  {title: "", items: [["/", "Overview", LayoutDashboard]]},
  {title: "Operations", items: [["/conversions", "Conversions", BarChart3], ["/staff", "Staff", Users], ["/pay-hours", "Pay & Hours", Clock]]},
  {title: "Finance", items: [["/pnl", "Profit & Loss", Wallet], ["/expenses", "Expenses", Receipt], ["/revenue", "Revenue", TrendingUp]]},
] as const;

export default function Shell({children, email, otherUrl, isAdmin}: {children: React.ReactNode; email: string; otherUrl: string; isAdmin: boolean}) {
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

  const nav = <nav className="flex h-full flex-col">
    <a href="/" className="flex items-center gap-3 px-5 pb-6 pt-6">
      <img src="/20mg.png" alt="20MG" width={34} height={34} className="rounded-lg"/>
      <div className="leading-tight">
        <div className="text-[13px] font-semibold text-white">BH Operations</div>
        <div className="text-[11px] text-white/45">20MG · Black Hat</div>
      </div>
    </a>
    <div className="flex-1 space-y-6 px-3">
      {groups.map(g => <div key={g.title}>
        {g.title && <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">{g.title}</div>}
        <ul className="space-y-0.5">{g.items.map(([href, text, Icon]) => {
          const active = path === href;
          return <li key={href}><a href={href} className={"group relative flex h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors " + (active ? "bg-sidebar-accent font-medium text-white" : "text-white/60 hover:bg-sidebar-accent/60 hover:text-white")}>
            {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand"/>}
            <Icon className={"size-4 " + (active ? "text-brand" : "")}/>{text}
          </a></li>;
        })}</ul>
      </div>)}
    </div>
    <div className="space-y-1 border-t border-sidebar-border px-3 py-4">
      <a href={otherUrl} className="flex h-9 items-center justify-between rounded-md px-3 text-[13px] text-white/60 hover:bg-sidebar-accent hover:text-white">Content Studio<ArrowUpRight className="size-3.5"/></a>
      <a href="/account" className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-white/60 hover:bg-sidebar-accent hover:text-white"><CircleUserRound className="size-4"/>My account</a>
      {isAdmin && <a href="/account/users" className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-white/60 hover:bg-sidebar-accent hover:text-white"><UserCog className="size-4"/>Manage users</a>}
      <div className="flex items-center gap-2.5 px-3 pt-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[11px] font-semibold uppercase text-white">{email[0]}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-white/55">{email}</span>
        <a href="/cdn-cgi/access/logout" target="_top" aria-label="Sign out" className="text-white/40 hover:text-white"><LogOut className="size-4"/></a>
      </div>
    </div>
  </nav>;

  return <div className="min-h-screen">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-sidebar lg:block">{nav}</aside>
    {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)}/><aside className="absolute inset-y-0 left-0 w-64 bg-sidebar">{nav}<button className="absolute right-3 top-6 text-white/60" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5"/></button></aside></div>}
    <div className="lg:pl-60">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5"/></button>
        <span className="text-sm font-semibold">BH Operations</span>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</main>
    </div>
  </div>;
}
