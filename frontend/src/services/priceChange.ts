import * as XLSX from 'xlsx';
import { getSecondarySupabaseClient } from '../lib/supabase';
import { saveZipBundle,type ExportProgress } from './desktopExport';

export type Campaign={id?:string;title:string;document_date?:string|null;effective_date?:string|null;decree_numbers:string;notes:string;status:string};
export type Item={id?:string;campaign_id:string;line_no:number;item_code:string;item_description:string;old_pharmacy_price:number|null;old_public_price:number|null;new_pharmacy_price:number|null;new_public_price:number|null;default_pack_qty:number|null;active:boolean};
export type Assignment={id?:string;campaign_id:string;driver_id:string;customer_name:string;location:string;telephone:string;assigned_at?:string;notes:string;active:boolean;location_locked:boolean};
export type Visit={id?:string;campaign_id:string;driver_id:string;customer_name:string;location:string;telephone:string;visited_at:string;pharmacist_name:string;attachment_path?:string|null;signature_path?:string|null;notes:string;status:string;assignment_id?:string;price_change_visit_items?:{item_id:string;quantity:number}[]};

const ADMIN_KEY='0000';
const db=()=>{const c=getSecondarySupabaseClient();if(!c)throw new Error('Secondary Supabase is not configured');return c;};
async function adminKey(){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ADMIN_KEY));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{const {data,error}=await db().rpc(name,args);if(error)throw new Error(error.message);return data as T;}
export async function getAdminData(campaignId?:string){return rpc<any>('dispatchops_price_change_admin_data',{p_key:await adminKey(),p_campaign_id:campaignId??null});}
export async function listCampaigns(){const x=await getAdminData();return (x?.campaigns||[]) as Campaign[];}
export async function listItems(campaignId:string){const x=await getAdminData(campaignId);return (x?.items||[]) as Item[];}
export async function listAssignments(campaignId?:string){const x=await getAdminData(campaignId);return (x?.assignments||[]) as Assignment[];}
export async function listVisits(campaignId?:string){const x=await getAdminData(campaignId);return (x?.visits||[]) as Visit[];}
export async function listDrivers(){const x=await getAdminData();return x?.drivers||[];}
export async function saveCampaign(x:Campaign){return rpc<Campaign>('dispatchops_price_change_admin_save_campaign',{p_key:await adminKey(),p_row:x});}
export async function saveItem(x:Item){return rpc<Item>('dispatchops_price_change_admin_save_item',{p_key:await adminKey(),p_row:x});}
export async function saveAssignment(x:Assignment,itemIds:string[]){return rpc<Assignment>('dispatchops_price_change_admin_save_assignment',{p_key:await adminKey(),p_row:x,p_item_ids:itemIds});}
export async function deleteRow(table:'campaign'|'item'|'assignment'|'visit',id:string){return rpc<boolean>('dispatchops_price_change_admin_delete',{p_key:await adminKey(),p_table:table,p_id:id});}
export async function resetPriceChangeData(campaignId?:string,driverId?:string){return rpc<boolean>('dispatchops_price_change_admin_reset',{p_key:await adminKey(),p_campaign_id:campaignId??null,p_driver_id:driverId??null});}

async function getEvidenceSignedUrl(path:string):Promise<string>{
  if(!path)return '';
  const key=await adminKey();
  const baseUrl=(import.meta.env.VITE_SUPABASE_SECONDARY_URL as string|undefined)?.replace(/\/$/,'') || 'https://vyqyrcqrdsyrxywglqbh.supabase.co';
  const publishableKey=(import.meta.env.VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY as string|undefined) || 'sb_publishable_CreQOVJ9ZYkp6PGBqWHlVA_q1CSur1n';
  const r=await fetch(baseUrl+'/functions/v1/dispatchops-price-change-upload',{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify({action:'sign',admin_key:key,path,expires_in:60*60*24*30})});
  const x=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(x.error||x.message||'Could not create evidence link');
  return String(x.signed_url||'');
}

