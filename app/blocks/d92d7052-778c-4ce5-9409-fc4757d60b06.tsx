"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { datasource, q, useProxyFetch, useRecords } from "@/lib/datasource";
import { useCurrentUser } from "@/lib/user";
import { useTextSetting } from "@/lib/editable-settings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
const ds = datasource.define({live:"live",models:"models",expenses:"expenses",paylog:"paylog",staff:"staff"});
const modelsSelect = q.select({model:"Model",dealType:"Deal Type",modelCut:"Model's Cut %",ourCut:"Our Cut %"});
const expenseSelect = q.select({date:"Expense Date",amount:"Amount",model:"Model",status:"Status",description:"Description"});
const paySelect = q.select({workDate:"Work Date",staff:"Staff",totalPay:"Total Pay",status:"Payment Status"});
const staffSelect = q.select({name:"Full Name",model:"Model"});
const MANAGED="Managed", CHAT_ONLY="Chat-only";
const RANGED="https://api.creatorstaq.com/v1/computed/revenue/ranged";
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

// LINKED_RECORD fields come back as an array of { id, name }. Every link read on
// this page is single-valued by design, so take the first and unwrap it.
function linkName(v: unknown): string {
  if (Array.isArray(v)) return v.length ? label(v[0]) : "";
  return label(v);
}

// SOFTR PRE-SCALES AIRTABLE PERCENT FIELDS. "Model's Cut %" and "Our Cut %" are both Airtable
// PERCENT fields: Airtable's REST API represents 25% as 0.25, but Softr's datasource returns 25,
// and de-scales symmetrically on write. CONFIRMED at runtime in the browser against real records.
// So the scale factor is ALWAYS 1 - use the value exactly as Softr reports it.
//
// DO NOT reintroduce a scaling factor or a "<= 1" heuristic. The old shareScale() returned 100
// whenever no non-zero share existed in the dataset - a reachable state - which turned a typed
// 30 into 0.003 in Airtable (0.3%, a hundredth of what was intended) while round-trip identity
// hid it completely. That is a silent 100x payout error.

// The raw stored value, or null - NEVER 0 - when a percentage is unset.
function pctRaw(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n =
    typeof v === "number"
      ? v
      : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}

type ModelMeta = {
  dealType: string;
  modelCut: number | null;
  ourCut: number | null;
  known: boolean;
};

const NO_META: ModelMeta = {
  dealType: "",
  modelCut: null,
  ourCut: null,
  known: false,
};

type Econ = {
  dealType: string;
  // 20MG's own revenue. null means it CANNOT be known - never 0, and never the
  // page's gross as a fallback.
  agencyRevenue: number | null;
  payout: number | null;
  payoutApplies: boolean;
  cutPct: number | null;
  cutLabel: string;
  issue: "" | "unknown-model" | "no-deal-type" | "no-our-cut" | "no-model-cut";
};

/* The single place the two business models are turned into money. A missing
   percentage on a page with NO revenue is not an issue: a share of zero is zero
   whatever the share turns out to be. */
function economics(meta: ModelMeta, pageRevenue: number): Econ {
  if (meta.dealType === MANAGED) {
    const knowable = meta.modelCut !== null || pageRevenue === 0;
    return {
      dealType: MANAGED,
      agencyRevenue: pageRevenue,
      payout:
        meta.modelCut !== null
          ? (pageRevenue * meta.modelCut) / 100
          : pageRevenue === 0
            ? 0
            : null,
      payoutApplies: true,
      cutPct: meta.modelCut,
      cutLabel: "to model",
      issue: knowable ? "" : "no-model-cut",
    };
  }
  if (meta.dealType === CHAT_ONLY) {
    const knowable = meta.ourCut !== null || pageRevenue === 0;
    return {
      dealType: CHAT_ONLY,
      agencyRevenue:
        meta.ourCut !== null
          ? (pageRevenue * meta.ourCut) / 100
          : pageRevenue === 0
            ? 0
            : null,
      payout: null,
      payoutApplies: false,
      cutPct: meta.ourCut,
      cutLabel: "to 20MG",
      issue: knowable ? "" : "no-our-cut",
    };
  }
  // No deal type, or no matching row on the Models table at all. The two deals
  // give wildly different answers from the same page revenue, so this is left
  // out of the revenue maths rather than defaulted to either one.
  return {
    dealType: "",
    agencyRevenue: pageRevenue === 0 ? 0 : null,
    payout: null,
    payoutApplies: false,
    cutPct: null,
    cutLabel: "",
    issue:
      pageRevenue === 0 ? "" : meta.known ? "no-deal-type" : "unknown-model",
  };
}


