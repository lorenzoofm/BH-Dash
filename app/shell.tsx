"use client";
import {useEffect} from "react";
import {usePathname} from 'next/navigation';
import {Sidebar,SidebarProvider,SidebarContent,SidebarHeader,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarInset,SidebarTrigger} from '@/components/ui/sidebar';
import {BarChart3,Users,Clock,Wallet,Receipt,TrendingUp,LayoutDashboard,ArrowUpRight} from 'lucide-react';
const items=[['/','Overview',LayoutDashboard],['/conversions','Conversions',BarChart3],['/staff','Staff',Users],['/pay-hours','Pay & Hours',Clock],['/pnl','P&L',Wallet],['/expenses','Expenses',Receipt],['/revenue','Revenue',TrendingUp]] as const;
export default function Shell({children,email,otherUrl}:{children:React.ReactNode,email:string,otherUrl:string}){
 const path=usePathname();
 useEffect(()=>{
  const context=(document as any).modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  try{Promise.resolve(context.registerTool({name:"read_visible_bh_report",description:"Read the currently visible BH report, including selected period, totals, table rows and loading or error messages. Does not change filters or records.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input:any){if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length)throw new Error("This tool takes no parameters.");const main=document.querySelector("main");return {path:window.location.pathname,report:main?.innerText.slice(0,30000)||"Report is not available yet."};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}return()=>lifecycle.abort();
 },[]);
 return <SidebarProvider><Sidebar className="border-r-0"><SidebarHeader className="px-5 py-7"><a href="/" className="flex items-center gap-3"><img src="/20mg.png" alt="20MG" width="44" height="44" className="rounded-lg"/><span className="font-semibold">BH Operations</span></a></SidebarHeader><SidebarContent className="px-3"><SidebarMenu>{items.map(([url,label,Icon])=><SidebarMenuItem key={url}><SidebarMenuButton asChild isActive={path===url} className="h-11 px-3 text-sm"><a href={url}><Icon/><span>{label}</span></a></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent><SidebarFooter className="gap-4 px-5 py-5"><a href={otherUrl} className="flex items-center justify-between text-sm">Content Studio<ArrowUpRight size={16}/></a><span className="break-all text-sm text-sidebar-foreground/70">{email}</span><a className="text-sm underline" href="/cdn-cgi/access/logout" target="_top">Sign out</a></SidebarFooter></Sidebar><SidebarInset><header className="flex h-16 items-center gap-3 border-b bg-white px-5"><SidebarTrigger/><span className="font-medium">{items.find(i=>i[0]===path)?.[1]||'BH Operations'}</span></header><main className="space-y-6 p-4 lg:p-7">{children}</main></SidebarInset></SidebarProvider>;
}
