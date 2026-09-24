// Tests the shared date helpers (lib/bh.ts) and the P&L calculation (lib/finance.ts).
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
const c=vm.createContext({console,Intl});
function load(file){const s=fs.readFileSync(__dirname+'/../lib/'+file,'utf8').replace(/^"use client";$/m,'').replace(/^import [\s\S]*?;$/gm,'').replace(/\bexport /g,'');vm.runInContext(stripTypeScriptTypes(s),c);}
c.useEffect=()=>{};load('bh.ts');load('finance.ts');

// Weeks are Monday-based; a Sunday belongs to the week before.
assert.equal(c.mondayOf('2026-09-24'),'2026-09-21');
assert.equal(c.mondayOf('2026-09-21'),'2026-09-21');
assert.equal(c.mondayOf('2026-09-27'),'2026-09-21');
assert.equal(c.mondayOf('2026-01-01'),'2025-12-29');
assert.equal(c.addDays('2026-02-28',1),'2026-03-01');
assert.equal(c.validDay('2026-02-30'),false);

// Creator Staq ranges: inclusive dates become end-exclusive chunks of at most 31 days.
assert.equal(JSON.stringify(c.revenueRanges('2026-09-12','2026-09-12')),JSON.stringify([{start:'2026-09-12',end:'2026-09-13'}]));
const long=c.revenueRanges('2026-01-01','2026-03-15');
assert.equal(long[0].start,'2026-01-01');assert.equal(long.at(-1).end,'2026-03-16');
assert.ok(long.every(r=>(Date.parse(r.end)-Date.parse(r.start))/864e5<=31));
assert.equal(c.revenueRanges('2026-09-12','2026-09-11').length,0);

// P&L
const rec=(id,fields)=>({id,fields});
const model=rec('m1',{model:'Aria',dealType:'Managed',modelCut:50,ourCut:null});
const other=rec('m2',{model:'Bella',dealType:'Managed',modelCut:50});
const staff=[rec('s1',{name:'A',model:[{id:'m1'}]}),rec('s2',{name:'B',model:[{id:'m1'},{id:'m2'}]}),rec('s3',{name:'C',model:[{id:'m2'}]})];
const paylog=[
 rec('p1',{workDate:'2026-09-10',staff:[{id:'s1'}],hours:8,totalPay:40,status:'Paid'}),
 rec('p2',{workDate:'2026-09-11',staff:[{id:'s2'}],hours:8,totalPay:100,status:'Unpaid'}),  // split across 2 models
 rec('p3',{workDate:'2026-09-11',staff:[{id:'s3'}],hours:8,totalPay:999,status:'Paid'}),   // other model
 rec('p4',{workDate:'2026-08-31',staff:[{id:'s1'}],hours:8,totalPay:999,status:'Paid'}),   // outside range
];
const expenses=[
 rec('e1',{date:'2026-09-05',amount:30,status:'Paid',model:[{id:'m1'}],category:'Software'}),
 rec('e2',{date:'2026-09-05',amount:20,status:'Paid',model:[{id:'m1'},{id:'m2'}],category:'Ads'}), // split
 rec('e3',{date:'2026-09-05',amount:15,status:'Paid',model:[],category:'VPS'}),                   // shared
 rec('e4',{date:'2026-09-05',amount:500,status:'Unpaid',model:[{id:'m1'}],category:'Ads'}),       // not deducted
];
const map=[rec('a1',{accountId:5001,model:[{id:'m1'}],include:true}),rec('a2',{accountId:5002,model:[{id:'m1'}],include:false})];
const creators=[{id:'5001',name:'Aria',net:1000},{id:'5002',name:'Aria old',net:777},{id:'9',name:'X',net:5000}];
const base={staff,paylog,expenses,map,creators,start:'2026-09-01',end:'2026-09-30',includeShared:true,revenueKnown:true};
let p=c.modelPnL(model,base);
assert.equal(p.pageRevenue,1000);          // only included linked page
assert.equal(p.income,1000);
assert.equal(p.payout,500);
assert.equal(p.wages,40+50);               // s1 full, s2 half
assert.equal(p.unpaidWages,50);
assert.equal(p.expenses,30+10+15);         // own + half split + shared
assert.equal(p.unpaidExpenses,500);
assert.equal(p.profit,1000-500-90-55);
assert.equal(c.modelPnL(model,{...base,includeShared:false}).expenses,40);
// Chat-only earns our cut, no payout.
p=c.modelPnL(rec('m1',{model:'Aria',dealType:'Chat-only',ourCut:30,modelCut:null}),base);
assert.equal(p.income,300);assert.equal(p.payout,0);
// Missing percentages and missing revenue give null, never 0.
assert.equal(c.modelPnL(rec('m1',{model:'Aria',dealType:'Managed',modelCut:null}),base).profit,null);
assert.equal(c.modelPnL(model,{...base,revenueKnown:false}).income,null);
assert.equal(c.modelPnL(other,base).linked,false);
assert.equal(c.modelPnL(other,base).income,null);
console.log('finance checks passed');
