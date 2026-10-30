"use client";
import {useState} from "react";
import {createPortal} from "react-dom";
import {useRouter} from "next/navigation";
import {Check, Download, X} from "lucide-react";
import {money} from "@/lib/bh";
import {type Adjustment, type Period, type PayCalc, type PeriodStatus, type VA, periodOf} from "@/lib/pay";
import {C, dayLabel, hf, type usePayRun} from "./store";

const m = (v: number) => money(v, 2);
const TYPES = ["Bonus", "Deduction", "Extra hours", "Correction"] as const;
type Run = ReturnType<typeof usePayRun>;

// Payslip drawer: flags with fixes, pay lines, total, comparison, adjustment form, print.
export function Slip({run, p, v, c, model, status, isCk, target, prev, onClose}: {
  run: Run; p: Period; v: VA; c: PayCalc; model: string; status: PeriodStatus; isCk: boolean; target: Period | null; prev: {label: string; total: number} | null; onClose: () => void;
}) {
  const router = useRouter();
  const locked = status !== "open";
  const [form, setForm] = useState<{type: typeof TYPES[number]; amount: string; note: string}>({type: "Bonus", amount: "", note: ""});
  const rate = c.rate, rateTxt = rate ? m(rate) + "/h" : "pay not set", days = 7 - c.off.length;

  const lines: {label: string; detail: string; amount: string; neg: boolean; onRemove?: () => void}[] = [
    {label: "Payable hours", detail: `${hf(c.payable)}h × ${m(rate)} · capped at ${c.std}h per scheduled day`, amount: m(c.base), neg: false}];
  if (c.held > 0 && c.dec === "pay") lines.push({label: "Extra hours (held overage)", detail: `${hf(c.held)}h × ${m(rate)}`, amount: m(c.extra), neg: false});
  for (const a of c.adjs) {
    const amt = a.type === "Extra hours" ? (a.hours ?? 0) * rate : a.value ?? 0;
    lines.push({label: a.type + (a.forPeriod ? " · for " + periodOf(a.forPeriod).label : ""),
      detail: (a.type === "Extra hours" ? `${a.hours}h × ${m(rate)}` + (a.note ? " · " : "") : "") + (a.note || ""),
      amount: (amt >= 0 ? "+" : "") + m(amt), neg: amt < 0,
      onRemove: locked || !a.id ? undefined : () => run.removeAdjustment(p, v, a.id!, a.type + " removed")});
  }

  type Act = {label: string; on?: boolean; onClick: () => void};
  const flags: {title: string; sub: string; bg: string; fg: string; actions: Act[]}[] = [];
  if (c.noRate) flags.push({title: "Pay not set", sub: v.name + " has no hourly rate yet", bg: C.badBg, fg: C.badFg, actions: [{label: "Set on Staff page", onClick: () => { onClose(); router.push("/staff"); }}]});
  if (c.held > 0) flags.push({title: hf(c.held) + "h over standard", sub: c.dec === "pay" ? "Paying as extra hours · +" + m(c.held * rate) : c.dec === "no" ? "Not paid" : "Held · worth " + m(c.held * rate),
    bg: c.dec ? C.sand : C.signalTint, fg: c.dec ? C.second : C.signalFg,
    actions: locked ? [] : [
      {label: "Pay as extra", on: c.dec === "pay", onClick: () => run.edit(p, v, {held: "pay"}, `${v.name} · ${hf(c.held)}h paid as extra`)},
      {label: "Don't pay", on: c.dec === "no", onClick: () => run.edit(p, v, {held: "no"}, `${v.name} · ${hf(c.held)}h not paid`)}]});
  const excused = run.data.va.get(p.key + "|" + v.id)?.excused ?? [];
  for (const f of c.flags) flags.push({title: (f.kind === "missed" ? "Missed" : "Short") + " · " + dayLabel(f.d), sub: f.excused ? `Excused · paid ${f.h}h` : `${f.h} of ${f.std}h logged`,
    bg: f.excused ? C.sand : f.kind === "missed" ? C.badBg : C.warnBg, fg: f.excused ? C.second : f.kind === "missed" ? C.badFg : C.warnFg,
    actions: locked ? [] : [
      {label: `Log ${f.std}h`, onClick: () => run.setHours(p, v, f.d, f.std, `${v.name} · ${dayLabel(f.d)} · ${f.std}h saved`)},
      {label: f.excused ? "Unexcuse" : "Excuse", onClick: () => run.edit(p, v, {excused: f.excused ? excused.filter(d => d !== f.d) : [...excused, f.d]}, `${dayLabel(f.d)} ${f.excused ? "unexcused" : "excused"} for ${v.name}`)}]});

  const isHours = form.type === "Extra hours", amt = Number(form.amount) || 0, signed = form.type === "Deduction" ? -amt : amt;
  const elsewhere = !!target && target.key !== p.key, cannotAdd = !amt || !target || run.busy;
  const preview = amt ? (isHours ? `${amt}h × ${m(rate)} = +${m(amt * rate)}` : (signed < 0 ? "" : "+") + m(signed)) + (elsewhere ? " → " + target!.label : "") : " ";
  function add() {
    if (cannotAdd) return;
    // Locked period: the change lands in the next open period as a Correction for this one.
    const a: Adjustment = elsewhere
      ? {type: "Correction", value: isHours ? amt * rate : signed, hours: null, note: form.type === "Correction" ? form.note : form.type + (form.note ? " · " + form.note : ""), forPeriod: p.key}
      : {type: form.type, value: isHours ? null : signed, hours: isHours ? amt : null, note: form.note};
    run.addAdjustment(target!, v, a, `${form.type} added for ${v.name}${elsewhere ? " in " + target!.label : ""}`).then(ok => { if (ok) setForm(f => ({...f, amount: "", note: ""})); });
  }
  const tickHint = locked ? "Locked · " + status : c.open > 0 ? c.open + " to fix before checking" : isCk ? "Editing anything unticks this VA" : "Hours and adjustments look right?";
  const pill = "h-[30px] whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold";
  const iconBtn = "grid size-9 place-items-center rounded-full text-[var(--text-heading)] hover:bg-[var(--wash)]";
  const fieldCls = "h-10 w-full rounded-[10px] border border-[var(--border-faint)] bg-[var(--surface-card)] px-3 text-[13px] text-[var(--text-heading)] outline-none focus:border-[var(--text-heading)]";

  return <div className="fixed inset-0 z-50 print:hidden">
    <div className="absolute inset-0 bg-[var(--veil)]" onClick={onClose}/>
    <div role="dialog" aria-modal="true" aria-label={"Payslip " + v.name} className="absolute bottom-2 right-2 top-2 flex w-[calc(100%-16px)] max-w-[460px] flex-col overflow-hidden rounded-[20px] bg-[var(--surface-card)] shadow-[var(--shadow-overlay)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-faint)] px-8 py-6">
        <div>
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[.14em] text-[var(--text-faint)]">Payslip · {p.label}</div>
          <h2 className="text-[22px] font-bold tracking-[-0.03em] text-[var(--text-heading)]">{v.name}</h2>
          <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{model} · {rateTxt} · {c.std}h × {days} days a week</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => window.print()} title="Download payslip" aria-label="Download payslip" className={iconBtn}><Download className="size-4"/></button>
          <button type="button" onClick={onClose} aria-label="Close" className={iconBtn}><X className="size-4"/></button>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-8 py-6">
        {flags.length > 0 && <div>
          <div className="mb-2 text-[13px] font-semibold text-[var(--text-heading)]">Needs a fix before pay</div>
          <div className="flex flex-col gap-1.5">
            {flags.map(fl => <div key={fl.title} className="flex items-center justify-between gap-2.5 rounded-[14px] px-3 py-2.5" style={{background: fl.bg}}>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold" style={{color: fl.fg}}>{fl.title}</div>
                <div className="text-[12px] opacity-85" style={{color: fl.fg}}>{fl.sub}</div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {fl.actions.map(a => <button key={a.label} type="button" disabled={run.busy && a.label !== "Set on Staff page"} onClick={a.onClick} className={pill + " disabled:opacity-45"}
                  style={{background: a.on ? C.ink : C.card, color: a.on ? C.onInk : C.head, borderColor: a.on ? C.ink : C.line}}>{a.label}</button>)}
              </div>
            </div>)}
          </div>
        </div>}

        <div>
          <div className="mb-1 text-[13px] font-semibold text-[var(--text-heading)]">Pay</div>
          {lines.map((ln, i) => <div key={i} className="flex items-start justify-between gap-3 border-b border-[var(--border-faint)] py-2.5">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[var(--text-body)]">{ln.label}</div>
              <div className="text-pretty text-[12px] text-[var(--text-faint)]">{ln.detail}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="num text-[13px] font-semibold" style={{color: ln.neg ? C.badFg : C.head}}>{ln.amount}</span>
              {ln.onRemove && <button type="button" onClick={ln.onRemove} disabled={run.busy} aria-label="Remove" className="grid size-6 place-items-center rounded-full text-[var(--text-faint)] hover:bg-[var(--wash)] hover:text-[var(--text-heading)]"><X className="size-3"/></button>}
            </div>
          </div>)}
          <div className="flex items-baseline justify-between pt-3.5">
            <span className="text-[13px] font-semibold text-[var(--text-heading)]">Total</span>
            <span className="num text-[28px] font-bold tracking-[-0.04em] text-[var(--text-heading)]">{m(c.total)}</span>
          </div>
          <div className="num text-right text-[12px] text-[var(--text-faint)]">{prev ? `${prev.label}: ${m(prev.total)}` : locked ? "Paid " + p.payLabel : `Projected ${m(c.projected)} by ${p.endLabel}`}</div>
        </div>

        <div className="flex flex-col gap-3 rounded-[14px] bg-[var(--surface-sunken)] p-4">
          <div className="text-[13px] font-semibold text-[var(--text-heading)]">Add adjustment</div>
          {locked && target && <div className="text-pretty text-[12px] text-[var(--text-faint)]">{p.label} is {status}. This lands in {target.label} as a correction for {p.label}.</div>}
          <div className="inline-flex flex-wrap gap-0.5 self-start rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-page)] p-1">
            {TYPES.map(t => <button key={t} type="button" onClick={() => setForm(f => ({...f, type: t}))} aria-pressed={form.type === t}
              className="h-7 rounded-full px-3 text-[12px] font-semibold" style={{background: form.type === t ? C.ink : "transparent", color: form.type === t ? C.onInk : C.muted}}>{t}</button>)}
          </div>
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
            <label className="grid gap-1"><span className="text-[12px] font-medium text-[var(--text-faint)]">{isHours ? "Hours" : "Amount (USD)"}</span>
              <input type="number" min={0} step={0.25} value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))} className={fieldCls + " num"}/></label>
            <label className="grid gap-1"><span className="text-[12px] font-medium text-[var(--text-faint)]">Note</span>
              <input type="text" value={form.note} onChange={e => setForm(f => ({...f, note: e.target.value}))} onKeyDown={e => e.key === "Enter" && add()} placeholder="Shown on the payslip" className={fieldCls}/></label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="num whitespace-pre text-[12px] text-[var(--text-faint)]">{preview}</span>
            <button type="button" onClick={add} disabled={cannotAdd} className="h-8 rounded-full bg-[var(--surface-inverse)] px-3.5 text-[12.5px] font-semibold text-[var(--text-inverse)] disabled:opacity-45">Add</button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-faint)] px-8 py-[18px]">
        <span className="text-[12px] text-[var(--text-faint)]">{run.progress ?? tickHint}</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-full px-5 text-[13px] font-semibold text-[var(--text-heading)] hover:bg-[var(--wash)]">Close</button>
          {!locked && <button type="button" disabled={c.open > 0} onClick={() => run.patchVa(p, v, {checked: !isCk}, isCk ? v.name + " unticked" : v.name + " checked for pay")}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border px-5 text-[13px] font-semibold disabled:opacity-45"
            style={{background: isCk ? C.ink : C.card, color: isCk ? C.onInk : C.head, borderColor: isCk ? C.ink : C.line}}><Check className="size-4"/>{isCk ? "Checked for pay" : "Mark checked"}</button>}
        </div>
      </div>
    </div>
    <PrintSlip p={p} v={v} model={model} rate={rate} lines={lines} total={m(c.total)} status={status}/>
  </div>;
}

