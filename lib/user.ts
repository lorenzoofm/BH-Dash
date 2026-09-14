"use client";
import {useSession} from './datasource';
export function useCurrentUser():any{const s=useSession();return s.data?.user?{...s.data.user,name:s.data.user.displayName}:null;}
