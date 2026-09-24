"use client";
import {useEffect} from "react";

// Shared helpers for the redesigned Overview, Conversions entry and P&L blocks.

export const CREATORSTAQ_RANGED = "https://api.creatorstaq.com/v1/computed/revenue/ranged";

export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function label(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as {label?: string; name?: string};
    return String(o.label ?? o.name ?? "").trim();
  }
  return String(v).trim();
}

export function linkIds(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.map((x: any) => String(x?.id ?? x)).filter(Boolean);
}

export function linkLabels(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.map(label).filter(Boolean);
}

// Dates are handled as UTC YYYY-MM-DD strings so server and client render the same text.
export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function todayIso() {
  return isoDay(new Date());
}
export function addDays(day: string, count: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return isoDay(d);
}
export function mondayOf(day: string) {
  const d = new Date(day.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return isoDay(d);
}
export function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(day + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && isoDay(d) === day;
}
export function shortDate(day: string) {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"});
}
export function weekLabel(monday: string) {
  return `${shortDate(monday)} – ${shortDate(addDays(monday, 6))}`;
}

export function money(value: number | null, digits = 0) {
  if (value === null) return "—";
  return value.toLocaleString("en-US", {style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits});
}

export function rowsOf(result: any): {id: string; fields: Record<string, any>}[] {
  return result.data?.pages.flatMap((p: any) => p.items) ?? [];
}

// Fetch every page of a useRecords result.
export function useAllPages(result: any) {
  useEffect(() => {
    if (result.hasNextPage && !result.isFetching && result.status !== "error") result.fetchNextPage();
  }, [result.hasNextPage, result.isFetching, result.status, result.fetchNextPage]);
}

export function isLoading(result: any) {
  return result.status === "pending" || result.hasNextPage;
}

// Creator Staq's ranged endpoint accepts at most 32 days, end exclusive.
export function revenueRanges(start: string, end: string) {
  const out: {start: string; end: string}[] = [];
  if (!validDay(start) || !validDay(end) || start > end) return out;
  const stop = addDays(end, 1);
  for (let day = start; day < stop; ) {
    const next = addDays(day, 31) < stop ? addDays(day, 31) : stop;
    out.push({start: day, end: next});
    day = next;
  }
  return out;
}

export type Creator = {id: string; name: string; net: number};

// Sum by_creator across the sub-ranges of [start, end].
export async function fetchCreators(proxyFetch: (url: string) => Promise<Response>, start: string, end: string): Promise<Creator[]> {
  const byId = new Map<string, Creator>();
  for (const r of revenueRanges(start, end)) {
    const res = await proxyFetch(`${CREATORSTAQ_RANGED}?start=${r.start}&end=${r.end}`);
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      throw new Error(body.error || `Creator Staq returned ${res.status}`);
    }
    const data: any = await res.json();
    if (!Array.isArray(data.by_creator)) throw new Error("Creator Staq returned an incomplete response");
    for (const c of data.by_creator) {
      const id = String(c.creator_id ?? c.account_id ?? c.name);
      const prev = byId.get(id);
      byId.set(id, {id, name: String(c.name ?? c.slug ?? id), net: num(c.net_revenue) + (prev?.net ?? 0)});
    }
  }
  return [...byId.values()].sort((a, b) => b.net - a.net);
}
