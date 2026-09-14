import {validDay} from './data-rules';
export function revenueURL(raw:string|null){
 let url:URL;try{url=new URL(raw||'');}catch{throw new Error('400:Invalid revenue request.');}
 if(url.origin!=='https://api.creatorstaq.com'||url.username||url.password||url.hash)throw new Error('400:Invalid revenue destination.');
 const output=new URL(url.origin+url.pathname);
 if(url.pathname==='/v1/computed/revenue/monthly'){
  const months=Number(url.searchParams.get('months')||'24');if(!Number.isInteger(months)||months<1||months>24||[...url.searchParams.keys()].some(k=>k!=='months'))throw new Error('400:Choose between 1 and 24 months.');output.searchParams.set('months',String(months));
 }else if(url.pathname==='/v1/computed/revenue/ranged'){
  const start=url.searchParams.get('start'),end=url.searchParams.get('end');
  if(!validDay(start)||!validDay(end)||start>=end||Date.parse(end)-Date.parse(start)>32*86400000||[...url.searchParams.keys()].some(k=>!['start','end'].includes(k)))throw new Error('400:Invalid revenue date range.');
  output.searchParams.set('start',start);output.searchParams.set('end',end);
 }else throw new Error('400:Unknown revenue endpoint.');
 return output;
}
