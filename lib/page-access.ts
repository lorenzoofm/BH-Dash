import {env} from 'cloudflare:workers';

import {PAGES,DEFAULT_MANAGER_PAGES,type Page} from './page-access-constants';
export {PAGES,DEFAULT_MANAGER_PAGES,type Page};
const valid = new Set<string>(PAGES);

function database() { return (env as any).PERMISSIONS_DB as D1Database | undefined; }
export function pagePermissionsReady(){return !!database();}

// One D1 read per person per 30s per isolate; the worker and the page layout both ask on every request.
const cache=new Map<string,{until:number;manager:boolean;pages:Page[]}>();
const forget=(email:string)=>cache.delete(email.toLowerCase());

async function lookup(email:string){
  const key=email.toLowerCase(),hit=cache.get(key);
  if(hit&&hit.until>Date.now())return hit;
  const db=database();
  let manager=false,pages:Page[]=[...DEFAULT_MANAGER_PAGES];
  if(db){
    const row=await db.prepare('SELECT m.email AS manager, p.pages AS pages FROM (SELECT ? AS email) q LEFT JOIN managers m ON m.email=q.email LEFT JOIN dashboard_permissions p ON p.email=q.email').bind(key).first<{manager:string|null;pages:string|null}>();
    manager=!!row?.manager;
    if(row?.pages){try{const list=JSON.parse(row.pages);pages=Array.isArray(list)?list.filter((page):page is Page=>typeof page==='string'&&valid.has(page)):[];}catch{pages=[];}}
  }
  const value={until:Date.now()+30000,manager,pages};
  cache.set(key,value);if(cache.size>500)cache.delete(cache.keys().next().value!);
  return value;
}

export async function isManager(email:string,isAdmin:boolean){return isAdmin||(await lookup(email)).manager;}

export async function pagesFor(email:string,isAdmin:boolean):Promise<Page[]> {
  if(isAdmin)return [...PAGES];
  return [...(await lookup(email)).pages];
}

export async function listManagers():Promise<string[]> {
  const db=database();if(!db)throw new Error('503:Page permissions database is not configured.');
  const {results}=await db.prepare('SELECT email FROM managers ORDER BY email').all<{email:string}>();
  return results.map(r=>r.email);
}
export async function addManager(email:string,by:string){
  const db=database();if(!db)throw new Error('503:Page permissions database is not configured.');
  await db.prepare('INSERT OR IGNORE INTO managers (email,added_by,added_at) VALUES (?,?,?)').bind(email.toLowerCase(),by,new Date().toISOString()).run();forget(email);
}
export async function removeManager(email:string){
  const db=database();if(!db)throw new Error('503:Page permissions database is not configured.');
  await db.batch([db.prepare('DELETE FROM managers WHERE email = ?').bind(email.toLowerCase()),db.prepare('DELETE FROM dashboard_permissions WHERE email = ?').bind(email.toLowerCase())]);forget(email);
}

export async function setPages(email:string,pages:unknown):Promise<Page[]> {
  if(!Array.isArray(pages)||pages.some(page=>typeof page!=='string'||!valid.has(page)))throw new Error('400:Choose valid dashboard pages.');
  const db=database();
  if(!db)throw new Error('503:Page permissions database is not configured.');
  const selected=[...new Set(pages)] as Page[];
  await db.prepare('INSERT INTO dashboard_permissions (email,pages) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET pages=excluded.pages').bind(email.toLowerCase(),JSON.stringify(selected)).run();
  forget(email);
  return selected;
}


export async function canSee(email:string,isAdmin:boolean,page:Page) { return (await pagesFor(email,isAdmin)).includes(page); }