function GateResolving() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <Card className="w-full max-w-xl">
        <CardContent className="p-6">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-3 w-64 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}

function GateUnavailable({ email }: { email: string }) {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <Card className="w-full max-w-xl">
        <CardContent className="p-6">
          <h2 className="text-base font-semibold tracking-tight">
            This page isn&apos;t available on your account.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            There is nothing further to do here.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {email || "no signed-in address"}
            </span>
            . If that address should have access, add it to &ldquo;Who can see
            this page&rdquo; in this block&apos;s settings in Softr Studio.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Block() {
  // Owner-only gate. The allow-list is an editable setting so an address can be
  // added or corrected in Studio without touching code.
  const allowedEmailsSetting = useTextSetting({
    name: "allowed-emails",
    label: "Who can see this page (comma-separated emails)",
    initialValue: "massi@20mg.co, massimo@otfagency.co",
  });
  const gateUser = useCurrentUser();
  const [gateTimedOut, setGateTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGateTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const viewerEmail = String(gateUser?.email ?? "").trim().toLowerCase();
  const allowList = useMemo(
    () =>
      String(allowedEmailsSetting ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e !== ""),
    [allowedEmailsSetting],
  );
  // useCurrentUser() returns null both while resolving and when signed out, so
  // a short grace period keeps the refusal panel from flashing on load.
  const gateResolved = viewerEmail !== "" || gateTimedOut;
  const allowed = viewerEmail !== "" && allowList.includes(viewerEmail);

  // The content lives in a child component that is only MOUNTED when the viewer
  // is allowed. Softr's useRecords silently drops its documented `enabled`
  // option (verified in the compiled runtime), so not mounting the hooks is the
  // only way to stop the datasource requests firing at all. `enabled` is still
  // passed on every hook below: the REST/proxy queries do honour it.
  if (!gateResolved) return <GateResolving />;
  if (!allowed) return <GateUnavailable email={viewerEmail} />;
  return <BlockContent allowed={allowed} />;
}

function money(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2});
}
function addDays(day: string, count: number) {
  const d=new Date(day+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10);
}
function validDay(day: string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date=new Date(day+"T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===day;
}
function ranges(start: string, end: string) {
  const out: {start:string;end:string}[]=[];
  if(!validDay(start)||!validDay(end)||start>end) return out;
  const stop=addDays(end,1);
  for(let day=start;day<stop;) {const next=addDays(day,31)<stop?addDays(day,31):stop;out.push({start:day,end:next});day=next;}
  return out;
}
function useAllPages(result: any) {
  useEffect(()=>{if(result.hasNextPage&&!result.isFetching&&result.status!=="error") result.fetchNextPage();},[result.hasNextPage,result.isFetching,result.status,result.fetchNextPage]);
}
function rowsOf(result: any) {return result.data?.pages.flatMap((p:any)=>p.items)??[];}
function links(value: any, index: Map<string,string>) {
  const values=Array.isArray(value)?value:value?[value]:[];
  return [...new Set(values.map((v:any)=>index.get(String(v?.id??v))??index.get(label(v).toLowerCase())??"unallocated"))];
}
function calculate(models:any[], expenses:any[], wages:any[], staff:any[], creators:any[], start:string, end:string) {
  const modelIndex=new Map<string,string>(), staffIndex=new Map<string,string[]>(), modelRows=new Map<string,any>();
  models.forEach(r=>{
    const f=r.fields, name=label(f.model), key=name.toLowerCase(); if(!key)return;
    modelIndex.set(r.id,key);modelIndex.set(key,key);
    modelRows.set(key,{name,meta:{dealType:label(f.dealType),modelCut:pctRaw(f.modelCut),ourCut:pctRaw(f.ourCut),known:true},pageRevenue:0,expenses:0,wages:0,assigned:false});
  });
  staff.forEach(r=>{const assigned=links(r.fields.model,modelIndex);staffIndex.set(r.id,assigned);staffIndex.set(label(r.fields.name).toLowerCase(),assigned);});
  let allTime=0,recorded=0,excluded=0,unallocated=0,undated=0;
  const inRange=(day:any)=>String(day??"").slice(0,10)>=start&&String(day??"").slice(0,10)<=end;
  function allocate(keys:string[],amount:number,kind:string,inPeriod:boolean) {
    const unique=[...new Set(keys.length?keys:["unallocated"])];
    unique.forEach(key=>{
      const row=modelRows.get(key);
      if(row)row.assigned=true;
      if(!inPeriod)return;
      if(row)row[kind]+=amount/unique.length;else unallocated+=amount/unique.length;
    });
  }
  expenses.forEach(r=>{
    const f=r.fields, amount=num(f.amount),date=String(f.date??"").slice(0,10);allTime+=amount;
    if(!date)undated+=amount;
    const inPeriod=inRange(date);if(inPeriod)recorded+=amount;
    const paid=label(f.status)==="Paid";
    if(inPeriod&&!paid)excluded+=amount;
    allocate(links(f.model,modelIndex),amount,"expenses",inPeriod&&paid);
  });
  wages.forEach(r=>{
    const f=r.fields,amount=num(f.totalPay),date=String(f.workDate??"").slice(0,10);allTime+=amount;
    if(!date)undated+=amount;
    const inPeriod=inRange(date);if(inPeriod)recorded+=amount;
    const refs=Array.isArray(f.staff)?f.staff:f.staff?[f.staff]:[];
    const keys=refs.flatMap((v:any)=>staffIndex.get(String(v?.id??v))??staffIndex.get(label(v).toLowerCase())??["unallocated"]);
    allocate(keys,amount,"wages",inPeriod);
  });
  const unknown:any[]=[];
  creators.forEach(c=>{
    const name=String(c.name??"").trim(), row=modelRows.get(name.toLowerCase());
    if(row)row.pageRevenue+=num(c.net_revenue);else if(num(c.net_revenue)!==0)unknown.push({name:name||"Unnamed creator",amount:num(c.net_revenue)});
  });
  const managed:any[]=[],chat:any[]=[],review:any[]=[];
  modelRows.forEach(row=>{
    const e=economics(row.meta,row.pageRevenue);
    const cost=row.expenses+row.wages;
    const complete=e.agencyRevenue!==null&&(!e.payoutApplies||e.payout!==null);
    const result={...row,revenue:e.agencyRevenue,payout:e.payoutApplies?e.payout:0,profit:complete?e.agencyRevenue!-cost-(e.payout??0):null,issue:e.issue};
    if(row.meta.dealType==="Chat-only")chat.push(result);
    else if(row.meta.dealType==="Managed"&&row.assigned)managed.push(result);
    else if(row.pageRevenue||cost)review.push(result);
  });
  const totals=(rows:any[])=>({revenue:rows.some(r=>r.revenue===null)?null:rows.reduce((s,r)=>s+r.revenue,0),expenses:rows.reduce((s,r)=>s+r.expenses,0),wages:rows.reduce((s,r)=>s+r.wages,0),payout:rows.some(r=>r.payout===null)?null:rows.reduce((s,r)=>s+r.payout,0),profit:rows.some(r=>r.profit===null)?null:rows.reduce((s,r)=>s+r.profit,0)});
  return {managed,chat,review,unknown,main:totals(managed),chatTotal:totals(chat),allTime,recorded,excluded,unallocated,undated};
}
function ProfitSection({title,description,rows,totals,chat=false}:{title:string;description:string;rows:any[];totals:any;chat?:boolean}) {
  return <Card><CardContent className="p-5 sm:p-6 space-y-5">
    <div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {[[chat?"Our chatting fee":"Model revenue",totals.revenue],["Assigned expenses",totals.expenses],["Staff wages",totals.wages],["Model payouts",totals.payout],["Profit",totals.profit]].map(([name,value])=><div key={String(name)} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{name}</div><div className={"mt-1 text-xl font-semibold tabular-nums "+(name==="Profit"?(Number(value)>=0?"text-emerald-700":"text-rose-600"):"")}>{money(value as number|null)}</div></div>)}
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-muted-foreground">{["Model",chat?"Our fee":"Revenue","Expenses","Wages","Model payout","Profit"].map((h,i)=><th key={h} className={"py-3 px-2 whitespace-nowrap font-medium "+(i?"text-right":"text-left")}>{h}</th>)}</tr></thead><tbody>
      {rows.map(r=><tr key={r.name} className="border-b last:border-0"><td className="py-3 px-2">{r.name}{r.issue&&<span className="block text-xs text-amber-700">Check model deal settings</span>}</td>{[r.revenue,r.expenses,r.wages,r.payout,r.profit].map((v,i)=><td key={i} className="py-3 px-2 text-right tabular-nums whitespace-nowrap">{money(v)}</td>)}</tr>)}
      {!rows.length&&<tr><td colSpan={6} className="py-4 text-muted-foreground">No models in this section.</td></tr>}
    </tbody></table></div>
    <p className="text-xs text-muted-foreground">{chat?"Only the configured Our Cut % is earned by the chatting agency. The client’s remaining revenue is excluded.":"Includes managed models linked to operational expenses or staff wages. Chatting-client revenue is excluded."} Expenses are dated by Expense Date; wages by Work Date, whether paid or unpaid. Planned/unpaid operational expenses remain excluded under your existing rule.</p>
  </CardContent></Card>;
}
function BlockContent({allowed}:{allowed:boolean}) {
  const today=new Date().toISOString().slice(0,10);
  const [start,setStart]=useState(today.slice(0,8)+"01"),[end,setEnd]=useState(today);
  const valid=validDay(start)&&validDay(end)&&start<=end&&end<=today;
  const proxyFetch=useProxyFetch(ds.live);
  const models=useRecords({from:ds.models,select:modelsSelect,count:100});
  const expenses=useRecords({from:ds.expenses,select:expenseSelect,count:100});
  const wages=useRecords({from:ds.paylog,select:paySelect,count:100});
  const staff=useRecords({from:ds.staff,select:staffSelect,count:100});
  useAllPages(models);useAllPages(expenses);useAllPages(wages);useAllPages(staff);
  const revenue=useQuery({queryKey:["bh-pnl-calendar",start,end],enabled:allowed&&valid,staleTime:30000,refetchInterval:60000,retry:1,queryFn:async()=>{
    const creators=new Map<string,any>();
    for(const range of ranges(start,end)) {
      const res=await proxyFetch(`${RANGED}?start=${range.start}&end=${range.end}`);
      if(!res.ok)throw new Error(`Revenue service returned ${res.status}`);
      const data:any=await res.json();if(!Array.isArray(data.by_creator))throw new Error("Revenue response is incomplete");
      data.by_creator.forEach((c:any)=>{const key=String(c.creator_id??c.name);const previous=creators.get(key);creators.set(key,{...c,net_revenue:num(c.net_revenue)+(previous?.net_revenue??0)});});
    }
    return [...creators.values()];
  }});
  useEffect(()=>{const timer=setInterval(()=>{models.refetch();expenses.refetch();wages.refetch();staff.refetch();},60000);return()=>clearInterval(timer);},[models.refetch,expenses.refetch,wages.refetch,staff.refetch]);
  const data=useMemo(()=>calculate(rowsOf(models),rowsOf(expenses),rowsOf(wages),rowsOf(staff),revenue.data??[],start,end),[models.data,expenses.data,wages.data,staff.data,revenue.data,start,end]);
  const queries=[models,expenses,wages,staff];
  const failed=revenue.isError||queries.some(r=>r.status==="error");
  const loading=revenue.isPending||queries.some(r=>r.status==="pending"||r.hasNextPage);
  const syncing=revenue.isFetching||queries.some(r=>r.isFetching);
  function refresh(){revenue.refetch();queries.forEach(r=>r.refetch());}
  function quick(value:string){if(value==="today"){setStart(today);setEnd(today);}else if(value==="week"){setStart(addDays(today,-6));setEnd(today);}else if(value==="month"){setStart(today.slice(0,8)+"01");setEnd(today);}else{const last=addDays(today.slice(0,8)+"01",-1);setStart(last.slice(0,8)+"01");setEnd(last);}}
  return <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
    <Card><CardContent className="p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-3"><div><h1 className="text-2xl font-semibold">Profit &amp; loss</h1><p className="text-sm text-muted-foreground mt-1">Choose any day or date range. Both sections update together.</p></div><Button variant="outline" onClick={refresh} disabled={!valid||syncing}>{syncing?"Syncing…":"Refresh"}</Button></div>
      <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Start date<input aria-label="Start date" type="date" value={start} max={today} onChange={e=>setStart(e.target.value)} className="rounded-md border bg-background p-2"/></label><label className="grid gap-1 text-sm">End date<input aria-label="End date" type="date" value={end} max={today} onChange={e=>setEnd(e.target.value)} className="rounded-md border bg-background p-2"/></label><div className="flex flex-wrap gap-2">{[["today","Today"],["week","Last 7 days"],["month","This month"],["last","Last month"]].map(([v,t])=><Button key={v} variant="outline" size="sm" onClick={()=>quick(v)}>{t}</Button>)}</div></div>
      <p className="text-xs text-muted-foreground">Both dates are included. Same start and end date = one day. Revenue uses the Creator Staq daily reporting boundaries and refreshes every minute while this page is open. Live revenue is provisional and may change after chargebacks.</p>
    </CardContent></Card>
    {!valid?<p role="alert" className="text-amber-700">Choose valid dates, with the end date on or after the start date and no later than today.</p>:failed?<Card><CardContent className="p-5 text-destructive" role="alert">Some revenue or cost data could not be loaded. Profit is unavailable. <Button onClick={refresh}>Retry</Button></CardContent></Card>:loading?<p role="status">Loading all revenue, expense and wage records for {start} to {end}…</p>:<>
      <p className="text-sm font-medium">{start===end?start:`${start} to ${end}`} · {syncing?"Updating live data…":"Live data synced"}</p>
      <ProfitSection title="Managed-model P&L" description="Your own models’ performance for the selected dates." rows={data.managed} totals={data.main}/>
      <ProfitSection title="Chatting agency profit" description="Chatting clients are calculated separately and never added to managed-model profit." rows={data.chat} totals={data.chatTotal} chat/>
      <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-medium">Cost reconciliation · {money(data.recorded)} recorded in this period</summary><div className="mt-3 space-y-2 text-sm text-muted-foreground"><p>All-time recorded cost base: {money(data.allTime)}. Recorded in selected dates: {money(data.recorded)}. Outside this period or undated: {money(data.allTime-data.recorded)}.</p><p>Managed assigned costs: {money(data.main.expenses+data.main.wages)}. Chatting assigned costs: {money(data.chatTotal.expenses+data.chatTotal.wages)}. Unallocated costs: {money(data.unallocated)}. Costs awaiting model classification: {money(data.review.reduce((s,r)=>s+r.expenses+r.wages,0))}. Planned/unpaid operational expenses excluded: {money(data.excluded)}. Model payouts are additional.</p><p>Expenses shared by multiple models are split equally. Wages follow the staff member’s current model assignment.</p><a className="underline" href="/expenses">Open expenses and wages</a></div></details>
      {(data.unallocated!==0||data.review.length>0||data.unknown.length>0||data.undated!==0)&&<Card><CardContent className="p-5 text-sm space-y-2"><h2 className="font-semibold">Needs assignment</h2>{data.unallocated!==0&&<p>{money(data.unallocated)} in costs has no recognised model and is not deducted from either section. Assign it on Expenses or Staff.</p>}{data.undated!==0&&<p>{money(data.undated)} in undated costs cannot be included in a date-based P&amp;L.</p>}{data.review.map(r=><p key={r.name}>{r.name}: {money(r.pageRevenue)} page revenue and {money(r.expenses+r.wages)} costs kept outside both sections. Set the deal type or link this managed model to expenses/staff wages.</p>)}{data.unknown.map((r,i)=><p key={i}>{r.name}: {money(r.amount)} page revenue could not be matched to a model. Check the model name.</p>)}</CardContent></Card>}
    </>}
  </div>;
}