export async function getPriceChangeEvidenceUrl(path?:string|null){return path?getEvidenceSignedUrl(path):'';}
export async function saveCampaignArea(x:{id?:string;campaign_id:string;area_name:string;sort_order?:number;active?:boolean}){return rpc<any>('dispatchops_price_change_admin_save_area',{p_key:await adminKey(),p_row:x});}
export async function deleteCampaignArea(id:string){return rpc<boolean>('dispatchops_price_change_admin_delete_area',{p_key:await adminKey(),p_id:id});}

export async function exportPriceChangeExcel(campaigns:Campaign[],items:Item[],assignments:Assignment[],visits:Visit[],drivers:any[]=[],listTitle?:string,onProgress?:(p:ExportProgress)=>void){
  const wb=XLSX.utils.book_new();
  const driverMap=new Map(drivers.map(d=>[d.id,`${d.code||''} — ${d.name||''}`]));
  const campaignMap=new Map(campaigns.map(c=>[c.id,c.title]));
  const itemMap=new Map(items.map(i=>[i.id,i]));
  const assignmentMap=new Map(assignments.map(a=>[a.id,a]));
  const rows:any[]=[];
  const attachments:any[]=[];
  const safe=(x:string)=>x.replace(/[^a-z0-9._-]+/gi,'_').slice(0,80)||'attachment';
  const stem=safe((listTitle&&listTitle.trim())||`Price_Change_${new Date().toISOString().slice(0,10)}`);
  const excelFilename=`${stem}.xlsx`;
  const attachmentFolder=`${stem}_Attachments`;
  const zipFilename=`${stem}.zip`;
  const attachmentCache=new Map<string,string>();
  const extFor=(type:string,path:string)=>{const m=(type||'').toLowerCase().split('/')[1];if(m==='jpeg')return 'jpg';if(m&&/^[a-z0-9]+$/.test(m))return m;const e=path.split('.').pop()?.toLowerCase();return e&&/^[a-z0-9]+$/.test(e)?e:'bin'};
  const offlineRef=async(path:string,kind:'photo'|'signature')=>{
    if(!path)return '';
    if(attachmentCache.has(path))return attachmentCache.get(path)!;
    const url=await getEvidenceSignedUrl(path);
    if(!url) return '';
    const res=await fetch(url);
    if(!res.ok) throw new Error(`Could not download ${kind} attachment for offline Excel export`);
    const blob=await res.blob();
    const raw=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(blob)});
    const b64=raw.replace(/^data:[^,]*,/,'');
    const base=kind==='photo'?'Photo':'Signature';
    const filename=`${base}_${attachments.length+1}_${safe(path.split('/').pop()||kind)}.${extFor(blob.type,path)}`;
    attachments.push({filename,base64_data:b64});
    const rel=`${attachmentFolder}/${filename}`;
    attachmentCache.set(path,rel);
    return rel;
  };
  for(const v of visits){
    const lineItems=(v.price_change_visit_items||[]);
    const assignment=assignmentMap.get(v.assignment_id||'');
    const base={
      'Price Change List':campaignMap.get(v.campaign_id)||'',
      'Driver Code':drivers.find(d=>d.id===v.driver_id)?.code||v.driver_id,
      'Driver Name':drivers.find(d=>d.id===v.driver_id)?.name||'',
      'Date':v.visited_at?new Date(v.visited_at).toLocaleDateString():'',
      'Time':v.visited_at?new Date(v.visited_at).toLocaleTimeString():'',
      'Customer / Pharmacy':v.customer_name||'',
      'Location':v.location||'',
      'Pharmacist Name':v.pharmacist_name||'',
      'Telephone / Mobile':v.telephone||'',
      'Status':v.status||'',
      'Notes':v.notes||'',
      'Reference attachment':'',
      'Signature Link':'',
      'Assignment Location':assignment?.location||''
    };
    const photo=v.attachment_path?await offlineRef(v.attachment_path,'photo'):'';
    const sig=v.signature_path?await offlineRef(v.signature_path,'signature'):'';
    const makeRow=(vi:any)=>({...base,'Reference attachment':photo,'Signature Link':sig,'Item':itemMap.get(vi?.item_id)?.item_description||vi?.item_id||'','New Price':vi?itemMap.get(vi.item_id)?.new_public_price??itemMap.get(vi.item_id)?.new_pharmacy_price??'':'','Quantity':vi?.quantity??''});
    if(lineItems.length) lineItems.forEach(vi=>rows.push(makeRow(vi))); else rows.push(makeRow(null));
  }
  const headers=['Price Change List','Driver Code','Driver Name','Date','Time','Customer / Pharmacy','Location','Pharmacist Name','Telephone / Mobile','Item','New Price','Quantity','Status','Notes','Reference attachment','Signature Link','Assignment Location'];
  const ws=XLSX.utils.json_to_sheet(rows,{header:headers});
  ws['!cols']=headers.map(h=>({wch:Math.max(12,Math.min(34,h.length+4))}));
  const photoCol=headers.indexOf('Reference attachment'), sigCol=headers.indexOf('Signature Link');
  for(let r=2;r<=rows.length+1;r++){
    const pc=photoCol>=0?XLSX.utils.encode_cell({r:r-1,c:photoCol}):'';
    const sc=sigCol>=0?XLSX.utils.encode_cell({r:r-1,c:sigCol}):'';
    if(pc&&ws[pc]?.v) ws[pc].l={Target:`${String(ws[pc].v)}`,Tooltip:'Open offline pharmacy photo'};
    if(sc&&ws[sc]?.v) ws[sc].l={Target:`${String(ws[sc].v)}`,Tooltip:'Open offline signature / stamp'};
    if(pc&&ws[pc]?.v) ws[pc].v='Reference attachment';
    if(sc&&ws[sc]?.v) ws[sc].v='Signature';
  }
  XLSX.utils.book_append_sheet(wb,ws,'Price Change Details');
  onProgress?.({pct:1,status:'preparing',message:'Preparing Excel workbook…'});
  const excelBase64=XLSX.write(wb,{bookType:'xlsx',type:'base64',compression:true});
  const result=await saveZipBundle(zipFilename,excelFilename,excelBase64,attachments,attachmentFolder,onProgress);
  return result;
}

