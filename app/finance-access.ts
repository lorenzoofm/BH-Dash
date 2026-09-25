import {requirePage} from '@/app/require-page';

export async function requireFinance(page:'pnl'|'revenue'='pnl') { await requirePage(page); }
