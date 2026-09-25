import Revenue from "@/views/revenue";
import {requireFinance} from '@/app/finance-access';
export default async function Page(){await requireFinance('revenue');return <><a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/revenue">Detailed tools and reports</a><Revenue/></>;}
