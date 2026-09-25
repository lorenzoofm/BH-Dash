import {env} from 'cloudflare:workers';

import {PAGES,DEFAULT_MANAGER_PAGES,type Page} from './page-access-constants';
export {PAGES,DEFAULT_MANAGER_PAGES,type Page};
const valid = new Set<string>(PAGES);

function database() { return (env as any).PERMISSIONS_DB as D1Database | undefined; }
export function pagePermissionsReady(){return !!database();}

export async function pagesFor(email:string,isAdmin:boolean):Promise<Page[]> {
  if(isAdmin)return [...PAGES];
  const db=database();
  if(!db)return [...DEFAULT_MANAGER_PAGES];
  const row=await db.prepare('SELECT pages FROM dashboard_permissions WHERE email = ?').bind(email.toLowerCase()).first<{pages:string}>();
  if(!row)return [...DEFAULT_MANAGER_PAGES];
  try { const pages=JSON.parse(row.pages);return Array.isArray(pages)?pages.filter((page):page is Page=>typeof page==='string'&&valid.has(page)):[]; }
  catch { return []; }
}

export async function setPages(email:string,pages:unknown):Promise<Page[]> {
  if(!Array.isArray(pages)||pages.some(page=>typeof page!=='string'||!valid.has(page)))throw new Error('400:Choose valid dashboard pages.');
  const db=database();
  if(!db)throw new Error('503:Page permissions database is not configured.');
  const selected=[...new Set(pages)] as Page[];
  await db.prepare('INSERT INTO dashboard_permissions (email,pages) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET pages=excluded.pages').bind(email.toLowerCase(),JSON.stringify(selected)).run();
  return selected;
}

export async function removePages(email:string) { await database()?.prepare('DELETE FROM dashboard_permissions WHERE email = ?').bind(email.toLowerCase()).run(); }

export async function canSee(email:string,isAdmin:boolean,page:Page) { return (await pagesFor(email,isAdmin)).includes(page); }
