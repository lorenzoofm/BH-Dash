"use client";
import {LogOut, ShieldAlert, UserCog} from "lucide-react";
import {LinkBtn, Notice, PageHeader, Panel, Pill} from "@/components/bh/ui";
import {initials} from "@/lib/team";

export default function AccountView({email, isAdmin, denied}: {email: string; isAdmin: boolean; denied: boolean}) {
  return <div className="mx-auto max-w-3xl space-y-6">
    <PageHeader eyebrow="Account" title="Your account"/>

    {denied && <Notice role="alert" icon={ShieldAlert}>That page is not enabled for your account. Ask an administrator to update your page access.</Notice>}

    <Panel>
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-inverse text-[15px] font-bold text-text-inverse">{initials(email.split("@")[0])}</span>
        <div className="min-w-0 flex-1">
          <p className="break-all text-[18px] font-bold tracking-[-0.02em] text-foreground">{email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <Pill tone={isAdmin ? "ink" : "gray"}>{isAdmin ? "Administrator" : "Manager"}</Pill>
            Signed in with Google
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-2 border-t pt-6">
        {isAdmin && <LinkBtn variant="primary" href="/account/users"><UserCog/>Manage dashboard users</LinkBtn>}
        <LinkBtn href="/sign-out"><LogOut/>Sign out</LinkBtn>
      </div>
    </Panel>
  </div>;
}
