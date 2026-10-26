const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
(async () => {
  let source = fs.readFileSync('lib/data-server.ts', 'utf8')
    .replace("import { getUser } from '@/app/auth';", 'const getUser=async()=>null;')
    .replace("export {projection,validateFields} from './data-rules';", '')
    .replace("import rawConfig from './data-config.json';", `const rawConfig=${fs.readFileSync('lib/data-config.json','utf8')};`);
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const originalFetch=global.fetch;process.env.AIRTABLE_TOKEN='check-token';
  const requests=[];
  global.fetch=async url=>{
    const u=new URL(url);requests.push(u);
    if(u.pathname.endsWith('/staff'))return Response.json({records:[{id:'staff1',fields:{Name:'Alice'}}]});
    if(u.pathname.endsWith('/models'))return Response.json({records:[{id:'model1',fields:{Name:'April'}}]});
    return Response.json({records:[{id:u.searchParams.has('offset')?'page2':'page1',fields:{}}],...(!u.searchParams.has('offset')?{offset:'next'}:{})});
  };
  try {
    const mod=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
    mod.config.sources={staff:{tableId:'staff',table:'Staff',primaryField:'Name'},models:{tableId:'models',table:'Models',primaryField:'Name'}};
    const schema={fields:[{name:'Staff',type:'LINKED_RECORD',options:{linkedTableId:'Staff'}},{name:'Model',type:'LINKED_RECORD',options:{linkedTableId:'Models'}},{name:'Cut',type:'PERCENT'}]};
    const rows=Array.from({length:100},(_,i)=>({id:'row'+i,fields:{Staff:['staff1'],Model:['model1'],Cut:0.25}}));
    const formatted=await mod.formatRecords(schema,rows,{staff:'Staff',model:'Model',cut:'Cut'});
    assert.equal(formatted.length,100);assert.equal(requests.length,2);
    assert.deepEqual(formatted[0].fields,{staff:[{id:'staff1',label:'Alice'}],model:[{id:'model1',label:'April'}],cut:25});
    assert.ok(requests.every(u=>u.searchParams.get('fields[]')==='Name'));
    const all=await mod.allRows({tableId:'pay'},false,new URLSearchParams({'fields[]':'Hours'}));
    assert.deepEqual(all.map(r=>r.id),['page1','page2']);
    assert.ok(requests.slice(2).every(u=>u.searchParams.get('fields[]')==='Hours'));
    assert.equal(requests[3].searchParams.get('offset'),'next');
    console.log('Data loading checks passed: batched labels, minimal fields, complete pagination.');
  } finally {global.fetch=originalFetch;}
})().catch(e=>{console.error(e);process.exitCode=1;});
