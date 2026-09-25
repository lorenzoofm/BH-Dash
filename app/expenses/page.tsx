import {requirePage} from '@/app/require-page';
import Expenses from "@/views/expenses";
export default async function Page(){await requirePage('expenses');return <><a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/expenses">Detailed tools and reports</a><Expenses/></>;}
