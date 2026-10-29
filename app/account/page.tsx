import {requireUser} from '@/app/auth';
import {adminEmails} from '@/lib/data-server';
import AccountView from './account-view';
export const dynamic='force-dynamic';
export default async function AccountPage({searchParams}: {searchParams: Promise<{denied?:string}>}){const user=await requireUser();const isAdmin=adminEmails().includes(user.email.toLowerCase());const {denied}=await searchParams;return <AccountView email={user.email} isAdmin={isAdmin} denied={!!denied}/>;}
