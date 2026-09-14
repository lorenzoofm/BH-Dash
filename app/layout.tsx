import type {Metadata} from 'next';
import './globals.css';
import Providers from './providers';
import Shell from './shell';
import {requireChatGPTUser} from './chatgpt-auth';
import {managerEmails} from '@/lib/data-server';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'20MG BH Operations',description:'Staff performance, expenses and profit.',icons:{icon:'/20mg.png',shortcut:'/20mg.png'}};
export default async function Layout({children}:{children:React.ReactNode}){const user=await requireChatGPTUser('/');const allowed=managerEmails().includes(user.email.toLowerCase());return <html lang="en"><body><Providers>{allowed?<Shell email={user.email} otherUrl={process.env.OTHER_DASHBOARD_URL||'https://gmr20mg.softr.app'}>{children}</Shell>:<main className="mx-auto max-w-xl p-12"><h1 className="text-2xl font-semibold">Manager access required</h1><p className="my-4">{user.email} does not have access to this dashboard.</p><a className="underline" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign in with another account</a></main>}</Providers></body></html>;}