// Print-only payslip: everything else on the page is hidden while printing.
function PrintSlip({p, v, model, rate, lines, total, status}: {p: Period; v: VA; model: string; rate: number; lines: {label: string; detail: string; amount: string}[]; total: string; status: string}) {
  if (typeof document === "undefined") return null;
  return createPortal(<div id="bh-payslip-print" className="hidden" style={{fontFamily: "Archivo, Helvetica, sans-serif", color: "#1c1b19", maxWidth: 560, margin: "48px auto", padding: "0 24px"}}>
    <style>{"@media print{body>*:not(#bh-payslip-print){display:none!important}#bh-payslip-print{display:block!important}}"}</style>
    <div style={{fontFamily: "monospace", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "#69655e"}}>20MG · BH Operations · Payslip</div>
    <h1 style={{fontSize: 28, letterSpacing: "-.03em", margin: "4px 0", fontWeight: 700}}>{v.name}</h1>
    <div style={{fontSize: 12, color: "#69655e"}}>{model} · {money(rate, 2)}/h · {p.label} · paid {p.payLabel}</div>
    <table style={{width: "100%", borderCollapse: "collapse", marginTop: 24, fontSize: 14}}><tbody>
      {lines.map((l, i) => <tr key={i}><td style={{padding: "10px 0", borderBottom: "1px solid #e7e3dc", verticalAlign: "top"}}>{l.label}<div style={{fontSize: 12, color: "#69655e"}}>{l.detail}</div></td>
        <td style={{padding: "10px 0", borderBottom: "1px solid #e7e3dc", verticalAlign: "top", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600}}>{l.amount}</td></tr>)}
      <tr><td style={{paddingTop: 16, fontSize: 22, fontWeight: 700}}>Total</td><td style={{paddingTop: 16, fontSize: 22, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums"}}>{total}</td></tr>
    </tbody></table>
    <p style={{fontSize: 12, color: "#69655e", marginTop: 32}}>Status: {status}. Generated by 20MG BH Operations.</p>
  </div>, document.body);
}
