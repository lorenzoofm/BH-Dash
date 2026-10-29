"use client";
import {useEffect, useState} from "react";
import {AlertTriangle, Check, CheckCircle2, Copy, Link2, Lock, Mail, UserPlus, Users} from "lucide-react";
import {Avatar, Btn, Empty, Field, Notice, PageHeader, Panel, Pill, Skeleton, Switch, inputClass} from "@/components/bh/ui";
import {PAGES, DEFAULT_MANAGER_PAGES, type Page} from "@/lib/page-access-constants";

const names: Record<Page, string> = {overview: "Overview", conversions: "Conversions", staff: "Staff", "pay-hours": "Pay & Hours", expenses: "Expenses", pnl: "Profit & Loss", revenue: "Revenue"};
type Users = {emails: string[]; admins: string[]; permissions: Record<string, Page[]>; editable: boolean};

export default function UsersPage() {
  const [users, setUsers] = useState<Users>({emails: [], admins: [], permissions: {}, editable: false});
  const [email, setEmail] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(""), [ready, setReady] = useState(false), [invited, setInvited] = useState(""), [copied, setCopied] = useState(false);
  const load = async () => { const response = await fetch("/api/users", {cache: "no-store"}); const data = await response.json() as Users & {error?: string}; if (!response.ok) throw new Error(data.error || "Request failed."); setUsers(data); setReady(true); };
  useEffect(() => { load().catch(e => { setError(e.message); setReady(true); }); }, []);
  const change = async (method: "POST" | "DELETE", target: string) => {
    setBusy(target); setError("");
    try { const response = await fetch("/api/users", {method, headers: {"Content-Type": "application/json"}, body: JSON.stringify({email: target})}); const data = await response.json() as {error?: string}; if (!response.ok) throw new Error(data.error || "Request failed."); await load(); if (method === "POST") setInvited(target); setEmail(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update access."); } finally { setBusy(""); }
  };
  const toggle = async (target: string, page: Page) => {
    const current = users.permissions[target] ?? DEFAULT_MANAGER_PAGES;
    const pages = current.includes(page) ? current.filter(p => p !== page) : [...current, page];
    setBusy(target); setError("");
    try { const response = await fetch("/api/users", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({email: target, pages})}); const data = await response.json() as {error?: string; pages?: Page[]}; if (!response.ok) throw new Error(data.error || "Request failed."); setUsers(u => ({...u, permissions: {...u.permissions, [target]: data.pages!}})); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save page access."); } finally { setBusy(""); }
  };
  const copy = async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const link = typeof window === "undefined" ? "" : window.location.origin;

  return <div className="mx-auto max-w-4xl space-y-6">
    <PageHeader eyebrow="Account · Access" title="Dashboard users" subtitle="Add a manager’s Google email so they can sign in, then choose exactly which dashboard pages they may open."/>

    <Panel title="Add a manager" icon={UserPlus}>
      <form onSubmit={e => { e.preventDefault(); void change("POST", email); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Google email" className="min-w-0 flex-1"><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@example.com" className={inputClass}/></Field>
        <Btn variant="primary" type="submit" disabled={!!busy} loading={!!busy && busy === email}><UserPlus/>Add manager</Btn>
      </form>
    </Panel>

    {invited && <Notice role="status" tone="green" icon={CheckCircle2}>
      <span className="break-all font-semibold">{invited}</span> can now sign in.{" "}
      <a className="inline-flex items-center gap-1 font-semibold underline underline-offset-2" href={`mailto:${invited}?subject=${encodeURIComponent("Your 20MG BH dashboard access")}&body=${encodeURIComponent(`Open ${link} and sign in with Google using this email address.`)}`}><Mail className="size-3.5"/>Send invitation email</a>
    </Notice>}
    {error && <Notice role="alert" tone="red" icon={AlertTriangle}>{error}</Notice>}
    {ready && !users.editable && <Notice role="status" icon={AlertTriangle}>Page controls are pending the Cloudflare permissions database. Current manager defaults remain active.</Notice>}

    <Panel title="People with access" icon={Users} subtitle="Changes to page access take effect on the next request." flush>
      {!ready ? <div className="space-y-3 p-6" role="status" aria-label="Loading…"><Skeleton className="h-24"/><Skeleton className="h-24"/></div>
        : users.emails.length ? <ul className="mt-4 divide-y border-t">{users.emails.map(value => {
          const admin = users.admins.includes(value.toLowerCase()), selected = users.permissions[value] ?? DEFAULT_MANAGER_PAGES;
          return <li key={value} className="px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={value}/>
                <span className="min-w-0 break-all text-[14px] font-semibold text-foreground">{value}</span>
                <Pill tone={admin ? "ink" : "gray"}>{admin ? "Administrator" : "Manager"}</Pill>
              </div>
              <Btn variant="danger" size="sm" disabled={!!busy} onClick={() => { if (confirm(`Remove dashboard access for ${value}?`)) void change("DELETE", value); }}>Deactivate</Btn>
            </div>
            <div role="group" aria-label={`Pages ${value} can open`} className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {PAGES.map(page => <Switch key={page} checked={admin || selected.includes(page)} disabled={admin || !!busy || !users.editable} onChange={() => void toggle(value, page)}>{names[page]}</Switch>)}
            </div>
            {admin && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3.5"/>Administrators always have all pages.</p>}
          </li>;
        })}</ul>
        : <div className="p-6"><Empty icon={Users} title="No users configured."/></div>}
    </Panel>

    <Panel title="Dashboard link" icon={Link2} subtitle="BH data is stored in the dashboard’s own Cloudflare D1 database.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input readOnly value={link} aria-label="Dashboard URL" className={inputClass + " min-w-0 flex-1 font-mono text-[12px]"} onFocus={e => e.target.select()}/>
        <Btn onClick={() => void copy()}>{copied ? <><Check/>Copied</> : <><Copy/>Copy link</>}</Btn>
      </div>
    </Panel>
  </div>;
}
