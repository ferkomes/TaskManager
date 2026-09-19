import type { Env,EventRecord } from '../types';
import type { DbStore } from './dbStore';
import type { AIEngine } from '../ai/engine';
import { GmailAdapter } from '../adapters/gmail';
import { GoogleCalendarAdapter } from '../adapters/calendar';
import { LodgifyAdapter } from '../adapters/lodgify';
import { CleaningCalendarAdapter } from '../adapters/cleaning';
import { ingestEvent } from './intake';
export function hasAI(env:Env){return !!(env.AI_PROVIDER==='openai'?env.OPENAI_API_KEY:env.GEMINI_API_KEY);}
export async function enqueueEvents(db:D1Database,events:EventRecord[]) {
  let added=0;
  for(const event of events){const now=new Date().toISOString();const row=await db.prepare("INSERT OR IGNORE INTO sync_queue (event_id,payload,status,created_at,updated_at) VALUES (?,?,'pending',?,?) RETURNING event_id").bind(event.id,JSON.stringify(event),now,now).first();if(row)added++;}
  return added;
}
export async function syncSources(env:Env,_store:DbStore,_ai:AIEngine) {
  if(!hasAI(env))throw new Error('Előbb add meg a kiválasztott AI API-kulcsát.');
  const now=Date.now(),lease=String(now+180000);
  const acquired=await env.DB.prepare("INSERT INTO system_settings (key,value) VALUES ('sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(system_settings.value AS INTEGER)<? RETURNING value").bind(lease,now).first();
  if(!acquired)return [];
  const google={clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,refreshToken:env.GOOGLE_REFRESH_TOKEN};
  const adapters=[];
  if(env.GOOGLE_REFRESH_TOKEN)adapters.push(new GmailAdapter(google),new GoogleCalendarAdapter(google));
  if(env.LODGIFY_API_KEY)adapters.push(new LodgifyAdapter({apiKey:env.LODGIFY_API_KEY}));
  if(env.CLEANING_CALENDAR_ICS_URL)adapters.push(new CleaningCalendarAdapter({icsUrl:env.CLEANING_CALENDAR_ICS_URL}));
  const results=[];
  try{
    for(const adapter of adapters){
      try{const events=await adapter.fetchNewEvents();const added=await enqueueEvents(env.DB,events);results.push({source:adapter.sourceName,count:events.length,added,success:true});}
      catch(e){results.push({source:adapter.sourceName,count:0,added:0,success:false,message:(e as Error).message});}
    }
    await env.DB.prepare("INSERT INTO system_settings (key,value) VALUES ('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({at:new Date().toISOString(),results})).run();
    if(results.length&&results.every(r=>r.success))await env.DB.prepare("INSERT INTO system_settings (key,value) VALUES ('initial_sync_complete','true') ON CONFLICT(key) DO NOTHING").run();
    return results;
  }finally{await env.DB.prepare("DELETE FROM system_settings WHERE key='sync_lock' AND value=?").bind(lease).run();}
}
export async function processNext(env:Env,store:DbStore,ai:AIEngine) {
  if(!hasAI(env))return false;
  const now=Date.now();
  await env.DB.prepare("UPDATE sync_queue SET status='failed',error='Az elemzés háromszor megszakadt. Újrapróbálás szükséges.' WHERE status='processing' AND lease_until<? AND attempts>=3").bind(now).run();
  const job=await env.DB.prepare("UPDATE sync_queue SET status='processing',lease_until=?,attempts=attempts+1,updated_at=? WHERE event_id=(SELECT event_id FROM sync_queue WHERE (status='pending' OR (status='processing' AND lease_until<?)) AND attempts<3 ORDER BY created_at LIMIT 1) RETURNING event_id,payload,attempts").bind(now+60000,new Date().toISOString(),now).first<{event_id:string;payload:string;attempts:number}>();
  if(!job)return false;
  try{
    await ingestEvent(store,ai,JSON.parse(job.payload));
    await env.DB.prepare("UPDATE sync_queue SET status='done',error=NULL,updated_at=? WHERE event_id=?").bind(new Date().toISOString(),job.event_id).run();
  }catch(e){
    const msg = (e as Error)?.message || 'Az elemzés nem sikerült.';
    const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
    if (isRateLimit) {
      // Delay retry by 20s without burning total attempts
      await env.DB.prepare("UPDATE sync_queue SET status='pending',attempts=MAX(0, attempts-1),lease_until=?,error='Gemini percenkénti korlát elérve (15 kérés/perc). Kis türelmet, automatikusan folytatódik…',updated_at=? WHERE event_id=?")
        .bind(now + 20000, new Date().toISOString(), job.event_id).run();
    } else {
      await env.DB.prepare("UPDATE sync_queue SET status=?,error=?,updated_at=? WHERE event_id=?")
        .bind(job.attempts>=3?'failed':'pending',msg,new Date().toISOString(),job.event_id).run();
    }
  }
  return true;
}
export async function processBatch(env:Env,store:DbStore,ai:AIEngine,limit=5) {
  let count=0;
  for(let i=0;i<limit;i++){
    const ok = await processNext(env,store,ai);
    if(ok) count++; else break;
  }
  return count;
}
export async function syncStatus(env:Env){
  const counts=await env.DB.prepare("SELECT status,COUNT(*) AS count FROM sync_queue GROUP BY status").all<{status:string;count:number}>();
  const states=Object.fromEntries(counts.results.map(r=>[r.status,r.count]));
  const last=await env.DB.prepare("SELECT value FROM system_settings WHERE key='last_sync'").first<{value:string}>();
  const initial=await env.DB.prepare("SELECT value FROM system_settings WHERE key='initial_sync_complete'").first();
  const errorRows=await env.DB.prepare("SELECT DISTINCT error FROM sync_queue WHERE status='failed' AND error IS NOT NULL LIMIT 5").all<{error:string}>();
  const errors = errorRows.results.map(r => r.error);
  return {pending:states.pending||0,processing:states.processing||0,done:states.done||0,failed:states.failed||0,initialComplete:!!initial,last:last?JSON.parse(last.value):null,errors};
}
