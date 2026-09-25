export const PAGES = ['overview','conversions','staff','pay-hours','expenses','pnl','revenue'] as const;
export type Page = typeof PAGES[number];
export const DEFAULT_MANAGER_PAGES:Page[] = ['overview','conversions','staff','pay-hours','expenses'];
