"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { datasource, useRecords, useRecordCreate, useRecordUpdate, q } from "@/lib/datasource";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Search, Plus, Pencil, AlertTriangle, Info, X, CircleDot, Sparkles, Calendar, User,
  Hash, DollarSign, Mail, Layers, Wallet, Coins, Clock, Target, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight,
} from "lucide-react";

// ---------- datasources (Airtable: 20MG Operations) ----------
const ds = datasource.define({ staff: "staff", models: "models", conversions: "conversions", expectations: "expectations" });

// The Conversion Log is WEEKLY: one row per staff member per model per week, dated to that week's
// MONDAY. Read here only to fill the two trailing conversion columns. Computed in-block on
// purpose — the Airtable Staff rollups are a stored copy of derived data and are never read.
const convSelect = q.select({
  weekStarting: "Week Starting",
  staff: "Staff",
  conversions: "Conversions",
});

const staffSelect = q.select({
  staffId: "Staff ID",
  name: "Full Name",
  status: "Status",
  model: "Model",
  platform: "Platform",
  payType: "Pay Type",
  rate: "Current Hourly Rate",
  stdHours: "Standard Daily Hours",
  currency: "Currency",
  startDate: "Start Date",
  endDate: "End Date",
  email: "Email",
});

const modelSelect = q.select({ model: "Model" });

// Staff ID is never written on update.
const updateFields = q.select({
  name: "Full Name",
  status: "Status",
  model: "Model",
  platform: "Platform",
  payType: "Pay Type",
  rate: "Current Hourly Rate",
  stdHours: "Standard Daily Hours",
  currency: "Currency",
  startDate: "Start Date",
  endDate: "End Date",
  email: "Email",
});

const createFields = q.select({
  staffId: "Staff ID",
  name: "Full Name",
  status: "Status",
  model: "Model",
  platform: "Platform",
  payType: "Pay Type",
  rate: "Current Hourly Rate",
  stdHours: "Standard Daily Hours",
  currency: "Currency",
  startDate: "Start Date",
  endDate: "End Date",
  email: "Email",
});

// ---------- helpers ----------
// Airtable SELECT fields come back as { id, label } objects — unwrap before rendering.
function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => label(x)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as { label?: string; name?: string };
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}
// Airtable LINKED_RECORD fields come back as an array of { id, name } (or of record ids).
function linkIds(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x === "string") {
      if (/^rec[A-Za-z0-9]+$/.test(x)) out.push(x);
    } else if (x && typeof x === "object") {
      const id = (x as { id?: string }).id;
      if (id) out.push(String(id));
    }
  }
  return out;
}
function linkLabels(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x === "string") {
      if (!/^rec[A-Za-z0-9]+$/.test(x) && x.trim()) out.push(x.trim());
    } else if (x && typeof x === "object") {
      const o = x as { name?: string; title?: string; label?: string };
      const n = String(o.name ?? o.title ?? o.label ?? "").trim();
      if (n) out.push(n);
    }
  }
  return out;
}
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
// Standard Daily Hours must distinguish "not set" from 0 — an empty default means the Pay & Hours
// grid pre-fills nothing for that person, NOT that they work a zero-hour day. num() would collapse
// both to 0, so every read of that field goes through this instead.
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}
// Airtable dates arrive ISO (yyyy-mm-dd). No slash-date parsing.
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function isoDay(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function isoOf(v: unknown): string { const d = toDate(v); return d ? isoDay(d) : ""; }

// ---------- weekly windows ----------
// Conversions are entered once per week, so a literal rolling 7 / 30 days would slice weeks in
// half and the figure would lurch depending on which day it is read. The two columns below use
// the honest equivalents instead: the last COMPLETE week, and the last 4 COMPLETE weeks. Both
// exclude the current, in-progress week.
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}
function fmtWeek(d: Date) { return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
// A bucket exists only if a Conversion Log row was entered for that week. NO ENTRY IS NOT ZERO:
// sumWeeks returns null when nothing was logged anywhere in the window, and a number (which may
// legitimately be 0) when at least one row exists. Every renderer turns null into an em dash.
type Bucket = { rows: number; total: number; missing?: boolean };
function bump(m: Map<string, Bucket>, key: string, v: number | null) {
  const b = m.get(key) ?? { rows: 0, total: 0 };
  b.rows += 1; b.total += v ?? 0; if (v === null) b.missing = true; m.set(key, b);
}
function sumWeeks(m: Map<string, Bucket> | undefined, keys: string[]): number | null {
  if (!m) return null;
  let any = false;
  let t = 0;
  for (const k of keys) { const b = m.get(k); if (b?.missing) return null; if (b) { any = true; t += b.total; } }
  return any ? t : null;
}
function fmtDate(v: unknown): string {
  const d = toDate(v);
  if (!d) return "";
  try { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d); }
  catch { return isoDay(d); }
}
function money(n: number, cur = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}
function initialsOf(name: string): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}
function statusTone(s: string): string {
  if (s === "Active") return "bg-emerald-500";
  if (s === "Setup") return "bg-amber-500";
  if (s === "Inactive") return "bg-rose-500";
  return "bg-muted-foreground/40";
}
function statusRank(s: string): number {
  if (s === "Active") return 0;
  if (s === "Setup") return 1;
  if (s === "Inactive") return 2;
  return 3;
}
function nextStaffId(ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    const m = /(\d+)\s*$/.exec(String(id ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `STAFF-${String(max + 1).padStart(3, "0")}`;
}
function pageList(current: number, total: number): (number | string)[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | string)[] = [];
  const push = (v: number | string) => { if (out[out.length - 1] !== v) out.push(v); };
  push(1);
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) push("ellipsis-left");
  for (let i = from; i <= to; i++) push(i);
  if (to < total - 1) push("ellipsis-right");
  push(total);
  return out;
}

