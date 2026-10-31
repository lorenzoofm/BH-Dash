import {requirePage} from '@/app/require-page';
import Convos from "@/views/convos";
export default async function Page(){await requirePage('convos');return <Convos/>;}
