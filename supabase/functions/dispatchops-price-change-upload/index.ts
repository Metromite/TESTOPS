import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey, authorization, x-client-info, content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const body=await req.json();
  const action=String(body.action||'upload');
  const secretKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const url=Deno.env.get('SUPABASE_URL')||'';
  if(!secretKey||!url)return json({error:'Server storage key is not configured'},500);
  const admin=createClient(url,secretKey);
  if(action==='sign_driver'){
    const token=String(body.token||'');
    const path=String(body.path||'').trim();
    if(!token||!path)return json({error:'Missing driver evidence credentials'},400);
    const tokenHash=await sha256(token);
    const {data:session,error:sessionError}=await admin.from('driver_portal_sessions').select('driver_id,expires_at').eq('token_hash',tokenHash).gt('expires_at',new Date().toISOString()).maybeSingle();
    if(sessionError||!session)return json({error:'Session expired'},401);
    const prefix=`${session.driver_id}/`;
    if(!path.startsWith(prefix))return json({error:'Evidence access denied'},403);
    const expires=Math.min(3600,Math.max(60,Number(body.expires_in)||900));
    const {data,error}=await admin.storage.from('price-change-evidence').createSignedUrl(path,expires);
    if(error)return json({error:error.message},404);
    return json({ok:true,signed_url:data?.signedUrl||''});
  }
  if(action==='sign'){
    const supplied=String(body.admin_key||'');
    const expected=await sha256('0000');
    if(supplied!==expected)return json({error:'Admin authorization failed'},401);
    const path=String(body.path||'').trim();
    if(!path)return json({error:'Missing file path'},400);
    const expires=Math.min(60*60*24*30,Math.max(60,Number(body.expires_in)||60*60*24*30));
    const {data,error}=await admin.storage.from('price-change-evidence').createSignedUrl(path,expires);
    if(error)return json({error:error.message},404);
    return json({ok:true,signed_url:data?.signedUrl||''});
  }
  const token=String(body.token||'');const filename=String(body.filename||'evidence');const contentType=String(body.content_type||'image/jpeg');const base64=String(body.base64||'');const kind=body.kind==='signature'?'signature':'photo';
  if(!token||!base64)return json({error:'Missing upload data'},400);
  if(base64.length>14_000_000)return json({error:'Evidence image is too large'},413);
  if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType))return json({error:'Only image evidence is allowed'},400);
  const tokenHash=await sha256(token);
  const {data:session,error:sessionError}=await admin.from('driver_portal_sessions').select('driver_id,expires_at').eq('token_hash',tokenHash).gt('expires_at',new Date().toISOString()).maybeSingle();
  if(sessionError||!session)return json({error:'Session expired'},401);
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const safe=filename.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-90);
  const path=`${session.driver_id}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}-${kind}-${safe}`;
  const {error}=await admin.storage.from('price-change-evidence').upload(path,bytes,{contentType,upsert:false,cacheControl:'31536000'});
  if(error)return json({error:error.message},500);
  return json({ok:true,path});
 }catch(e){return json({error:e instanceof Error?e.message:'Upload failed'},400)}
});
async function sha256(value:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