// Choice lists mirror the Airtable single-select options exactly.
const STATUSES = ["Active", "Setup", "Inactive"];
const PLATFORMS = ["X", "OnlyFans", "Fanvue", "Instagram", "Discord", "Threads", "Reddit", "VPS"];
const PAY_TYPES = ["Hourly", "Salary", "Commission"];
const CURRENCIES = ["USD", "GBP", "EUR", "AUD"];
const NONE = "__none__";
const PAGE_SIZES = [15, 25, 50, 100];

const TH = "sticky top-0 z-10 bg-muted/40 backdrop-blur h-9 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap text-left border-b";
const TD = "px-3 py-2 text-sm border-b";

type SortKey = "name" | "status" | "rate" | "stdHours" | "startDate" | "convLastWk" | "convLast4Wk";

type Form = {
  name: string; status: string; modelId: string; platform: string; payType: string;
  rate: string; stdHours: string; currency: string; startDate: string; endDate: string; email: string;
};
const emptyForm: Form = { name: "", status: "Setup", modelId: "", platform: "", payType: "Hourly", rate: "", stdHours: "", currency: "USD", startDate: "", endDate: "", email: "" };

type ModelOption = { id: string; name: string };

type StaffRow = {
  id: string; staffId: string; name: string; status: string; model: string; modelId: string; platform: string; payType: string;
  rate: number; stdHours: number | null; currency: string; startDate: string; endDate: string; email: string;
};

