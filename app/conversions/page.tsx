import {requirePage} from '@/app/require-page';
import Conversions from "@/views/conversions";
export default async function Page(){await requirePage('conversions');return <><a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/conversions">Detailed tools and reports</a><Conversions/></>;}
