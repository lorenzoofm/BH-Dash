import {redirect} from 'next/navigation';
import {requireUser} from '@/app/auth';
import {adminEmails} from '@/lib/data-server';
import {canSee} from '@/lib/page-access';
import type {Page} from '@/lib/page-access-constants';

export async function requirePage(page:Page){
 const user=await requireUser();
 if(!(await canSee(user.email,adminEmails().includes(user.email.toLowerCase()),page)))redirect('/account?denied='+page);
 return user;
}
