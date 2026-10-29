import type {Metadata} from 'next';
import './globals.css';
import Providers from './providers';
import Shell from './shell';
import {requireUser} from './auth';
import {adminEmails} from '@/lib/data-server';
import {pagesFor} from '@/lib/page-access';
import {frontendApi} from '@/lib/clerk-auth';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'20MG BH Operations',description:'Staff performance, expenses and profit.',icons:{icon:'/20mg.png',shortcut:'/20mg.png'}};
export default async function Layout({children}:{children:React.ReactNode}){
 const user=await requireUser();
 const isAdmin=adminEmails().includes(user.email.toLowerCase());
 const pages=await pagesFor(user.email,isAdmin);
 const clerkKey=process.env.CLERK_PUBLISHABLE_KEY||'',clerkHost=frontendApi({CLERK_PUBLISHABLE_KEY:clerkKey});
 return <html lang="en" data-theme="light" suppressHydrationWarning><head>
  <link rel="preload" href="/fonts/archivo-latin.woff2" as="font" type="font/woff2" crossOrigin=""/>
  {/* Apply the saved Paper/Ink choice before paint. */}
  <script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('bh-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`}}/>
  {/* Keeps the Clerk session cookie fresh while the dashboard is open. */}
  {clerkHost&&<script async crossOrigin="anonymous" data-clerk-publishable-key={clerkKey} src={`https://${clerkHost}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`}/>}
  {clerkHost&&<script dangerouslySetInnerHTML={{__html:`addEventListener('load',function(){var c=window.Clerk;c&&c.load&&c.load().catch(function(){})})`}}/>}
 </head><body><Providers><Shell email={user.email} isAdmin={isAdmin} pages={pages} otherUrl={process.env.OTHER_DASHBOARD_URL||'https://gmr20mg.softr.app'}>{children}</Shell></Providers></body></html>;
}
