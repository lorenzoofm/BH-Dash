import type {Metadata} from 'next';
import './globals.css';
import Providers from './providers';
import Shell from './shell';
import {requireUser} from './auth';
import {adminEmails} from '@/lib/data-server';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'20MG BH Operations',description:'Staff performance, expenses and profit.',icons:{icon:'/20mg.png',shortcut:'/20mg.png'}};
export default async function Layout({children}:{children:React.ReactNode}){
 const user=await requireUser();
 return <html lang="en"><head>
  <link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"/>
 </head><body><Providers><Shell email={user.email} isAdmin={adminEmails().includes(user.email.toLowerCase())} otherUrl={process.env.OTHER_DASHBOARD_URL||'https://gmr20mg.softr.app'}>{children}</Shell></Providers></body></html>;
}
