import type {Metadata} from 'next';
import './globals.css';
import Providers from './providers';
import Shell from './shell';
import {requireUser} from './auth';
import {adminEmails} from '@/lib/data-server';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'20MG BH Operations',description:'Staff performance, expenses and profit.',icons:{icon:'/20mg.png',shortcut:'/20mg.png'}};
export default async function Layout({children}:{children:React.ReactNode}){const user=await requireUser();return <html lang="en"><body><Providers><Shell email={user.email} isAdmin={adminEmails().includes(user.email.toLowerCase())} otherUrl={process.env.OTHER_DASHBOARD_URL||'https://gmr20mg.softr.app'}>{children}</Shell></Providers></body></html>;}
