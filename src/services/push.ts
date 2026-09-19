import webpush from 'web-push';
import type { Env, PushSubscriptionRecord } from '../types';

export function validEndpoint(endpoint: string) {
  try { const url = new URL(endpoint); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.notify.windows.com') || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com')); } catch { return false; }
}
export async function pushConfig(env: Env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return {publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY};
  if (env.ENVIRONMENT !== 'development') throw new Error('VAPID keys must be configured in production');
  const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key='demo_vapid'").first<{value:string}>();
  if (row) return JSON.parse(row.value) as {publicKey:string;privateKey:string};
  await env.DB.prepare("INSERT OR IGNORE INTO system_settings (key,value) VALUES ('demo_vapid',?)").bind(JSON.stringify(webpush.generateVAPIDKeys())).run();
  const saved = await env.DB.prepare("SELECT value FROM system_settings WHERE key='demo_vapid'").first<{value:string}>();
  return JSON.parse(saved!.value) as {publicKey:string;privateKey:string};
}
export async function sendPush(env: Env, message: {title:string;body:string}) {
  const {results} = await env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubscriptionRecord>();
  if (!results.length) return {sent:0,failed:0};
  const keys = await pushConfig(env);
  let sent = 0, failed = 0;
  for (const sub of results) {
    if (!validEndpoint(sub.endpoint)) { failed++; continue; }
    try {
      const request = webpush.generateRequestDetails({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({...message,url:'/'}),{TTL:3600,vapidDetails:{...keys,subject:env.VAPID_SUBJECT || 'mailto:admin@mybrain.internal'}});
      const response = await fetch(request.endpoint,{method:'POST',headers:request.headers as Record<string,string>,body:new Uint8Array(request.body!),redirect:'error',signal:AbortSignal.timeout(10000)});
      if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(sub.id).run();
      if (response.ok) sent++; else failed++;
    } catch { failed++; }
  }
  return {sent,failed};
}
