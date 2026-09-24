"use client";
import {useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {useProxyFetch, useRecordCreate, useRecordDelete, useRecordUpdate, useRecords} from "@/lib/datasource";
import {fetchCreators, label, linkIds, revenueRanges, rowsOf, useAllPages} from "@/lib/bh";

// One field selection per Airtable table. Every page reads through these, so the
// query cache is shared and navigating between pages doesn't refetch.
export const SELECT = {
  staff: {name: "Full Name", staffId: "Staff ID", status: "Status", model: "Model", platform: "Platform", payType: "Pay Type", rate: "Current Hourly Rate", currency: "Currency", hours: "Standard Daily Hours", start: "Start Date", end: "End Date", email: "Email"},
  paylog: {workDate: "Work Date", staff: "Staff", hours: "Hours Worked", rate: "Hourly Rate Snapshot", bonus: "Bonus", deductions: "Deductions", status: "Payment Status", paidDate: "Payment Date", notes: "Notes", submittedBy: "Submitted By", totalPay: "Total Pay"},
  expenses: {expenseId: "Expense ID", date: "Expense Date", description: "Description", amount: "Amount", currency: "Currency", category: "Category", channel: "Channel", model: "Model", vendor: "Vendor", billing: "Billing Type", status: "Status", paidDate: "Paid Date", notes: "Notes", createdBy: "Created By", sourceRef: "Source Ref"},
  models: {model: "Model", status: "Status", dealType: "Deal Type", modelCut: "Model's Cut %", ourCut: "Our Cut %", basis: "Payout Basis", start: "Start Date", notes: "Notes"},
  map: {slug: "Account Slug", accountId: "Account ID", ofUsername: "OF Username", model: "Model", include: "Include in P&L", notes: "Notes"},
  conversions: {week: "Week Starting", staff: "Staff", model: "Model", conversions: "Conversions", notes: "Notes", source: "Source"},
  expectations: {name: "Name", week: "Effective Week", staff: "Staff", daily: "Daily Target", weekly: "Weekly Minimum", monthly: "Monthly Target"},
  paidSubs: {name: "Name", week: "Week Starting", model: "Model", paidSubs: "Paid Subscribers", notes: "Notes"},
} as const;

export type TableName = keyof typeof SELECT;

export function useTable(name: TableName) {
  const select = SELECT[name];
  const result = useRecords({from: name, select});
  useAllPages(result);
  const onError = () => {};
  const create = useRecordCreate({from: name, fields: select as any, onError});
  const update = useRecordUpdate({from: name, fields: select as any, onError});
  const remove = useRecordDelete({from: name, onError});
  const rows = useMemo(() => rowsOf(result), [result.data]);
  return {
    rows,
    loading: result.status !== "error" && (result.status === "pending" || !!result.hasNextPage),
    error: result.status === "error" ? (result.error as Error) : null,
    refetch: result.refetch,
    fetching: result.isFetching,
    create: (fields: Record<string, any>) => create.mutateAsync(fields),
    update: (id: string, fields: Record<string, any>) => update.mutateAsync({recordId: id, fields}),
    remove: (id: string) => remove.mutateAsync(id),
  };
}

// Option lists for the grids.
export const opts = (values: readonly string[]) => values.map(v => ({value: v, label: v}));
export function linkOptions(rows: {id: string; fields: Record<string, any>}[], key: string) {
  return rows.map(r => ({value: r.id, label: label(r.fields[key]) || "Untitled"})).sort((a, b) => a.label.localeCompare(b.label));
}

export const CHOICES = {
  staffStatus: ["Active", "Setup", "Inactive"],
  platform: ["X", "OnlyFans", "Fanvue", "Instagram", "Discord", "Threads", "Reddit", "VPS"],
  payType: ["Hourly", "Salary", "Commission"],
  currency: ["USD", "GBP", "EUR", "AUD"],
  payStatus: ["Unpaid", "Scheduled", "Paid"],
  expenseStatus: ["Planned", "Unpaid", "Paid"],
  billing: ["One-off", "Daily", "Weekly", "Monthly", "Annual"],
  category: ["Paid traffic", "Payroll", "Infrastructure", "Software", "Creative", "Influencer", "Organic growth", "Legal", "Other", "Paid ads", "Accounts", "VPS", "cupid", "Convos"],
  modelStatus: ["Active", "Paused", "Ended"],
  dealType: ["Managed", "Chat-only"],
  basis: ["Net revenue (after OnlyFans 20%)", "Gross revenue", "Flat fee"],
} as const;

// Creator Staq earnings by page for a date range (inclusive).
export function useCreators(start: string | null, end: string | null) {
  const proxyFetch = useProxyFetch("live");
  return useQuery({
    queryKey: ["bh-creators", start, end], enabled: !!start && !!end && start <= end, staleTime: 60000, refetchInterval: 120000, retry: 1,
    queryFn: () => fetchCreators(proxyFetch, start!, end!),
  });
}

// The Creator Staq page ids linked to a model through Model Accounts.
export function linkedPages(mapRows: {fields: Record<string, any>}[], modelId: string) {
  return new Set(mapRows.filter(r => r.fields.include !== false && linkIds(r.fields.model).includes(modelId)).map(r => String(r.fields.accountId ?? "")));
}

export function useAccountRevenues(slugs: string[], start: string | null, end: string | null) {
  const proxyFetch = useProxyFetch("live");
  const accounts = [...new Set(slugs)].sort();
  return useQuery({
    queryKey: ["bh-account-revenue", accounts.join(","), start, end],
    enabled: accounts.length > 0 && !!start && !!end && start <= end,
    staleTime: 60000, retry: 1,
    queryFn: async () => {
      const result: Record<string, {net: number | null; error?: string}> = {};
      for (let i = 0; i < accounts.length; i += 5) await Promise.all(accounts.slice(i, i + 5).map(async slug => {
        try {
          let total = 0;
          for (const range of revenueRanges(start!, end!)) {
            const url = `https://api.creatorstaq.com/v1/computed/${encodeURIComponent(slug)}/revenue/ranged?start=${range.start}&end=${range.end}`;
            const response = await proxyFetch(url);
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.error || `Creator Staq returned ${response.status}`);
            }
            const body = await response.json();
            const amount = Number(body.kpis?.total_net);
            if (!Number.isFinite(amount)) throw new Error("Incomplete account revenue");
            total += amount;
          }
          result[slug] = {net: total};
        } catch (e) { result[slug] = {net: null, error: e instanceof Error ? e.message : "Connection failed"}; }
      }));
      return result;
    },
  });
}
