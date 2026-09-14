const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const c=vm.createContext({URL,URLSearchParams,console});
function load(file){const s=fs.readFileSync(__dirname+'/../lib/'+file,'utf8').replace(/^import .*;$/gm,'').replace(/\bexport /g,'');vm.runInContext(stripTypeScriptTypes(s),c);}
load('data-rules.ts');
const cfg=JSON.parse(fs.readFileSync(__dirname+'/../lib/data-config.json','utf8'));
assert.equal(c.validDay('2026-02-30'),false);assert.equal(c.validDay('2024-02-29'),true);
assert.throws(()=>c.projection({fields:[]},{constructor:'value'}));
const percent={table:'Models',actions:{PATCH:["Model's Cut %"]},fields:[{name:"Model's Cut %",type:'PERCENT'}]};
assert.equal(c.validateFields(percent,'PATCH',{cut:"Model's Cut %"},{cut:25})["Model's Cut %"],.25);
assert.throws(()=>c.validateFields(percent,'PATCH',{cut:"Model's Cut %"},{cut:101}));
assert.equal(c.validateFields(percent,'PATCH',{cut:"Model's Cut %"},{cut:null})["Model's Cut %"],null);
assert.equal(c.sameValue([{id:'a',label:'Alice'}],['a']),true);
assert.equal(c.sameValue(null,0),false);
if(cfg.kind==='content'){
 assert.throws(()=>c.validateFields(cfg.sources.accounts,'PATCH',{user:'Username'},{user:'https://evil.example'}));
 assert.throws(()=>c.validateFields(cfg.sources.accounts,'PATCH',{user:'Username'},{user:null}));
 load('library.ts');
 const accounts=[{id:'a',fields:{Username:'alice',Similarity:'April','look a like':'Sister',Category:'Outdoors'}},{id:'b',fields:{Username:'bob',Similarity:'Erin','look a like':'Mother',Category:'Travel'}}];
 const reels=Array.from({length:30},(_,i)=>({id:'r'+i,fields:{'Media URL':'https://www.instagram.com/reel/code'+i+'/','Media Type':'Reel','Instagram Account':i%2?['a']:['a','b'],'Views Count':i===0?null:100000+i,'Post Date':'2026-09-07T00:00:00Z',Caption:i===29?'remote search target':'caption'}}));
 const saved=[{id:'saved',fields:{'Source Reel':['r29'],'Reel URL':reels[29].fields['Media URL'],'Production Status':'Posted',Model:'April'}}];
 const run=p=>c.libraryResult(reels,accounts,saved,new URLSearchParams(p));
 let r=run({tab:'viral'});assert.equal(r.items.length,12);assert.equal(r.total,29);assert.equal(r.items[0].id,'r29');
 assert.equal(run({tab:'viral',search:'remote search target'}).total,1);
 assert.equal(run({tab:'viral',page:'3'}).items.length,5);
 assert.equal(run({tab:'viral',minViews:'0',maxViews:'0'}).total,0);
 r=run({tab:'all'});assert.equal(r.groups.length,2);assert.equal(r.groups[0].count,30);assert.equal(r.groups[0].videos.length,12);
 assert.equal(run({tab:'all',group:r.groups[0].key,page:'3'}).items.length,6);
 assert.equal(run({tab:'all',model:'April',look:'Mother'}).groups.length,0);
 assert.equal(run({tab:'all',category:'Travel'}).total,15);
 assert.equal(run({tab:'used'}).items[0].id,'r29');assert.equal(run({tab:'winning'}).total,0);
 assert.equal(run({tab:'used',model:'Erin'}).total,0);
 assert.throws(()=>run({since:'2026-02-30'}));assert.throws(()=>run({minViews:'-1'}));assert.throws(()=>run({sort:'__proto__'}));
}else{
 load('revenue-request.ts');
 assert.throws(()=>c.revenueURL('https://evil.example/v1/computed/revenue/monthly'));
 assert.throws(()=>c.revenueURL('https://api.creatorstaq.com/v1/computed/revenue/ranged?start=2026-02-30&end=2026-03-01'));
 assert.equal(c.revenueURL('https://api.creatorstaq.com/v1/computed/revenue/monthly?months=12').search,'?months=12');
 assert.throws(()=>c.validateFields(cfg.sources.paidSubs,'POST',{model:'Model',week:'Week Starting',subs:'Paid Subscribers'},{model:['rec12345678901234'],week:'2026-09-15',subs:3}));
 assert.throws(()=>c.validateFields(cfg.sources.map,'PATCH',{include:'Include in P&L'},{include:'yes'}));
 assert.throws(()=>c.validateFields(cfg.sources.paylog,'PATCH',{hours:'Hours Worked'},{hours:25}));
}
console.log('PASS: server validation, percentage scaling, blank/zero semantics, '+(cfg.kind==='content'?'full-library search, grouped pagination and saved joins.':'private revenue allowlist and weekly input rules.'));
