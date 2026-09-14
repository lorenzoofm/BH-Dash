export function validDay(value:unknown):value is string {
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
export function projection(s:any,raw:any):Record<string,string>{
 if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.keys(raw).length>50)throw new Error('400:Invalid field selection.');
 for(const [alias,name] of Object.entries(raw))if(!/^[\w -]{1,80}$/.test(alias)||['__proto__','constructor','prototype'].includes(alias)||typeof name!=='string'||!s.fields.some((f:any)=>f.name===name))throw new Error('400:Unknown field.');
 return raw;
}
export function validateFields(s:any,method:string,select:Record<string,string>,input:any){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).length>50)throw new Error('400:Invalid record fields.');
 const allowed=s.actions[method];if(!allowed)throw new Error('403:This action is unavailable.');
 const output:Record<string,any>={};
 for(const [alias,value] of Object.entries(input)){
  const name=Object.hasOwn(select,alias)?select[alias]:'',f=s.fields.find((f:any)=>f.name===name);
  if(!f||!allowed.includes(name))throw new Error('400:This field cannot be edited.');
  if(value!==null){
   if(['NUMBER','CURRENCY','PERCENT'].includes(f.type)&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error('400:Enter a valid number for '+name+'.');
   if(f.type==='LINKED_RECORD'&&(!Array.isArray(value)||value.length>50||new Set(value).size!==value.length||value.some(x=>typeof x!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(x))))throw new Error('400:Choose valid linked records.');
   if(f.type==='CHECKBOX'&&typeof value!=='boolean')throw new Error('400:Choose true or false.');
   if(f.type==='SELECT'&&(typeof value!=='string'||(!(s.table==='Expense Log'&&name==='Category'&&value.trim().length>0&&value.length<=80)&&!f.options?.choices?.some((o:any)=>o.label===value))))throw new Error('400:Choose an existing '+name+' option.');
   if(['SINGLE_LINE_TEXT','LONG_TEXT','URL','DATETIME','EMAIL'].includes(f.type)&&(typeof value!=='string'||value.length>(f.type==='LONG_TEXT'?100000:2000)))throw new Error('400:Invalid '+name+'.');
   if(f.type==='DATETIME'&&value!==''&&(!validDay(String(value).slice(0,10))||(f.rawType==='date'&&String(value).length!==10)||(String(value).length>10&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(String(value)))))throw new Error('400:Choose a valid date.');
   if(f.type==='EMAIL'&&value!==''&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))throw new Error('400:Enter a valid email.');
   if(['Conversions','Paid Subscribers','Daily Target','Weekly Minimum','Monthly Target','Likes','Account ID'].includes(name)&&(typeof value!=='number'||value<0||!Number.isSafeInteger(value)))throw new Error('400:Enter a whole number of zero or more.');
   if(['Hours Worked','Standard Daily Hours'].includes(name)&&(typeof value!=='number'||value<0||value>24))throw new Error('400:Hours must be between 0 and 24.');
   if(['Amount','Current Hourly Rate','Hourly Rate Snapshot','Bonus','Deductions'].includes(name)&&(typeof value!=='number'||value<0))throw new Error('400:Enter an amount of zero or more.');
   if(f.type==='PERCENT'&&(typeof value!=='number'||value<0||value>100))throw new Error('400:Percentages must be between 0% and 100%.');
   if(['Week Starting','Effective Week'].includes(name)&&value!==''&&new Date(String(value)+'T00:00:00Z').getUTCDay()!==1)throw new Error('400:Weekly entries must start on a Monday.');
  }
  output[name]=f.type==='PERCENT'&&value!==null?Number(value)/100:value;
 }
 const required:Record<string,string[]>={'Instagram Accounts':['Username'],'Winning content':['Reel URL'],'Staff':['Staff ID','Full Name'],'Pay Log':['Staff','Work Date','Hours Worked','Hourly Rate Snapshot'],'Expense Log':['Expense ID','Expense Date','Description','Amount'],'Models':['Model'],'Model Accounts':['Account Slug','Account ID'],'Conversion Log':['Staff','Model','Week Starting','Conversions'],'Staff Expectations':['Staff','Effective Week'],'Weekly Paid Subscribers':['Model','Week Starting']};
 for(const name of required[s.table]??[])if((method==='POST'||Object.hasOwn(output,name))&&(output[name]===null||output[name]===undefined||output[name]===''||(Array.isArray(output[name])&&output[name].length===0)))throw new Error('400:'+name+' is required.');
 for(const name of ['Staff','Model'])if(Array.isArray(output[name])&&s.table!=='Expense Log'&&output[name].length>1)throw new Error('400:Choose one '+name.toLowerCase()+'.');
 if(s.table==='Instagram Accounts'&&output.Username!=null){const u=String(output.Username).trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9._]{1,30}$/.test(u)||['reel','reels','p','explore'].includes(u))throw new Error('400:Enter a valid Instagram username.');output.Username=u;}
 if(s.table==='Winning content'&&output['Reel URL']){const code=String(output['Reel URL']).match(/^https:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/([\w-]+)\/?$/)?.[1];if(!code)throw new Error('400:Enter an Instagram reel URL.');output['Reel URL']='https://www.instagram.com/reel/'+code+'/';}
 return output;
}
export const uniqueFields:Record<string,string[]>= {'Instagram Accounts':['Username'],'Winning content':['Reel URL'],'Weekly Paid Subscribers':['Model','Week Starting'],'Staff Expectations':['Staff','Effective Week'],'Conversion Log':['Staff','Model','Week Starting'],'Staff':['Staff ID'],'Models':['Model'],'Model Accounts':['Account Slug'],'Expense Log':['Expense ID']};
export function sameValue(a:any,b:any):boolean {const normal=(v:any):any=>v==null||v===''?null:Array.isArray(v)?v.map((x:any)=>typeof x==='object'?x.id:x).sort():v;return JSON.stringify(normal(a))===JSON.stringify(normal(b));}