export async function importPriceChangeWorkbook(file:File){
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows:any[]=XLSX.utils.sheet_to_json(ws,{defval:''});
  if(!rows.length) throw new Error('The selected Excel file has no data rows.');
  const norm=(v:any)=>String(v??'').trim();
  const pick=(r:any,names:string[])=>{for(const n of names){if(r[n]!==undefined&&norm(r[n])!=='')return r[n]}return ''};
  const number=(v:any)=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:null};
  const campaign=await saveCampaign({title:file.name.replace(/\.[^.]+$/,'')||'Imported Price Change List',document_date:'',effective_date:'',decree_numbers:'',notes:'',status:'OPEN'});
  let line=1;
  for(const r of rows){
    const desc=norm(pick(r,['ITEM','ITEM NAME','ITEM DESCRIPTION','Item','Item Name','Item Description','Description','item_description']));
    const code=norm(pick(r,['Item No.','Item No','Item Code','item_code']));
    if(!desc&&!code) continue;
    const price=number(pick(r,['NEW PRICE','New Price','NEW PUBLIC PRICE','New Public Price','NEW PHARMACY PRICE','New Pharmacy Price','new_public_price','new_pharmacy_price']));
    const suppliedLine=number(pick(r,['Line No','#','LINE','line_no']));
    await saveItem({campaign_id:campaign.id!,line_no:suppliedLine&&suppliedLine>0?suppliedLine:line,item_code:code,item_description:desc||code,old_pharmacy_price:null,old_public_price:null,new_pharmacy_price:price,new_public_price:price,default_pack_qty:null,active:true});
    line++;
  }
  return campaign;
}
