import Overview from "@/views/overview";
import {adminEmails} from '@/lib/data-server';
import {pagesFor} from '@/lib/page-access';
import {requirePage} from '@/app/require-page';
export default async function Page(){const user=await requirePage('overview');const pages=await pagesFor(user.email,adminEmails().includes(user.email.toLowerCase()));return <Overview pages={pages}/>;}
