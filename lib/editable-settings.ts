"use client";
import {useSession} from './datasource';
export function useTextSetting(o:any){const s=useSession();return o.name==='allowed-emails'?(s.data?.allowedEmails??''):o.initialValue;}
export function useNavigationSetting(o:any){return o.initialValue;}
export function useImageSetting(o:any){return o.initialValue;}
