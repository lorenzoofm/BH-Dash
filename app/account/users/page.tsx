"use client";
import {useEffect, useState} from "react";
import {UserPlus, Users} from "lucide-react";
import {Btn, Empty, Field, Notice, PageHeader, Panel, Pill, Skeleton, Switch, inputClass} from "@/components/bh/ui";
import {toast} from "@/components/bh/toast";
import {initials} from "@/lib/team";
import {PAGES, DEFAULT_MANAGER_PAGES, type Page} from "@/lib/page-access-constants";

const names: Record<Page, string> = {overview: "Overview", conversions: "Conversions", staff: "Staff", "pay-hours": "Pay & Hours", expenses: "Expenses", pnl: "Profit & Loss", revenue: "Revenue", convos: "Convo Tracker"};
type Users = {emails: string[]; admins: string[]; permissions: Record<string, Page[]>; editable: boolean};

export default function UsersPage() {
  const [users, setUsers] = useState<Users>({emails: [], admins: [], permissions: {}, editable: false});
  const [email, setEmail] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(""), [ready, setReady] = useState(false), [invited, setInvited] = useState(""), [copied, setCopied] = useState(false);
  const load = async () => { const response = await fetch("/api/users", {cache: "no-store"}); const data = await response.json() as Users & {error?: string}; if (!response.ok) throw new Error(data.error || "Request failed."); setUsers(data); setReady(true); };
  useEffect(() => { load().catch(e => { setError(e.message); setReady(true); }); }, []);
  const change = async (method: "POST" | "DELETE", target: string) => {
    setBusy(target); setError("");
    try { const response = await fetch("/api/users", {method, headers: {"Content-Type": "application/json"}, body: JSON.stringify({email: target})}); const data = await response.json() as {error?: string}; if (!response.ok) throw new Error(data.error || "Request failed."); await load(); if (method === "POST") setInvited(target); else toast(`${target} deactivated`); setEmail(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update access."); } finally { setBusy(""); }
  };
  const toggle = async (target: string, page: Page) => {
    const current = users.permissions[target] ?? DEFAULT_MANAGER_PAGES;
    const on = current.includes(page), pages = on ? current.filter(p => p !== page) : [...current, page];
    setBusy(target); setError("");
    setUsers(u => ({...u, permissions: {...u.permissions, [target]: pages}}));
    try { const response = await fetch("/api/users", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({email: target, pages})}); const data = await response.json() as {error?: string; pages?: Page[]}; if (!response.ok) throw new Error(data.error || "Request failed."); setUsers(u => ({...u, permissions: {...u.permissions, [target]: data.pages!}})); toast(`${names[page]} ${on ? "hidden from" : "opened for"} ${target}`); }
    catch (e) { setUsers(u => ({...u, permissions: {...u.permissions, [target]: current}})); const msg = e instanceof Error ? e.message : "Could not save page access."; setError(msg); toast.error(msg); } finally { setBusy(""); }
  };
  const copy = () => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => toast.error("Copy failed · clipboard blocked here"));
  const link = typeof window === "undefined" ? "" : window.location.origin;

  return <div className="mx-auto max-w-4xl space-y-6">
    <PageHeader eyebrow="Account · Access" title="Dashboard users" subtitle="Add a manager’s Google email so they can sign in, then choose exactly which dashboard pages they may open."/>

    <Panel title="Add a manager">
      <form onSubmit={e => { e.preventDefault(); void change("POST", email); }} className="flex flex-wrap items-end gap-3">
        <Field label="Google email" className="min-w-[220px] flex-1"><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@example.com" className={inputClass}/></Field>
        <Btn variant="primary" type="submit" disabled={!!busy} loading={!!busy && busy === email}><UserPlus/>Add manager</Btn>
      </form>
    </Panel>

    {invited && <Notice role="status" tone="green">
      <strong className="break-all">{invited}</strong> can now sign in.{" "}
      <a className="font-semibold text-[var(--positive-fg)] underline" href={`mailto:${invited}?subject=${encodeURIComponent("Your 20MG BH dashboard access")}&body=${encodeURIComponent(`Open ${link} and sign in with Google using this email address.`)}`}>Send invitation email</a>
    </Notice>}
    {error && <Notice role="alert" tone="red">{error}</Notice>}
    {ready && !users.editable && <Notice role="status">Page controls are pending the Cloudflare permissions database. Current manager defaults remain active.</Notice>}

    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--edge-card)] bg-card shadow-[var(--shadow-card)]">
      <header className="px-6 pb-4 pt-6"><h2 className="text-[18px] font-bold tracking-[-0.02em] text-[var(--text-heading)]">People with access</h2><p className="mt-1 text-[13px] text-muted-foreground">Changes to page access take effect on the next request.</p></header>
      {!ready ? <div className="space-y-3 border-t p-6" role="status" aria-label="Loading…"><Skeleton className="h-24"/><Skeleton className="h-24"/></div>
        : users.emails.length ? users.emails.map(value => {
          const admin = users.admins.includes(value.toLowerCase()), selected = users.permissions[value] ?? DEFAULT_MANAGER_PAGES;
          return <div key={value} className="border-t px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{initials(value.split("@")[0])}</span>
                <span className="min-w-0 break-all text-[14px] font-semibold text-[var(--text-heading)]">{value}</span>
                <Pill tone={admin ? "ink" : "gray"}>{admin ? "Administrator" : "Manager"}</Pill>
              </div>
              <Btn variant="danger" size="sm" disabled={!!busy} onClick={() => { if (confirm(`Remove dashboard access for ${value}?`)) void change("DELETE", value); }}>Deactivate</Btn>
            </div>
            <div role="group" aria-label={`Pages ${value} can open`} className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {PAGES.map(page => <Switch key={page} checked={admin || selected.includes(page)} disabled={admin || !!busy || !users.editable} onChange={() => void toggle(value, page)}>{names[page]}</Switch>)}
            </div>
            {admin && <p className="mt-3 text-[12px] text-muted-foreground">Administrators always have all pages.</p>}
          </div>;
        })
        : <div className="border-t p-6"><Empty icon={Users} title="No users configured."/></div>}
    </section>

    <Panel title="Dashboard link" subtitle="BH data is stored in the dashboard’s own Cloudflare D1 database.">
      <div className="flex flex-wrap gap-2">
        <input readOnly value={link} aria-label="Dashboard URL" className={inputClass + " min-w-[220px] flex-1 font-mono text-[12px]"} onFocus={e => e.target.select()}/>
        <Btn onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Btn>
      </div>
    </Panel>
  </div>;
}
