import type { Env } from '../types';
export async function hash(value:string) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export function cookie(request:Request,name:string) {
  return (request.headers.get('Cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1) || '';
}
export async function authenticated(request:Request,env:Env) {
  if(env.ENVIRONMENT==='development')return true;
  if(!env.APP_SECRET)return false;
  const bearer=request.headers.get('Authorization');
  if(bearer && await hash(bearer)===await hash(`Bearer ${env.APP_SECRET}`))return true;
  const session=cookie(request,'mybrain_session');
  if(!session)return false;
  const row=await env.DB.prepare('SELECT expires_at FROM owner_sessions WHERE token_hash=?').bind(await hash(session)).first<{expires_at:number}>();
  return !!row && row.expires_at>Date.now();
}
export function sessionCookie(token:string,secure:boolean,maxAge=2592000) {
  return `mybrain_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