const expectationSelect=q.select({name:"Name",staff:"Staff",week:"Effective Week",daily:"Daily Target",weekly:"Weekly Minimum",monthly:"Monthly Target"});
const expectationFields=q.select({name:"Name",staff:"Staff",week:"Effective Week",daily:"Daily Target",weekly:"Weekly Minimum",monthly:"Monthly Target"});
function manualTarget(raw:any):number|null {
 if(raw===null||raw===undefined||String(raw).trim()==="")return null;
 const n=Number(raw);if(!Number.isSafeInteger(n)||n<0)throw new Error("Targets must be whole numbers of zero or more, or blank.");return n;
}
function expectationMonday(raw:any):string {
 const value=String(raw??"").slice(0,10),d=toDate(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!d||isoDay(d)!==value||d.getDay()!==1)throw new Error("Choose a Monday for the effective week.");
 return value;
}
function expectationAt(rows:any[],staffId:string,week:string):any {
 const applicable=rows.filter(r=>linkIds(r.staff).includes(staffId)&&r.week&&String(r.week).slice(0,10)<=week).sort((a,b)=>String(b.week).localeCompare(String(a.week)));
 if(applicable.length>1&&String(applicable[0].week).slice(0,10)===String(applicable[1].week).slice(0,10))throw new Error("Duplicate expectations for the same week. Review the history.");
 return applicable[0]??null;
}
function expectationWeeks(period:string,today:Date,start:string,end:string):string[] {
 const current=mondayOf(today);
 if(period==="this")return [isoDay(current)];
 if(period==="last")return [isoDay(addDays(current,-7))];
 if(period==="four")return [4,3,2,1].map(n=>isoDay(addDays(current,-7*n)));
 const a=toDate(start),b=toDate(end);
 if(!start||!end||!a||!b||a>b)throw new Error("Choose a valid start and end date.");
 const keys:string[]=[];for(let d=mondayOf(a);d<=mondayOf(b);d=addDays(d,7)){if(keys.length>=260)throw new Error("Choose a range of five years or less.");keys.push(isoDay(d));}return keys;
}
function expectationMonth(period:string,today:Date,chosen:string):any {
 const date=period==="custom"?toDate(chosen+"-01"):new Date(today.getFullYear(),today.getMonth()-(period==="last"?1:0),1);
 if(!date||(period==="custom"&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(chosen)||isoDay(date).slice(0,7)!==chosen)))throw new Error("Choose a valid month.");
 const start=new Date(date.getFullYear(),date.getMonth(),1),end=new Date(date.getFullYear(),date.getMonth()+1,0);
 const keys:string[]=[];for(let day=mondayOf(start);day<=end;day=addDays(day,7)){if(day>=start)keys.push(isoDay(day));}
 return {keys,cutoff:isoDay(end<today?end:today),label:start.toLocaleDateString("en-GB",{month:"long",year:"numeric"})};
}
function expectationResult(rows:any[],staffId:string,keys:string[],buckets:Map<string,Bucket>|undefined,currentWeek:string,measure="weekly",cutoff=keys[keys.length-1]):any {
 try{
  const targets=keys.map(k=>expectationAt(rows,staffId,k));
  const selected=measure==="monthly"?[manualTarget(expectationAt(rows,staffId,cutoff)?.monthly)]:targets.map(t=>manualTarget(t?.[measure==="daily"?"daily":"weekly"]));
  const reportedKeys=keys.filter(k=>buckets?.has(k)&&!buckets.get(k)?.missing),reported=reportedKeys.length;
  const open=keys.some(k=>k>=currentWeek),complete=keys.length>0&&reported===keys.length;
  const total=reportedKeys.reduce((n,k)=>n+(buckets?.get(k)?.total??0),0);
  const actual=reported&&(complete||open)?(measure==="daily"?total/(reported*7):total):null;
  const allTargets=selected.length>0&&selected.every(n=>n!==null);
  const minimum=allTargets?selected.reduce((n,x)=>n+(x??0),0)/(measure==="daily"?keys.length:1):null;
  const status=selected.every(n=>n===null)?"No target set":!allTargets?"Target incomplete":open?"In progress":!complete?"Not reported":minimum===0?"No minimum":Math.abs(actual!-minimum!)<1e-9?"At target":actual!<minimum!?"Below target":"Above target";
  return {minimum,actual,reported,status,open,percent:minimum&&actual!==null?actual/minimum*100:null,gap:minimum!==null&&actual!==null?Math.max(0,minimum-actual):null};
 }catch(e:any){return {daily:"—",minimum:null,actual:null,reported:0,percent:null,status:"Review expectations",error:e.message};}
}
function expectationPayload(form:any,staff:any[],rows:any[],id:string|null):any {
 const person=staff.find(s=>s.id===form.staff);if(!person)throw new Error("Choose an employee.");
 const week=expectationMonday(form.week);
 if(rows.some(r=>r.id!==id&&linkIds(r.staff).includes(person.id)&&String(r.week).slice(0,10)===week))throw new Error("Expectations already exist for this employee and week. Edit that entry in the history.");
 return {name:person.name+" · "+week,staff:[person.id],week,daily:manualTarget(form.daily),weekly:manualTarget(form.weekly),monthly:manualTarget(form.monthly)};
}
function Expectations({staff,buckets,sourceReady,sourceError,refreshSource}:any){
 const query=useRecords({from:ds.expectations,select:expectationSelect,count:100,orderBy:q.desc("week")});
 const createTarget=useRecordCreate({from:ds.expectations,fields:expectationFields});
 const updateTarget=useRecordUpdate({from:ds.expectations,fields:expectationFields});
 const rows=(query.data?.pages.flatMap((p:any)=>p.items)??[]).map((r:any)=>({id:r.id,...r.fields}));
 useEffect(()=>{if(query.hasNextPage&&!query.isFetching&&query.status!=="error")query.fetchNextPage();},[query.hasNextPage,query.isFetching,query.status,query.data]);
 useEffect(()=>{const timer=setInterval(()=>{query.refetch();refreshSource();},60000);return()=>clearInterval(timer);},[query.refetch,refreshSource]);
 const ready=query.status==="success"&&!query.hasNextPage&&!query.isFetching&&sourceReady;
 const [period,setPeriod]=useState("last"),[from,setFrom]=useState(""),[to,setTo]=useState(""),[search,setSearch]=useState("");
 const [measure,setMeasure]=useState("weekly"),[monthPeriod,setMonthPeriod]=useState("this"),[month,setMonth]=useState(""),[resultFilter,setResultFilter]=useState("all");
 const [form,setForm]=useState<any>(null),[editingId,setEditingId]=useState<string|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 let keys:string[]=[],rangeError="",cutoff="",monthLabel="";
 try{if(measure==="monthly"){const window=expectationMonth(monthPeriod,new Date(),month);keys=window.keys;cutoff=window.cutoff;monthLabel=window.label;}else{keys=expectationWeeks(period,new Date(),from,to);cutoff=keys[keys.length-1];}}catch(e:any){rangeError=e.message;}
 const currentWeek=isoDay(mondayOf(new Date()));
 const people=staff.filter((s:any)=>[s.name,s.model,s.platform].join(" ").toLowerCase().includes(search.toLowerCase())).map((s:any)=>({...s,result:expectationResult(rows,s.id,keys,buckets.get(s.id),currentWeek,measure,cutoff)})).filter((s:any)=>resultFilter==="all"||s.result.status===resultFilter||(resultFilter==="met"&&["At target","Above target"].includes(s.result.status)));
 const display=(value:any)=>value==null?"—":typeof value==="number"?value.toLocaleString("en-US",{maximumFractionDigits:2}):value;
 const openNew=(staffId="")=>{setEditingId(null);setForm({staff:staffId,week:"",daily:"",weekly:"",monthly:""});setError("");};
 const openExisting=(row:any)=>{setEditingId(row.id);setForm({staff:linkIds(row.staff)[0]||"",week:String(row.week??"").slice(0,10),daily:row.daily==null?"":String(row.daily),weekly:row.weekly==null?"":String(row.weekly),monthly:row.monthly==null?"":String(row.monthly)});setError("");};
 const save=async(e:any)=>{
  e.preventDefault();if(lock.current)return;setError("");
  if(!ready){setError("Wait for the data to finish loading, then retry.");return;}
  if(editingId?!updateTarget.enabled:!createTarget.enabled){setError("You do not have permission to save expectations.");return;}
  lock.current=true;setBusy(true);
  try{
   // ponytail: recheck catches ordinary duplicates; simultaneous editors still need an Airtable unique-key backend to prevent races.
   const fresh=await query.refetch();if(fresh.isError||fresh.error)throw new Error("Could not verify existing expectations. Please retry.");
   const existing=fresh.data?.pages.flatMap((p:any)=>p.items.map((r:any)=>({id:r.id,...r.fields})))??[];
   const fields=expectationPayload(form,staff,existing,editingId);
   if(editingId)await updateTarget.mutateAsync({recordId:editingId,fields});else await createTarget.mutateAsync(fields);
   setForm(null);toast.success("Expectations saved.");await query.refetch();
  }catch(e:any){setError(e.message||"Could not save. Your entries are still here.");}finally{lock.current=false;setBusy(false);}
 };
 return <Card className="overflow-hidden rounded-xl">
 <div className="flex flex-wrap items-start justify-between gap-3 p-5"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><Target size={20}/>Expectations & performance</h2><p className="mt-1 text-sm text-muted-foreground">Daily, weekly and monthly expectations. Enter your own targets; all three start blank.</p></div>{createTarget.enabled&&<Button size="sm" disabled={!ready} onClick={()=>openNew()}><Plus size={15}/>Add expectations</Button>}</div>
 <CardContent className="space-y-4">
 <div role="group" aria-label="Comparison measure" className="flex flex-wrap gap-2">{[["daily","Daily average"],["weekly","Weekly"],["monthly","Monthly"]].map(([value,title])=><Button key={value} variant={measure===value?"default":"outline"} size="sm" aria-pressed={measure===value} onClick={()=>{setMeasure(value);setResultFilter("all");}}>{title}</Button>)}</div>
 <div className="flex flex-wrap items-end gap-3">
 {measure==="monthly"?<><label className="grid gap-1 text-xs">Performance period<select aria-label="Expectations month period" className="h-9 rounded-md border bg-background px-3 text-sm" value={monthPeriod} onChange={e=>setMonthPeriod(e.target.value)}><option value="this">This month</option><option value="last">Last month</option><option value="custom">Choose month</option></select></label>{monthPeriod==="custom"&&<label className="grid gap-1 text-xs">Month<Input type="month" aria-label="Expectations month" value={month} onChange={e=>setMonth(e.target.value)}/></label>}</>:<><label className="grid gap-1 text-xs">Performance period<select aria-label="Expectations period" className="h-9 rounded-md border bg-background px-3 text-sm" value={period} onChange={e=>setPeriod(e.target.value)}><option value="last">Last complete week</option><option value="four">Last 4 complete weeks</option><option value="this">This week — in progress</option><option value="custom">Custom dates</option></select></label>{period==="custom"&&<><label className="grid gap-1 text-xs">From<Input aria-label="Expectations from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="grid gap-1 text-xs">To<Input aria-label="Expectations to" type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label></>}</>}
 <label className="grid gap-1 text-xs">Results<select aria-label="Expectation results" className="h-9 rounded-md border bg-background px-3 text-sm" value={resultFilter} onChange={e=>setResultFilter(e.target.value)}><option value="all">All employees</option><option value="Below target">Below target</option><option value="met">At or above target</option><option value="No target set">No target set</option><option value="Not reported">Not reported</option><option value="In progress">In progress</option><option value="Target incomplete">Target incomplete</option></select></label>
 <Input aria-label="Search expectations" className="max-w-xs" placeholder="Search employee or model…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <p className="text-xs text-muted-foreground">{measure==="monthly"?`${monthLabel}. Each whole week counts in the month its Monday falls in. The month is complete after its final week ends. The latest target effective in that month is used, up to today.`:keys.length?`Whole weeks: ${fmtDate(keys[0])} – ${fmtDate(isoDay(addDays(toDate(keys[keys.length-1])!,6)))}. ${measure==="daily"?"Daily average = weekly conversions ÷ 7 calendar days, averaged across reported weeks. It does not measure individual days. Targets across several weeks are averaged.":"Each week's conversions are compared with that week's expectation. For several weeks, both totals are added together."}`:"Choose the period to compare."}</p>
 <p className="text-xs text-muted-foreground">Achievement is actual ÷ expectation. To target shows the remaining gap. In-progress figures use reported weeks so far; missing entries are not zero.</p>
 {rangeError&&<p role="alert" className="text-sm text-destructive">{rangeError}</p>}
 {sourceError||query.status==="error"?<p role="alert" className="text-sm text-destructive">Could not load expectations or conversion data. Refresh to retry.</p>:!ready?<p role="status" className="text-sm text-muted-foreground">Loading expectations and conversion entries…</p>:!rangeError&&<>
 {!rows.length&&<div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No expectations entered yet. Set only the daily, weekly or monthly targets you want to use.</div>}
 <div className="max-h-[65vh] overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr>{["Employee",measure==="daily"?"Daily expectation":measure==="monthly"?"Monthly expectation":keys.length>1?"Period expectation":"Weekly expectation",measure==="daily"?"Daily avg (÷7)":"Conversions","Achievement","To target","Status",""] .map((title,i)=><th key={i} className={TH}>{title}</th>)}</tr></thead><tbody>{people.map((s:any)=>{const result=s.result;return <tr key={s.id}><td className={TD}><strong>{s.name}</strong><div className="text-xs text-muted-foreground">{s.model} · {s.status}</div></td><td className={TD}>{display(result.minimum)}</td><td className={TD}>{display(result.actual)}{result.reported<keys.length&&<div className="text-xs text-muted-foreground">{result.reported}/{keys.length} weeks reported</div>}</td><td className={TD}>{result.percent==null?"—":display(result.percent)+"%"}</td><td className={TD}>{display(result.gap)}{result.gap!=null&&measure==="daily"&&<span className="text-xs text-muted-foreground"> /day</span>}</td><td className={TD}><span title={result.error} className={"whitespace-nowrap rounded-full px-2 py-1 text-xs "+(result.status==="Below target"?"bg-amber-100 text-amber-900":result.status==="Above target"?"bg-emerald-100 text-emerald-800":result.status==="At target"?"bg-blue-100 text-blue-800":"bg-muted text-muted-foreground")}>{result.status}</span></td><td className={TD}>{createTarget.enabled&&<Button variant="ghost" size="sm" aria-label={"Set expectations for "+s.name} onClick={()=>openNew(s.id)}>Set expectations</Button>}</td></tr>;})}{!people.length&&<tr><td colSpan={7} className="p-5 text-sm text-muted-foreground">No employees match these filters.</td></tr>}</tbody></table></div></>}
 <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Expectation history ({rows.length})</summary><p className="my-2 text-xs text-muted-foreground">Add a new effective week when targets change. Edit an existing entry to correct or clear its values. Monthly expectations apply to the reporting month of the effective week and following months, until changed.</p>{!rows.length?<p className="text-sm text-muted-foreground">No entries.</p>:<div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["Employee","Effective week","Daily expectation","Weekly expectation","Monthly expectation",""] .map((title,i)=><th key={i} className={TH}>{title}</th>)}</tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td className={TD}>{staff.find((s:any)=>s.id===linkIds(r.staff)[0])?.name||"Unlinked employee"}</td><td className={TD}>{fmtDate(r.week)}</td><td className={TD}>{display(r.daily)}</td><td className={TD}>{display(r.weekly)}</td><td className={TD}>{display(r.monthly)}</td><td className={TD}>{updateTarget.enabled&&<Button size="sm" variant="ghost" disabled={!ready} aria-label={"Edit expectation "+r.name} onClick={()=>openExisting(r)}>Edit</Button>}</td></tr>)}</tbody></table></div>}</details>
 </CardContent>
 <Dialog open={!!form} onOpenChange={open=>{if(!open&&!busy)setForm(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editingId?"Edit expectations":"Set expectations"}</DialogTitle><DialogDescription>Enter daily, weekly and monthly targets independently. Leave any field blank for no expectation.</DialogDescription></DialogHeader>{form&&<form onSubmit={save} className="grid gap-4"><label className="grid gap-1 text-sm">Employee<select required aria-label="Expectation employee" className="h-10 rounded-md border bg-background px-3" value={form.staff} onChange={e=>setForm({...form,staff:e.target.value})}><option value="">Choose employee</option>{staff.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="grid gap-1 text-sm">Effective week (Monday)<Input required type="date" aria-label="Expectation effective week" value={form.week} onChange={e=>setForm({...form,week:e.target.value})}/></label><div className="grid gap-3 sm:grid-cols-3">{[["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]].map(([field,title])=><label key={field} className="grid gap-1 text-sm">{title} expectation<Input aria-label={title+" conversion expectation"} type="number" min="0" step="1" placeholder="Not set" value={form[field]} onChange={e=>setForm({...form,[field]:e.target.value})}/></label>)}</div><p className="text-xs text-muted-foreground">Daily results use weekly totals ÷ 7. Monthly results group whole weeks by Monday. No targets are calculated automatically.</p>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={()=>setForm(null)}>Cancel</Button><Button type="submit" disabled={busy||!ready}>{busy?"Saving…":"Save expectations"}</Button></DialogFooter></form>}</DialogContent></Dialog></Card>;
}

// ---------- block ----------
export default function Block() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modelFilter, setModelFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);

  // All staff (auto-paged)
  const staffQ = useRecords({ from: ds.staff, select: staffSelect, count: 100, orderBy: q.asc("name") });
  useEffect(() => {
    if (staffQ.hasNextPage && !staffQ.isFetching) staffQ.fetchNextPage();
  }, [staffQ.hasNextPage, staffQ.isFetching, staffQ.data]);

  // Models — the source of truth for the Model link
  const modelsQ = useRecords({ from: ds.models, select: modelSelect, count: 100, orderBy: q.asc("model") });
  useEffect(() => {
    if (modelsQ.hasNextPage && !modelsQ.isFetching) modelsQ.fetchNextPage();
  }, [modelsQ.hasNextPage, modelsQ.isFetching, modelsQ.data]);

  const models: ModelOption[] = useMemo(() => {
    const seen = new Set<string>();
    const out: ModelOption[] = [];
    for (const r of (modelsQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[]) {
      const name = label(r.fields.model);
      if (!name || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: String(r.id), name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [modelsQ.data]);

  const modelNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of models) m.set(o.id, o.name);
    return m;
  }, [models]);

  // Conversion Log (auto-paged) — feeds the two trailing conversion columns only.
  const convQ = useRecords({ from: ds.conversions, select: convSelect, count: 100, orderBy: q.desc("weekStarting") });
  useEffect(() => {
    if (convQ.hasNextPage && !convQ.isFetching) convQ.fetchNextPage();
  }, [convQ.hasNextPage, convQ.isFetching, convQ.data]);

  const thisWeekStart = mondayOf(new Date());
  const lastWeekKeys = [isoDay(addDays(thisWeekStart, -7))];
  const last4WeekKeys = [4, 3, 2, 1].map((i) => isoDay(addDays(thisWeekStart, -7 * i)));
  const lastWkRange = `w/c ${fmtWeek(addDays(thisWeekStart, -7))} – ${fmtWeek(addDays(thisWeekStart, -1))}`;
  const last4WkRange = `w/c ${fmtWeek(addDays(thisWeekStart, -28))} – ${fmtWeek(addDays(thisWeekStart, -1))}`;

  // Bucketed by the MONDAY of each row's week, so a row somehow dated mid-week still lands in the
  // right week instead of inventing one of its own.
  const convByStaff = useMemo(() => {
    const out = new Map<string, Map<string, Bucket>>();
    for (const r of (convQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[]) {
      const d = toDate(r.fields.weekStarting);
      if (!d) continue;
      const id = linkIds(r.fields.staff)[0];
      if (!id) continue;
      let m = out.get(id);
      if (!m) { m = new Map<string, Bucket>(); out.set(id, m); }
      bump(m, isoDay(mondayOf(d)), numOrNull(r.fields.conversions));
    }
    return out;
  }, [convQ.data]);

  const staff: StaffRow[] = useMemo(() => {
    const rows = (staffQ.data?.pages.flatMap((p: any) => p.items) ?? []) as any[];
    return rows
      .map((r) => {
        const f = r.fields;
        const ids = linkIds(f.model);
        const names = linkLabels(f.model);
        const modelId = ids[0] ?? "";
        const modelName = names[0] ?? (modelId ? (modelNameById.get(modelId) ?? "") : "");
        return {
          id: r.id,
          staffId: label(f.staffId),
          name: label(f.name),
          status: label(f.status),
          model: modelName,
          modelId,
          platform: label(f.platform),
          payType: label(f.payType),
          rate: num(f.rate),
          stdHours: numOrNull(f.stdHours),
          currency: label(f.currency) || "USD",
          startDate: isoOf(f.startDate),
          endDate: isoOf(f.endDate),
          email: label(f.email),
        };
      })
      .filter((s) => s.name !== "" || s.staffId !== "")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staffQ.data, modelNameById]);

  const counts = useMemo(() => {
    const c = { active: 0, setup: 0, inactive: 0 };
    for (const s of staff) {
      if (s.status === "Active") c.active++;
      else if (s.status === "Setup") c.setup++;
      else if (s.status === "Inactive") c.inactive++;
    }
    return c;
  }, [staff]);

  // null = no Conversion Log row anywhere in the window (renders as an em dash);
  // 0 = a row exists and it says zero (renders as 0). The two are not the same fact.
  const convCells = useMemo(() => {
    const m = new Map<string, { lastWk: number | null; last4Wk: number | null }>();
    for (const s of staff) {
      const b = convByStaff.get(s.id);
      m.set(s.id, { lastWk: sumWeeks(b, lastWeekKeys), last4Wk: sumWeeks(b, last4WeekKeys) });
    }
    return m;
  }, [staff, convByStaff]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = staff.filter((s) => {
      if (statusFilter !== "All" && s.status !== statusFilter) return false;
      if (modelFilter !== "All" && s.model !== modelFilter) return false;
      if (!term) return true;
      return s.name.toLowerCase().includes(term) || s.email.toLowerCase().includes(term) || s.model.toLowerCase().includes(term) || s.staffId.toLowerCase().includes(term);
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      if (sortKey === "convLastWk" || sortKey === "convLast4Wk") {
        const val = (s: StaffRow) => {
          const c = convCells.get(s.id);
          return (sortKey === "convLastWk" ? c?.lastWk : c?.last4Wk) ?? null;
        };
        const av = val(a), bv = val(b);
        // "No entry" sorts last in BOTH directions — it is missing data, not a low score.
        if (av === null && bv === null) return a.name.localeCompare(b.name);
        if (av === null) return 1;
        if (bv === null) return -1;
        const d = av - bv;
        return (d !== 0 ? d : a.name.localeCompare(b.name)) * dir;
      }
      if (sortKey === "rate") return (a.rate - b.rate) * dir;
      if (sortKey === "stdHours") {
        const d = (a.stdHours ?? -1) - (b.stdHours ?? -1);
        return (d !== 0 ? d : a.name.localeCompare(b.name)) * dir;
      }
      if (sortKey === "status") {
        const d = statusRank(a.status) - statusRank(b.status);
        return (d !== 0 ? d : a.name.localeCompare(b.name)) * dir;
      }
      if (sortKey === "startDate") {
        const d = (a.startDate || "").localeCompare(b.startDate || "");
        return (d !== 0 ? d : a.name.localeCompare(b.name)) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
    });
  }, [staff, search, statusFilter, modelFilter, sortKey, sortDir, convCells]);

  const warnings = useMemo(() => staff.filter((s) => s.status === "Active" && (s.rate <= 0 || s.model === "")), [staff]);

  const filtersActive = statusFilter !== "All" || modelFilter !== "All" || search.trim() !== "";
  const resetFilters = () => { setStatusFilter("All"); setModelFilter("All"); setSearch(""); };

  useEffect(() => { setPage(1); }, [search, statusFilter, modelFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(filtered.length, safePage * pageSize);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  // Mutations
  const update = useRecordUpdate({ from: ds.staff, fields: updateFields, onError: (e) => toast.error(e.message) });
  const create = useRecordCreate({ from: ds.staff, fields: createFields, onError: (e) => toast.error(e.message) });
  const canEdit = update.enabled;
  const canAdd = create.enabled;

  const openEdit = (s: StaffRow) => {
    setForm({ name: s.name, status: s.status || "Setup", modelId: s.modelId, platform: s.platform, payType: s.payType || "Hourly", rate: s.rate > 0 ? String(s.rate) : "", stdHours: s.stdHours !== null ? String(s.stdHours) : "", currency: s.currency, startDate: s.startDate, endDate: s.endDate, email: s.email });
    setEditing(s);
  };
  const openAdd = () => { setForm(emptyForm); setAdding(true); };
  const closeDialogs = () => { setEditing(null); setAdding(false); };
  const setF = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const newStaffId = useMemo(() => nextStaffId(staff.map((s) => s.staffId)), [staff]);
  const duplicateName = useMemo(() => {
    const n = form.name.trim().toLowerCase();
    if (!n) return null;
    return staff.find((s) => s.name.toLowerCase() === n && s.id !== editing?.id) ?? null;
  }, [form.name, staff, editing]);

  // Selects write the plain choice name; the Model link writes an array of Models record ids.
  const payload = () => ({
    name: form.name.trim(),
    status: form.status || null,
    model: form.modelId ? [form.modelId] : [],
    platform: form.platform || null,
    payType: form.payType || null,
    rate: form.rate.trim() === "" ? null : num(form.rate),
    // Blank clears the default outright (null, never 0) — "no standard day", not "a zero-hour day".
    stdHours: form.stdHours.trim() === "" ? null : num(form.stdHours),
    currency: form.currency || null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    email: form.email.trim() || null,
  });

  const saveEdit = async () => {
    if (!editing || !canEdit) return;
    if (!form.name.trim()) { toast.error("Full Name is required."); return; }
    setSaving(true);
    try {
      await update.mutateAsync({ recordId: editing.id, fields: payload() });
      await staffQ.refetch();
      toast.success(`Saved ${form.name.trim()}`);
      closeDialogs();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  const saveAdd = async () => {
    if (!canAdd) return;
    if (!form.name.trim()) { toast.error("Full Name is required."); return; }
    setSaving(true);
    try {
      await create.mutateAsync({ staffId: newStaffId, ...payload() });
      await staffQ.refetch();
      toast.success(`Added ${form.name.trim()} as ${newStaffId}`);
      closeDialogs();
    } catch (e: any) {
      toast.error(e?.message ?? "Add failed");
    } finally { setSaving(false); }
  };

  const loading = staffQ.status === "pending";

  const fields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label>Full Name</Label>
        <Input value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="First Last" />
        {duplicateName && (
          <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> A staff member named "{duplicateName.name}" already exists ({duplicateName.staffId || "no ID"}).</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Status</Label>
        <Select value={form.status} onValueChange={(v) => setF({ status: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Model</Label>
        <Select value={form.modelId || NONE} onValueChange={(v) => setF({ modelId: v === NONE ? "" : v })}>
          <SelectTrigger><SelectValue placeholder="— none —" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— none —</SelectItem>
            {form.modelId && !modelNameById.has(form.modelId) && (
              <SelectItem value={form.modelId}>{editing?.model || "(linked model)"}</SelectItem>
            )}
            {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Platform</Label>
        <Select value={form.platform || NONE} onValueChange={(v) => setF({ platform: v === NONE ? "" : v })}>
          <SelectTrigger><SelectValue placeholder="— blank —" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— blank —</SelectItem>
            {form.platform && !PLATFORMS.includes(form.platform) && <SelectItem value={form.platform}>{form.platform}</SelectItem>}
            {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Pay Type</Label>
        <Select value={form.payType || "Hourly"} onValueChange={(v) => setF({ payType: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {form.payType && !PAY_TYPES.includes(form.payType) && <SelectItem value={form.payType}>{form.payType}</SelectItem>}
            {PAY_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Current Hourly Rate</Label>
        <Input type="number" inputMode="decimal" min={0} step={0.01} value={form.rate} onChange={(e) => setF({ rate: e.target.value })} placeholder="0.00" className="tabular-nums" />
      </div>
      <div className="space-y-1">
        <Label>Standard Daily Hours</Label>
        <Input type="number" inputMode="decimal" min={0} max={24} step={0.25} value={form.stdHours} onChange={(e) => setF({ stdHours: e.target.value })} placeholder="—" className="tabular-nums" />
        <p className="text-xs text-muted-foreground">Their usual shift length. Pre-fills Pay &amp; Hours. Leave blank for no default — blank is not zero.</p>
      </div>
      <div className="space-y-1">
        <Label>Currency</Label>
        <Select value={form.currency || "USD"} onValueChange={(v) => setF({ currency: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {form.currency && !CURRENCIES.includes(form.currency) && <SelectItem value={form.currency}>{form.currency}</SelectItem>}
            {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Start Date</Label>
        <Input type="date" value={form.startDate} onChange={(e) => setF({ startDate: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label>End Date</Label>
        <Input type="date" value={form.endDate} onChange={(e) => setF({ endDate: e.target.value })} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>Email</Label>
        <Input type="email" value={form.email} onChange={(e) => setF({ email: e.target.value })} placeholder="name@example.com" />
      </div>
    </div>
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="w-full space-y-4">
        <Expectations staff={staff} buckets={convByStaff} sourceReady={staffQ.status==="success"&&!staffQ.hasNextPage&&!staffQ.isFetching&&convQ.status==="success"&&!convQ.hasNextPage&&!convQ.isFetching} sourceError={staffQ.status==="error"||convQ.status==="error"} refreshSource={convQ.refetch}/>
        <Card className="w-full overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Header */}
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Staff</h2>
                <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground tabular-nums">{staff.length}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading staff…" : (
                  <>
                    <span className="font-medium text-foreground tabular-nums">{counts.active}</span> active · <span className="font-medium text-foreground tabular-nums">{counts.setup}</span> in setup · <span className="font-medium text-foreground tabular-nums">{counts.inactive}</span> inactive. There is no delete — set Status to Inactive instead.
                  </>
                )}
              </p>
            </div>
            <Button size="sm" onClick={openAdd} disabled={!canAdd || loading} className="shrink-0 gap-1.5">
              <Plus className="h-4 w-4" /> Add staff
            </Button>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-5">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                <CircleDot className="h-3.5 w-3.5 opacity-60" />
                <span>Status{statusFilter !== "All" ? `: ${statusFilter}` : ""}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-dashed px-2.5 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5 opacity-60" />
                <span>Model{modelFilter !== "All" ? `: ${modelFilter}` : ""}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All models</SelectItem>
                {models.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {filtersActive && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={resetFilters}>
                <X className="h-3.5 w-3.5" /> Reset
              </Button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search staff…"
                  className="h-8 w-[200px] pl-8 text-sm lg:w-[260px]"
                />
              </div>
            </div>
          </div>

          <CardContent className="p-0">
            {warnings.length > 0 && (
              <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:mx-5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <div className="font-medium">{warnings.length} active staff need attention — pay and conversions won't calculate correctly until fixed.</div>
                  <ul className="space-y-0.5">
                    {warnings.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <button type="button" className="font-medium underline underline-offset-2" onClick={() => openEdit(s)}>{s.name || s.staffId}</button>
                        <span className="text-amber-800">
                          {[s.rate <= 0 ? "no hourly rate" : null, s.model === "" ? "no model" : null].filter(Boolean).join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {loading ? (
              <div className="border-t py-12 text-center text-sm text-muted-foreground">Loading…</div>
            ) : staffQ.status === "error" ? (
              <div className="border-t py-12 text-center text-sm text-destructive">Could not load Staff{staffQ.error?.message ? `: ${staffQ.error.message}` : "."}</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 border-t py-14 text-center">
                <Users className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{staff.length === 0 ? "No staff yet." : "No staff match your filters."}</p>
                {filtersActive && <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={resetFilters}><X className="h-3.5 w-3.5" /> Clear filters</Button>}
              </div>
            ) : (
              <div className="relative w-full overflow-auto max-h-[70vh] border-t">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Hash className="h-3 w-3 opacity-60" />Staff ID</span></th>
                      <th className={TH + " min-w-[200px]"}>
                        <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <User className="h-3 w-3 opacity-60" />Full Name{sortIcon("name")}
                        </button>
                      </th>
                      <th className={TH}>
                        <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <CircleDot className="h-3 w-3 opacity-60" />Status{sortIcon("status")}
                        </button>
                      </th>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3 opacity-60" />Model</span></th>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Layers className="h-3 w-3 opacity-60" />Platform</span></th>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Wallet className="h-3 w-3 opacity-60" />Pay Type</span></th>
                      <th className={TH + " text-right"}>
                        <button type="button" onClick={() => toggleSort("rate")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <DollarSign className="h-3 w-3 opacity-60" />Rate{sortIcon("rate")}
                        </button>
                      </th>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Coins className="h-3 w-3 opacity-60" />Currency</span></th>
                      <th className={TH + " text-right"}>
                        <button type="button" onClick={() => toggleSort("stdHours")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <Clock className="h-3 w-3 opacity-60" />Std. Hours{sortIcon("stdHours")}
                        </button>
                      </th>
                      <th className={TH}>
                        <button type="button" onClick={() => toggleSort("startDate")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <Calendar className="h-3 w-3 opacity-60" />Start Date{sortIcon("startDate")}
                        </button>
                      </th>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Calendar className="h-3 w-3 opacity-60" />End Date</span></th>
                      <th className={TH}><span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 opacity-60" />Email</span></th>
                      {/* Deliberately NOT labelled "7 days" / "30 days": entry is weekly, so these are
                          whole-week windows. Calling a week's total a rolling 7-day count is the same
                          class of lie the Home page just had removed. */}
                      <th className={TH + " text-right"} title={`Conversions for the last complete week (${lastWkRange}). Conversions are logged once per week, dated to that week's Monday, so this is a whole week — not a rolling 7 days. A dash means no entry for that week, which is not the same as zero conversions.`}>
                        <button type="button" onClick={() => toggleSort("convLastWk")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <Target className="h-3 w-3 opacity-60" />Conv · last wk{sortIcon("convLastWk")}
                        </button>
                      </th>
                      <th className={TH + " text-right"} title={`Conversions for the last 4 complete weeks (${last4WkRange}). Whole weeks — not a rolling 30 days. A dash means no entry anywhere in that window, which is not the same as zero conversions.`}>
                        <button type="button" onClick={() => toggleSort("convLast4Wk")} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <Target className="h-3 w-3 opacity-60" />Conv · last 4 wks{sortIcon("convLast4Wk")}
                        </button>
                      </th>
                      <th className={TH + " text-right"}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((s) => (
                      <tr key={s.id} className="h-12 transition-colors hover:bg-muted/40">
                        <td className={TD + " font-mono text-xs text-muted-foreground whitespace-nowrap"}>{s.staffId || <span className="text-muted-foreground">—</span>}</td>
                        <td className={TD}>
                          <div className="flex items-center gap-2.5">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initialsOf(s.name)}</span>
                            <span className="font-medium whitespace-nowrap">{s.name || <span className="font-normal text-muted-foreground">(no name)</span>}</span>
                          </div>
                        </td>
                        <td className={TD + " whitespace-nowrap"}>
                          {s.status ? (
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              <span className={"h-1.5 w-1.5 rounded-full " + statusTone(s.status)} />
                              {s.status}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={TD}>{s.model ? <Badge variant="secondary" className="rounded-md font-normal">{s.model}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className={TD}>{s.platform ? <Badge variant="secondary" className="rounded-md font-normal">{s.platform}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className={TD + " whitespace-nowrap"}>{s.payType || <span className="text-muted-foreground">—</span>}</td>
                        <td className={TD + " text-right tabular-nums whitespace-nowrap"}>
                          {s.rate > 0 ? money(s.rate, s.currency) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={TD + " whitespace-nowrap text-muted-foreground"}>{s.currency}</td>
                        <td className={TD + " text-right tabular-nums whitespace-nowrap"}>
                          {s.stdHours !== null ? s.stdHours.toFixed(2) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={TD + " whitespace-nowrap tabular-nums"}>{s.startDate ? fmtDate(s.startDate) : <span className="text-muted-foreground">—</span>}</td>
                        <td className={TD + " whitespace-nowrap tabular-nums"}>{s.endDate ? fmtDate(s.endDate) : <span className="text-muted-foreground">—</span>}</td>
                        <td className={TD + " whitespace-nowrap"}>
                          {s.email ? <a href={`mailto:${s.email}`} className="text-primary underline-offset-2 hover:underline">{s.email}</a> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={TD + " text-right tabular-nums whitespace-nowrap"}>
                          {(convCells.get(s.id)?.lastWk ?? null) === null ? <span className="text-muted-foreground">—</span> : convCells.get(s.id)?.lastWk}
                        </td>
                        <td className={TD + " text-right tabular-nums whitespace-nowrap"}>
                          {(convCells.get(s.id)?.last4Wk ?? null) === null ? <span className="text-muted-foreground">—</span> : convCells.get(s.id)?.last4Wk}
                        </td>
                        <td className={TD + " text-right"}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => openEdit(s)} disabled={!canEdit}>
                              <Pencil className="h-3.5 w-3.5" />Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Notes line */}
            <div className="flex flex-wrap items-center gap-x-2 border-t px-3 py-2 text-sm text-muted-foreground">
              <span>Pay &amp; Hours and Conversions use Full Name as the key.</span>
              {!canEdit && !loading && <span>Editing is disabled for your account — check the block's Actions permissions in Studio.</span>}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-3 border-t px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground tabular-nums">
                {startIdx}–{endIdx} of {filtered.length} rows
              </div>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={safePage <= 1} aria-label="First page"><ChevronsLeft className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                {pageList(safePage, totalPages).map((p) =>
                  typeof p === "number" ? (
                    <Button key={p} variant={p === safePage ? "default" : "ghost"} className="h-8 w-8 p-0 text-xs" onClick={() => setPage(p)}>{p}</Button>
                  ) : (
                    <span key={p} className="px-1 text-xs text-muted-foreground">…</span>
                  )
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages} aria-label="Last page"><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) closeDialogs(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit {editing?.name || "staff"}</DialogTitle>
              <DialogDescription>Staff ID <span className="font-mono">{editing?.staffId || "—"}</span> cannot be changed. To remove someone, set Status to Inactive.</DialogDescription>
            </DialogHeader>
            {fields}
            {editing && form.name.trim() !== editing.name && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Renaming a staff member does not update their existing pay/conversion rows.</span>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={closeDialogs} disabled={saving}>Cancel</Button>
              <Button onClick={saveEdit} disabled={saving || !canEdit}>{saving ? "Saving…" : "Save changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add dialog */}
        <Dialog open={adding} onOpenChange={(o) => { if (!o) closeDialogs(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add staff</DialogTitle>
              <DialogDescription>New members start in Setup. Switch them to Active once their rate and model are set.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label>Staff ID</Label>
              <Input value={newStaffId} readOnly className="font-mono bg-muted" />
            </div>
            {fields}
            <DialogFooter>
              <Button variant="ghost" onClick={closeDialogs} disabled={saving}>Cancel</Button>
              <Button onClick={saveAdd} disabled={saving || !canAdd}>{saving ? "Adding…" : "Add staff"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

