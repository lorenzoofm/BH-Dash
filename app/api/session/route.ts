import {session} from '@/lib/data-server';
export const dynamic='force-dynamic';
export async function GET(){const s=await session();return Response.json(s);}
