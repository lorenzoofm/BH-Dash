import {requirePage} from '@/app/require-page';
import Staff from "@/views/staff";
export default async function Page(){await requirePage('staff');return <><a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/staff">Detailed tools and reports</a><Staff/></>;}
