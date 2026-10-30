import {requirePage} from '@/app/require-page';
import Staff from "@/views/staff";
export default async function Page(){await requirePage('staff');return <Staff/>;}
