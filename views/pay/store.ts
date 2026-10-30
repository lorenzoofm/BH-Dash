"use client";
import {useMemo, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {linkIds} from "@/lib/bh";
import {usePayData} from "@/lib/pay-data";
import {DEFAULT_OFF, type Adjustment, type PayData, type Period, type PeriodStatus, type VA, type VAPeriod, vaKey, vaOf} from "@/lib/pay";
import {toast} from "@/components/bh/toast";

type Row = {id: string; fields: Record<string, any>};
type Ov = Record<string, {v: any; t: number}>; // "h|staff|day" -> hours, "v|period|staff" -> VAPeriod patch, "s|period" -> status

// Pay data plus an optimistic overlay, and every pay-run write. Writes run one at a time, in order,
// each reading the freshest cached rows, so create-then-update on one VA/day never races.
export function usePayRun() {
  const base = usePayData();
  const {paylog, periods, vaRows, adj} = base;
  const qc = useQueryClient();
  const [ov, setOv] = useState<Ov>({});
  const [pending, setPending] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const tok = useRef(0), queue = useRef<Promise<unknown>>(Promise.resolve()), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const data = useMemo<PayData>(() => {
    const keys = Object.keys(ov);
    if (!keys.length) return base.data;
    const hours = new Map(base.data.hours), va = new Map(base.data.va), status = new Map(base.data.status);
    for (const k of keys) {
      const [kind, a, b] = k.split("|"), v = ov[k].v;
      if (kind === "h") { const m = new Map(hours.get(a) ?? []); if (v == null) m.delete(b); else m.set(b, v); hours.set(a, m); }
      if (kind === "v") va.set(vaKey(a, b), {...(va.get(vaKey(a, b)) ?? {checked: false, sent: false, held: null, excused: [], snap: null}), ...v});
      if (kind === "s") status.set(a, v);
    }
    return {...base.data, hours, va, status};
  }, [base.data, ov]);
  const live = useRef(data); live.current = data;

  const put = (k: string, v: any, merge = false) => { const t = ++tok.current; setOv(o => ({...o, [k]: {v: merge ? {...o[k]?.v, ...v} : v, t}})); return t; };
  const settle = (k: string, t: number) => setOv(o => { if (o[k]?.t !== t) return o; const {[k]: _, ...rest} = o; return rest; });
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    setPending(n => n + 1);
    const p = queue.current.then(fn);
    queue.current = p.catch(() => {});
    p.then(() => setPending(n => n - 1), () => setPending(n => n - 1));
    return p;
  }
  // Optimistic: overlay now, write in order, drop the overlay once the refetched rows are in (or roll back on error).
  const save = (k: string, t: number, fn: () => Promise<unknown>, ok: string | null) =>
    enqueue(fn).then(() => { settle(k, t); if (ok) toast(ok); }, (e: Error) => { settle(k, t); toast.error(e.message); });

  const fresh = (name: string): Row[] => (qc.getQueriesData<any>({queryKey: ["records", name]})[0]?.[1]?.pages ?? []).flatMap((p: any) => p.items);
  const vaRow = (pk: string, sid: string) => fresh("payStaff").find(r => String(r.fields.period) === pk && linkIds(r.fields.staff).includes(sid));
  const upsertVa = (pk: string, sid: string, fields: Record<string, any>) => {
    const r = vaRow(pk, sid);
    return r ? vaRows.update(r.id, fields) : vaRows.create({period: pk, staff: [sid], checked: false, sent: false, excused: "[]", ...fields});
  };
  const upsertStatus = (pk: string, fields: Record<string, any>) => {
    const r = fresh("payPeriods").find(r => String(r.fields.period) === pk);
    return r ? periods.update(r.id, fields) : periods.create({period: pk, ...fields});
  };
  const toFields = (p: Partial<VAPeriod>) => {
    const f: Record<string, any> = {};
    if ("checked" in p) f.checked = p.checked;
    if ("sent" in p) f.sent = p.sent;
    if ("held" in p) f.held = p.held;
    if ("excused" in p) f.excused = JSON.stringify(p.excused ?? []);
    return f;
  };

  function patchVa(p: Period, v: VA, patch: Partial<VAPeriod>, ok: string | null) {
    const k = "v|" + p.key + "|" + v.id, t = put(k, patch, true);
    return save(k, t, () => upsertVa(p.key, v.id, toFields(patch)), ok);
  }
  // Any edit to a VA's hours, held decision, excuse or adjustment unticks them.
  function edit(p: Period, v: VA, patch: Partial<VAPeriod>, ok: string | null) {
    const was = vaOf(live.current, p, v.id).checked;
    if (was) { patch = {...patch, checked: false}; toast(v.name + " unticked · hours changed"); ok = null; }
    if (Object.keys(patch).length) return patchVa(p, v, patch, ok);
    if (ok) toast(ok);
  }

  // One Pay Log row per VA per day: update the first, delete extras, create if none; null deletes.
  async function writeHours(v: VA, day: string, h: number | null) {
    const rows = fresh("paylog").filter(r => String(r.fields.workDate ?? "").slice(0, 10) === day && linkIds(r.fields.staff).includes(v.id));
    if (h == null) { for (const r of rows) await paylog.remove(r.id); return; }
    const [first, ...rest] = rows;
    if (!first) await paylog.create({workDate: day, staff: [v.id], hours: h, rate: v.rate, status: "Unpaid"});
    else if (first.fields.hours !== h) await paylog.update(first.id, {hours: h});
    for (const r of rest) await paylog.remove(r.id); // ponytail: assumes a row links one VA; split shared rows first if that ever happens
  }
  function setHours(p: Period, v: VA, day: string, h: number | null, ok: string | null, debounce = false) {
    if (h != null) h = Math.max(0, Math.min(24, h));
    const k = "h|" + v.id + "|" + day, t = put(k, h);
    const was = vaOf(live.current, p, v.id).checked;
    if (was) { toast(v.name + " unticked · hours changed"); ok = null; patchVa(p, v, {checked: false}, null); }
    clearTimeout(timers.current.get(k));
    const go = () => { timers.current.delete(k); save(k, t, () => writeHours(v, day, h), ok); };
    if (debounce) timers.current.set(k, setTimeout(go, 500)); else go();
  }

  // Runs a batch of writes in order with "label · i of n" progress; stops at the first error.
  async function batch(label: string, steps: (() => Promise<unknown>)[]) {
    try {
      for (let i = 0; i < steps.length; i++) { setProgress(`${label} · ${i + 1} of ${steps.length}`); await enqueue(steps[i]); }
      return true;
    } catch (e: any) { toast.error(e.message); return false; } finally { setProgress(null); }
  }

  const approve = (p: Period, vas: VA[]) => batch("Approving", [
    ...vas.map(v => () => upsertVa(p.key, v.id, {rateSnapshot: v.rate, stdSnapshot: v.std, offSnapshot: JSON.stringify(v.off ?? DEFAULT_OFF)})),
    () => upsertStatus(p.key, {status: "approved", approvedAt: new Date().toISOString()}),
  ]);
  async function reopen(p: Period, vas: VA[]) {
    const t = put("s|" + p.key, "open");
    const ok = await batch("Reopening", [
      ...vas.map(v => async () => { const r = vaRow(p.key, v.id); if (r) await vaRows.update(r.id, {rateSnapshot: null, stdSnapshot: null, offSnapshot: null}); }),
      () => upsertStatus(p.key, {status: "open"}),
    ]);
    settle("s|" + p.key, t);
    return ok;
  }
  async function setSent(p: Period, vas: VA[], ids: string[], sent: boolean) {
    const status: PeriodStatus = vas.every(v => ids.includes(v.id) ? sent : vaOf(live.current, p, v.id).sent) ? "paid" : "approved";
    const ts = ids.map(id => { const k = "v|" + p.key + "|" + id; return [k, put(k, {sent}, true)] as const; });
    const st = put("s|" + p.key, status);
    const ok = await batch(sent ? "Marking sent" : "Updating", [
      ...ids.map(id => async () => { await upsertVa(p.key, id, {sent}); }),
      async () => { if ((base.data.status.get(p.key) ?? "open") !== status) await upsertStatus(p.key, {status}); },
    ]);
    ts.forEach(([k, t]) => settle(k, t)); settle("s|" + p.key, st);
    return ok;
  }
  async function addAdjustment(target: Period, v: VA, a: Adjustment, ok: string) {
    const done = await batch("Adding", [() => adj.create({period: target.key, staff: [v.id], type: a.type, value: a.value, hours: a.hours, note: a.note || null, forPeriod: a.forPeriod ?? null})]);
    if (done) edit(target, v, {}, ok);
    return done;
  }
  async function removeAdjustment(p: Period, v: VA, id: string, ok: string) {
    if (await batch("Removing", [() => adj.remove(id)])) edit(p, v, {}, ok);
  }

  return {...base, data, pending, progress, busy: pending > 0 || !!progress, setHours, patchVa, edit, approve, reopen, setSent, addAdjustment, removeAdjustment};
}

const WDL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const hf = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US");
export const dowOf = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
export const dayLabel = (d: string) => WDL[dowOf(d)] + " " + new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"});
// Prototype colours mapped to theme tokens so the Ink theme works; hex only where no token exists.
export const C = {
  ink: "var(--surface-inverse)", onInk: "var(--text-inverse)", head: "var(--text-heading)", body: "var(--text-body)", muted: "var(--text-faint)",
  card: "var(--surface-card)", page: "var(--surface-page)", sand: "var(--surface-sunken)", line: "var(--border-subtle)", hair: "var(--border-faint)",
  signal: "var(--signal)", signalFg: "var(--text-signal)", signalTint: "var(--signal-tint)", second: "color-mix(in srgb, var(--text-body) 82%, var(--surface-card))",
  warnBg: "var(--warning-soft)", warnFg: "var(--warning-fg)", warnLine: "#dcbf8f",
  badBg: "var(--negative-soft)", badFg: "var(--negative-fg)", badLine: "#e5a59e",
  okBg: "var(--positive-soft)", okFg: "var(--positive-fg)",
};
