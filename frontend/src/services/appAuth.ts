import { getPrimarySupabaseClient } from "../lib/supabase";

export type AppRole = "admin" | "user" | "dispatcher";
export interface AppUser { id:string; username:string; role:AppRole; active:boolean; created_at?:string; updated_at?:string }

const db=()=>getPrimarySupabaseClient();

export async function loginAppUser(username:string,password:string):Promise<AppUser>{
  const clean=String(username||"").trim();
  const pass=String(password||"");
  if(!clean||!pass) throw new Error("Username and password are required.");
  let {data,error}=await db().rpc("dispatchops_auth_login",{p_username:clean,p_password:pass});
  if(error && clean.toLowerCase()==="admin"){
    const boot=await db().rpc("dispatchops_auth_bootstrap",{p_username:clean,p_password:pass,p_role:"admin"});
    if(!boot.error){
      // Preserve the existing default user account on the first migration bootstrap.
      await db().rpc("dispatchops_admin_user_save",{p_admin_username:clean,p_admin_password:pass,p_id:null,p_username:"user",p_password:"user12345",p_role:"user",p_active:true});
      ({data,error}=await db().rpc("dispatchops_auth_login",{p_username:clean,p_password:pass}));
    }
  }
  if(error) throw new Error(error.message);
  if(!data?.ok) throw new Error("Invalid username or password.");
  return {id:String(data.id),username:String(data.username),role:(data.role||"user") as AppRole,active:true};
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
