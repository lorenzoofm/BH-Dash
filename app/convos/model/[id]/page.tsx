import {requirePage} from '@/app/require-page';
import ModelConvos from "@/views/convos/model";
export default async function Page({params}:{params:Promise<{id:string}>}){await requirePage('convos');const {id}=await params;return <ModelConvos id={decodeURIComponent(id)}/>;}
