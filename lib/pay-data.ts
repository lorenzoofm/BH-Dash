"use client";
import {useMemo} from "react";
import {label, linkIds, num} from "./bh";
import {useTable} from "./tables";
import {parseDays, parseOff, type PayData, type VA, vaKey} from "./pay";

// Loads the Pay Log and pay-run tables into the shape lib/pay.ts works on.
export function usePayData(enabled = true) {
  const staff = useTable("staff", enabled), paylog = useTable("paylog", enabled), periods = useTable("payPeriods", enabled);
  const vaRows = useTable("payStaff", enabled), adj = useTable("payAdjustments", enabled);
  const tables = [staff, paylog, periods, vaRows, adj];
  const data = useMemo<PayData>(() => {
    const hours: PayData["hours"] = new Map();
    for (const r of paylog.rows) {
      const day = String(r.fields.workDate ?? "").slice(0, 10);
      if (!day) continue;
      for (const sid of linkIds(r.fields.staff)) {
        const m = hours.get(sid) ?? new Map<string, number | null>(); hours.set(sid, m);
        const h = r.fields.hours == null ? null : num(r.fields.hours), prev = m.get(day);
        m.set(day, prev == null ? h : h == null ? prev : prev + h);
      }
    }
    const status: PayData["status"] = new Map(periods.rows.map(r => [String(r.fields.period), (label(r.fields.status) || "open") as any]));
    const va: PayData["va"] = new Map();
    for (const r of vaRows.rows) for (const sid of linkIds(r.fields.staff)) {
      const f = r.fields, snapped = f.rateSnapshot != null || f.stdSnapshot != null;
      va.set(vaKey(String(f.period), sid), {id: r.id, checked: !!f.checked, sent: !!f.sent, held: (label(f.held) || null) as any, excused: parseDays(f.excused),
        snap: snapped ? {rate: f.rateSnapshot == null ? null : num(f.rateSnapshot), std: f.stdSnapshot == null ? null : num(f.stdSnapshot), off: parseOff(f.offSnapshot) ?? []} : null});
    }
    const adjustments: PayData["adjustments"] = new Map();
    for (const r of adj.rows) for (const sid of linkIds(r.fields.staff)) {
      const k = vaKey(String(r.fields.period), sid), list = adjustments.get(k) ?? []; adjustments.set(k, list);
      list.push({id: r.id, type: label(r.fields.type) as any, value: r.fields.value == null ? null : num(r.fields.value), hours: r.fields.hours == null ? null : num(r.fields.hours), note: r.fields.note ?? "", forPeriod: r.fields.forPeriod ?? null});
    }
    return {hours, status, va, adjustments};
  }, [paylog.rows, periods.rows, vaRows.rows, adj.rows]);
  const vas = useMemo<VA[]>(() => staff.rows.map(r => ({id: r.id, name: label(r.fields.name), rate: r.fields.rate == null ? null : num(r.fields.rate), std: r.fields.hours == null ? null : num(r.fields.hours), off: parseOff(r.fields.daysOff)})), [staff.rows]);
  return {data, vas, staff, paylog, periods, vaRows, adj, tables, loading: tables.some(t => t.loading), error: tables.find(t => t.error)?.error ?? null};
}
