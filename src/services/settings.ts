import type { Env } from '../types';
export const settingKeys = ['AI_PROVIDER','OPENAI_API_KEY','OPENAI_MODEL','GEMINI_API_KEY','GEMINI_MODEL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','LODGIFY_API_KEY','CLEANING_CALENDAR_ICS_URL','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','ZOOFY_API_KEY','ZOOFY_AUTO_ACCEPT_ENABLED','ZOOFY_MIN_PRICE','ZOOFY_MAX_DISTANCE_KM'] as const;
async function encryptionKey(secret: string) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)), 'AES-GCM',false,['encrypt','decrypt']);
}
export async function readSettings(env: Env): Promise<Record<string,string>> {
  if (!env.APP_SECRET || !env.DB) return {};
  const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key='encrypted_credentials'").first<{value:string}>();
  if (!row) return {};
  const data = JSON.parse(row.value);
  const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(data.iv)},await encryptionKey(env.APP_SECRET),new Uint8Array(data.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
export async function saveSettings(env: Env, patch: Record<string,string>) {
  if (!env.APP_SECRET || env.APP_SECRET.length < 32) throw new Error('Set an APP_SECRET of at least 32 characters before saving credentials.');
  const settings = {...await readSettings(env),...patch};
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env.APP_SECRET),new TextEncoder().encode(JSON.stringify(settings)));
  await env.DB.prepare("INSERT INTO system_settings (key,value) VALUES ('encrypted_credentials',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").bind(JSON.stringify({iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(ciphertext))})).run();
}
