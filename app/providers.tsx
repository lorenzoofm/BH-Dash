"use client";
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
import {Toaster} from '@/components/ui/sonner';
import {Toast} from '@/components/bh/toast';
export default function Providers({children}:{children:React.ReactNode}){const [client]=useState(()=>new QueryClient());return <QueryClientProvider client={client}>{children}<Toaster/><Toast/></QueryClientProvider>;}
