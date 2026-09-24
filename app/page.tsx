import Overview from "@/views/overview";
import {requireUser} from '@/app/auth';
import {adminEmails} from '@/lib/data-server';
export default async function Page(){const user=await requireUser();const isAdmin=adminEmails().includes(user.email.toLowerCase());return <>{isAdmin&&<a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/overview">Detailed overview reports</a>}<Overview isAdmin={isAdmin}/></>;}
