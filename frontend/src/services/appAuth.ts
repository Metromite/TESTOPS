import { getPrimarySupabaseClient } from "../lib/supabase";

export type AppRole = "admin" | "user" | "dispatcher";
export interface AppUser { id:string; username:string; role:AppRole; active:boolean; created_at?:string; updated_at?:string }

const db=()=>getPrimarySupabaseClient();

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_KEY = "dispatchops-login-locks-v1";
const KNOWN_ADMINS_KEY = "dispatchops-known-admins-v1";

function readLoginLocks(): Record<string,{attempts:number;locked:boolean}> {
  try { return JSON.parse(localStorage.getItem(LOGIN_LOCK_KEY) || "{}"); } catch { return {}; }
}
function writeLoginLocks(v: Record<string,{attempts:number;locked:boolean}>) { try { localStorage.setItem(LOGIN_LOCK_KEY, JSON.stringify(v)); } catch {} }
function knownAdmins(): string[] {
  try { const a=JSON.parse(localStorage.getItem(KNOWN_ADMINS_KEY)||"[]"); return Array.isArray(a)?a.map(String):[]; } catch { return []; }
}
function rememberAdmin(username:string) {
  const next=[...new Set(["admin",...knownAdmins(),username.toLowerCase()])];
  try { localStorage.setItem(KNOWN_ADMINS_KEY, JSON.stringify(next)); } catch {}
}
function isKnownAdmin(username:string) { return knownAdmins().includes(username.toLowerCase()); }
function clearLoginLock(username:string) { const x=readLoginLocks(); delete x[username.toLowerCase()]; writeLoginLocks(x); }

export async function loginAppUser(username:string,password:string):Promise<AppUser>{
  const clean=String(username||"").trim();
  const pass=String(password||"");
  if(!clean||!pass) throw new Error("Username and password are required.");
  const key=clean.toLowerCase();
  const locks=readLoginLocks();
  const state=locks[key];
  // Local guard protects ordinary login accounts from repeated brute-force attempts.
  // Known admin accounts are intentionally exempt so the administrator can always enter.
  if(state?.locked && !isKnownAdmin(clean)) throw new Error("This login is locked after 5 failed attempts. Ask an administrator to unlock it.");
  try {
    let {data,error}=await db().rpc("dispatchops_auth_login",{p_username:clean,p_password:pass});
    if(error && clean.toLowerCase()==="admin"){
      const boot=await db().rpc("dispatchops_auth_bootstrap",{p_username:clean,p_password:pass,p_role:"admin"});
      if(!boot.error){
        await db().rpc("dispatchops_admin_user_save",{p_admin_username:clean,p_admin_password:pass,p_id:null,p_username:"user",p_password:"user12345",p_role:"user",p_active:true});
        ({data,error}=await db().rpc("dispatchops_auth_login",{p_username:clean,p_password:pass}));
      }
    }
    if(error) throw new Error(error.message);
    if(!data?.ok) throw new Error("Invalid username or password.");
    clearLoginLock(clean);
    const account={id:String(data.id),username:String(data.username),role:(data.role||"user") as AppRole,active:true};
    if(account.role==="admin") rememberAdmin(account.username);
    return account;
  } catch(e:any) {
    if(!isKnownAdmin(clean)) {
      const current=readLoginLocks();
      const attempts=(current[key]?.attempts||0)+1;
      current[key]={attempts,locked:attempts>=LOGIN_MAX_ATTEMPTS};
      writeLoginLocks(current);
      if(attempts>=LOGIN_MAX_ATTEMPTS) throw new Error("This login is locked after 5 failed attempts. Ask an administrator to unlock it.");
    }
    throw new Error(e?.message||"Invalid username or password.");
  }
}

export async function verifyAdminCredentials(username:string,password:string):Promise<boolean>{
  const {data,error}=await db().rpc("dispatchops_admin_verify",{p_admin_username:username,p_admin_password:password});
  if(error) throw new Error(error.message);
  return Boolean(data);
}

export async function listAppUsers(adminUsername:string,adminPassword:string):Promise<AppUser[]>{
  const {data,error}=await db().rpc("dispatchops_admin_user_list",{p_admin_username:adminUsername,p_admin_password:adminPassword});
  if(error) throw new Error(error.message);
  return (Array.isArray(data)?data:[]) as AppUser[];
}

export async function saveAppUser(input:{adminUsername:string;adminPassword:string;id?:string;username:string;password?:string;role:AppRole;active:boolean}):Promise<AppUser>{
  const {data,error}=await db().rpc("dispatchops_admin_user_save",{
    p_admin_username:input.adminUsername,p_admin_password:input.adminPassword,p_id:input.id||null,
    p_username:input.username,p_password:input.password||null,p_role:input.role,p_active:input.active,
  });
  if(error) throw new Error(error.message);
  return data as AppUser;
}

export async function deleteAppUser(adminUsername:string,adminPassword:string,id:string):Promise<boolean>{
  const {data,error}=await db().rpc("dispatchops_admin_user_delete",{p_admin_username:adminUsername,p_admin_password:adminPassword,p_id:id});
  if(error) throw new Error(error.message);
  return Boolean(data);
}

export async function unlockAppUser(adminUsername:string,adminPassword:string,userId:string,username:string): Promise<void> {
  clearLoginLock(username);
  try {
    const {error}=await db().rpc("dispatchops_admin_unlock_user",{p_admin_username:adminUsername,p_admin_password:adminPassword,p_id:userId});
    if(error && !/function .* does not exist|Could not find the function/i.test(error.message)) throw new Error(error.message);
  } catch(e:any) {
    if(!/function .* does not exist|Could not find the function/i.test(String(e?.message||""))) throw e;
  }
}
export function unlockLocalLogin(username:string): void { clearLoginLock(String(username||"")); }
