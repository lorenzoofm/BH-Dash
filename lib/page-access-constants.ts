export const PAGES = ['overview','conversions','staff','pay-hours','expenses','pnl','revenue','convos'] as const;
export type Page = typeof PAGES[number];
export const DEFAULT_MANAGER_PAGES:Page[] = ['overview','conversions','staff','pay-hours','expenses'];
