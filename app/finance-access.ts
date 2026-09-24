import {redirect} from 'next/navigation';
import {requireUser} from '@/app/auth';
import {adminEmails} from '@/lib/data-server';

export async function requireFinance() {
  const user = await requireUser();
  if (!adminEmails().includes(user.email.toLowerCase())) redirect('/account?denied=finance');
}
