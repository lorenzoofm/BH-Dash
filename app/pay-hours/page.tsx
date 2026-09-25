import {requirePage} from '@/app/require-page';
import PayHours from "@/views/pay-hours";
export default async function Page(){await requirePage('pay-hours');return <><a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/pay-hours">Detailed tools and reports</a><PayHours/></>;}
