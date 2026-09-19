import type { Env } from '../types';
import { hash } from './auth';
import { readSettings, saveSettings } from './settings';
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.readonly'];
export function googleRedirect(env:Env,requestUrl:string) {
  return `${(env.APP_URL || new URL(requestUrl).origin).replace(/\/$/,'')}/api/auth/google/callback`;
}
export async function beginGoogle(env:Env,requestUrl:string) {
  if(!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)throw new Error('Előbb add meg a Google OAuth Client ID és Client Secret értékeket a kapcsolódási beállításokban.');
  if(!env.APP_SECRET || env.APP_SECRET.length<32)throw new Error('A szerver titkosítási kulcsa nincs beállítva.');
  const state=crypto.randomUUID()+crypto.randomUUID();
  const verifier=crypto.randomUUID()+crypto.randomUUID();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  await env.DB.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO oauth_requests (state_hash,verifier,expires_at) VALUES (?,?,?)').bind(await hash(state),verifier,Date.now()+600000).run();
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:googleRedirect(env,requestUrl),response_type:'code',scope:GOOGLE_SCOPES.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return {url:url.toString(),state};
}
export async function finishGoogle(env:Env,requestUrl:string,stateCookie:string) {
  const url=new URL(requestUrl);const state=url.searchParams.get('state')||'';
  if(!state || !stateCookie || await hash(state)!==await hash(stateCookie))throw new Error('Az engedélykérés lejárt vagy nem ebből a böngészőből indult.');
  const row=await env.DB.prepare('DELETE FROM oauth_requests WHERE state_hash=? AND expires_at>? RETURNING verifier').bind(await hash(state),Date.now()).first<{verifier:string}>();
  if(!row)throw new Error('Az engedélykérés lejárt.');
  if(url.searchParams.has('error'))throw new Error('A Google-hozzáférést nem engedélyezted.');
  const code=url.searchParams.get('code');if(!code)throw new Error('Hiányzó Google-engedély.');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID||'',client_secret:env.GOOGLE_CLIENT_SECRET||'',code,code_verifier:row.verifier,redirect_uri:googleRedirect(env,requestUrl),grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('A Google nem fogadta el a kapcsolódást. Ellenőrizd a callback címet és a kliensadatokat.');
  const token=await response.json() as {refresh_token?:string;scope?:string};
  const granted=(token.scope||'').split(' ');
  if(!GOOGLE_SCOPES.every(scope=>granted.includes(scope)))throw new Error('A Gmail és a Naptár olvasási engedélye is szükséges. Próbáld újra, mindkettőt kijelölve.');
  if(!token.refresh_token)throw new Error('Nem érkezett tartós Google-engedély. Válaszd újra a csatlakoztatást.');
  await saveSettings(env,{GOOGLE_REFRESH_TOKEN:token.refresh_token,GOOGLE_GRANTED_SCOPES:token.scope!});
  await env.DB.prepare("DELETE FROM system_settings WHERE key='initial_sync_complete'").run();
}
export async function effectiveEnv(env:Env):Promise<Env>{return {...env,...await readSettings(env)};}
