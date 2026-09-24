import PnL from "@/views/pnl";
import {requireFinance} from '@/app/finance-access';
export default async function Page(){await requireFinance();return <PnL/>;}
