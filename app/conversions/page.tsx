import {requirePage} from '@/app/require-page';
import Conversions from "@/views/conversions";
export default async function Page(){await requirePage('conversions');return <Conversions/>;}
