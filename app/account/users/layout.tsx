import {redirect} from 'next/navigation';
import {session} from '@/lib/data-server';

export default async function UsersLayout({children}: {children: React.ReactNode}) {
  if (!(await session()).isAdmin) redirect('/account');
  return children;
}
