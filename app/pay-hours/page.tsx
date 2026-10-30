import {requirePage} from '@/app/require-page';
import PayHours from "@/views/pay-hours";
export default async function Page(){await requirePage('pay-hours');return <PayHours/>;}
