import Overview from "@/views/overview";
import {requireUser} from '@/app/auth';
import {adminEmails} from '@/lib/data-server';
import {canSee} from '@/lib/page-access';
import {requirePage} from '@/app/require-page';
export default async function Page(){const user=await requirePage('overview');const isAdmin=adminEmails().includes(user.email.toLowerCase());const financeAllowed=await canSee(user.email,isAdmin,'pnl');return <>{financeAllowed&&<a className="mb-3 block text-right text-xs text-muted-foreground underline" href="/detailed/overview">Detailed overview reports</a>}<Overview isAdmin={financeAllowed}/></>;}
