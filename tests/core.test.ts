import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AIEngine } from '../src/ai/engine';
import { DbStore } from '../src/services/dbStore';
import { ingestEvent } from '../src/services/intake';
import { UrgentCorrelatorService } from '../src/services/urgentCorrelator';
import { createMockEvents, createCallerContacts } from '../src/adapters/mockData';
import { saveSettings, readSettings } from '../src/services/settings';
import { pushConfig, validEndpoint } from '../src/services/push';
import worker from '../src/worker';
import type { Env } from '../src/types';

function database(): D1Database {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync('schema.sql','utf8'));
  const prepare=(sql:string)=>{
    let params:any[]=[];
    const statement={bind(...values:any[]){params=values;return statement;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params),success:true};},async run(){db.prepare(sql).run(...params);return {success:true};}};
    return statement;
  };
  return {prepare,async batch(statements:any[]){db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
}
const ai=new AIEngine({});
test('required demonstration scenarios produce useful drafts',async()=>{
  const [tom,laurent,tractor]=await Promise.all(createMockEvents().slice(0,3).map(e=>ai.analyzeEvent(e)));
  assert.match(tom.title,/premium configuration/); assert.equal(tom.priority,'HIGH');assert.match(tom.draft_reply,/cast-iron/);
  assert.match(laurent.next_step,/check-in PDF/);assert.equal(laurent.priority,'HIGH');assert.doesNotMatch(laurent.draft_reply,/#4829/);
  assert.match(tractor.draft_reply,/Tisztelt/);assert.ok(tractor.waiting_for);assert.doesNotMatch(tractor.draft_reply,/2-3 hetes/);
});
test('D1 seeding survives restart, updates preserve snooze and source linkage',async()=>{
  const db=database();const first=new DbStore(db);await Promise.all([first.init(ai),first.init(ai)]);
  assert.equal((await first.getTasks()).length,5);
  const tom=(await first.getTaskById('task_kamado_tom'))!;assert.equal(tom.events?.[0].id,'evt_kamado_tom');
  tom.snoozed_until='2030-01-01T10:00:00.000Z';tom.status='later';tom.draft_reply='Edited quotation';await first.saveTask(tom);
  await first.resolveWaitingItem('wait_1');
  const second=new DbStore(db);await second.init(ai);const restored=(await second.getTaskById(tom.id))!;
  assert.equal(restored.snoozed_until,tom.snoozed_until);assert.equal(restored.draft_reply,'Edited quotation');assert.equal(restored.events?.length,1);
  assert.equal((await second.getWaitingItems()).find(w=>w.id==='wait_1')?.status,'resolved');
  await second.seedDemo();assert.equal((await second.getTasks()).length,5);assert.equal((await second.getTaskById(tom.id))?.status,'later');
});
test('duplicate deliveries and thread messages become one task; source text stays immutable',async()=>{
  const store=new DbStore(database(),false);await store.init(ai);
  const event={...createMockEvents()[0],id:'msg1',metadata:{threadId:'thread1'}};
  const [first,repeated]=await Promise.all([ingestEvent(store,ai,event),ingestEvent(store,ai,event)]);
  assert.equal(first?.id,repeated?.id);assert.equal((await store.getTasks()).length,1);
  const next=await ingestEvent(store,ai,{...event,id:'msg2',raw_content:'Kamado: updated quotation received.'});
  assert.equal(next?.id,first?.id);assert.equal((await store.getTaskById(first!.id))?.events?.length,2);
  await store.saveEvent({...event,raw_content:'Overwrite attempt'});assert.equal((await store.getEvents()).find(e=>e.id==='msg1')?.raw_content,event.raw_content);
  await ingestEvent(store,ai,{...event,id:'msg3',metadata:{threadId:'other-thread'}});assert.equal((await store.getTasks()).length,2);
});
test('informational messages stay in events without creating an actionable task',async()=>{
  const store=new DbStore(database(),false);await store.init(ai);
  assert.equal(await ingestEvent(store,ai,createMockEvents()[3]),undefined);assert.equal((await store.getEvents()).length,1);assert.equal((await store.getTasks()).length,0);
});
test('night guest correlation accepts normalized full numbers and rejects suffix impostors',()=>{
  const service=new UrgentCorrelatorService();const night=new Date();night.setHours(23,30);
  const known=service.evaluateCaller('0034 612 345 678',createCallerContacts(),{customTimestamp:night,callCountInLast15Min:2});
  assert.equal(known.isUrgent,true);assert.equal(known.matchedContact?.guest_name,'Laurent Mercier');
  for(const number of ['', '678', '+99612345678'])assert.equal(service.evaluateCaller(number,createCallerContacts(),{customTimestamp:night,callCountInLast15Min:3}).matchedContact,undefined);
  assert.equal(service.evaluateCaller('+34612345678',createCallerContacts(),{customTimestamp:night,callCountInLast15Min:1}).isUrgent,false);
});
test('credentials are encrypted and push key configuration is stable',async()=>{
  const env={DB:database(),APP_SECRET:'test-secret-with-at-least-32-characters',ENVIRONMENT:'development'} as Env;
  await saveSettings(env,{OPENAI_API_KEY:'example-sensitive-value'});const row=await env.DB.prepare("SELECT value FROM system_settings WHERE key='encrypted_credentials'").first<{value:string}>();
  assert.ok(!row?.value.includes('example-sensitive-value'));assert.equal((await readSettings(env)).OPENAI_API_KEY,'example-sensitive-value');
  assert.deepEqual(await pushConfig(env),await pushConfig(env));assert.equal(validEndpoint('https://127.0.0.1/internal'),false);assert.equal(validEndpoint('https://fcm.googleapis.com/fcm/send/example'),true);
});
test('API commander and search operate locally, validation rejects invalid input',async()=>{
  const env={DB:database(),ENVIRONMENT:'development'} as Env;
  const request=async(path:string,body?:unknown)=>worker.fetch(new Request(`http://localhost${path}`,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{} as ExecutionContext);
  let response=await request('/api/tasks');assert.equal(response.status,200);
  response=await request('/api/tasks/task_kamado_tom/commander',{action:'draft',draftEdit:'Reviewed locally'});assert.equal((await response.json() as any).task.draft_reply,'Reviewed locally');
  assert.equal((await request('/api/tasks/task_kamado_tom/status',{status:'broken'})).status,400);
  assert.equal((await request('/api/tasks/task_kamado_tom/commander',{action:'later',customTime:'bad date'})).status,400);
  assert.equal((await request('/api/events/manual',{type:'text',content:''})).status,400);
  assert.equal((await request('/api/urgent/check-caller',{phone_number:''})).status,400);
  response=await request('/api/search?q=What%20did%20Tom%20say%20about%20cast%20iron%20grates');const search=await response.json() as any;assert.equal(search.results[0].item.id,'task_kamado_tom');
  response=await request('/api/tasks/task_kamado_tom/commander',{action:'do_it'});assert.match((await response.json() as any).message,/locally/);
  response=await request('/api/webhooks/whatsapp',{});assert.equal(response.status,503);
});

test('compact memory retrieves relevant examples, caps context, and supports forgetting',async()=>{
  const {MemoryStore}=await import('../src/services/memory');const db=database();const memory=new MemoryStore(db);
  const id=await memory.save({topic:'Tom Kamado',instruction:'Short English replies',example:'Hi Tom, please confirm the quote.'});
  await memory.save({topic:'Általános',example:'Keep replies brief.'});await memory.save({topic:'Unrelated machine',example:'Do not use this unrelated example.'});
  const context=await memory.context(createMockEvents()[0]);assert.match(context,/Hi Tom/);assert.doesNotMatch(context,/unrelated example/);assert.ok(context.length<2800);
  assert.equal((await memory.list('Kamado')).length,1);await memory.remove(id);assert.doesNotMatch(await memory.context(createMockEvents()[0]),/Hi Tom/);
  for(let i=0;i<105;i++)await memory.save({topic:`Topic ${i}`,example:'Short example'});assert.equal((await memory.list()).length,100);
});
test('queue persists informational completion, deduplicates imports and retries failed analysis',async()=>{
  const {enqueueEvents,processNext,syncStatus}=await import('../src/services/sync');
  const db=database();const env={DB:db,ENVIRONMENT:'development',AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-key'} as Env;
  const store=new DbStore(db,false);await store.init(ai);let calls=0;
  const stub={analyzeEvent:async(event:any)=>{calls++;return ai.fallbackAnalysis(event);}} as AIEngine;
  assert.equal(await enqueueEvents(db,[createMockEvents()[3]]),1);await processNext(env,store,stub);
  assert.equal((await syncStatus(env)).done,1);assert.equal((await store.getTasks()).length,0);
  assert.equal(await enqueueEvents(db,[createMockEvents()[3]]),0);assert.equal(await processNext(env,store,stub),false);assert.equal(calls,1);
  await enqueueEvents(db,[createMockEvents()[0]]);const broken={analyzeEvent:async()=>{throw new Error('provider unavailable');}} as unknown as AIEngine;
  for(let i=0;i<3;i++)await processNext(env,store,broken);assert.equal((await syncStatus(env)).failed,1);assert.equal((await store.getTasks()).length,0);
});
test('Google consent uses read-only scopes, PKCE, one-use state and encrypted refresh token',async()=>{
  const {beginGoogle,finishGoogle,GOOGLE_SCOPES}=await import('../src/services/googleOAuth');
  const env={DB:database(),APP_SECRET:'test-secret-with-at-least-32-characters',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',APP_URL:'https://mybrain.example'} as Env;
  const start=await beginGoogle(env,'https://mybrain.example/api/auth/google/start');const consent=new URL(start.url);
  assert.equal(consent.searchParams.get('scope'),GOOGLE_SCOPES.join(' '));assert.equal(consent.searchParams.get('code_challenge_method'),'S256');assert.equal(consent.searchParams.get('access_type'),'offline');
  const callback=`https://mybrain.example/api/auth/google/callback?state=${start.state}&code=code`;
  await assert.rejects(()=>finishGoogle(env,callback,'wrong-cookie'));
  const original=globalThis.fetch;
  try{globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://oauth2.googleapis.com/token');assert.ok(String(init?.body).includes('code_verifier='));return new Response(JSON.stringify({refresh_token:'private-refresh-token',scope:GOOGLE_SCOPES.join(' ')}),{headers:{'Content-Type':'application/json'}});};
    await finishGoogle(env,callback,start.state);assert.equal((await readSettings(env)).GOOGLE_REFRESH_TOKEN,'private-refresh-token');await assert.rejects(()=>finishGoogle(env,callback,start.state));
  }finally{globalThis.fetch=original;}
});
test('production login protects APIs, persists HttpOnly session and rejects foreign origins',async()=>{
  const env={DB:database(),ENVIRONMENT:'production',APP_SECRET:'test-secret-with-at-least-32-characters'} as Env;
  const req=(path:string,options?:RequestInit)=>worker.fetch(new Request(`https://mybrain.example${path}`,options),env,{} as ExecutionContext);
  assert.equal((await req('/api/tasks')).status,401);assert.equal((await req('/api/auth/session')).status,200);
  const login=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:env.APP_SECRET})});assert.equal(login.status,200);
  const cookie=login.headers.get('Set-Cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);
  const auth={Cookie:cookie.split(';')[0]};assert.equal((await req('/api/tasks',{headers:auth})).status,200);
  assert.equal((await req('/api/memory',{method:'POST',headers:{...auth,Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({topic:'Bad',example:'Bad'})})).status,403);
  await req('/api/auth/logout',{method:'POST',headers:auth});assert.equal((await req('/api/tasks',{headers:auth})).status,401);
});
test('incoming messages never silently become demo tasks when the live provider fails',async()=>{
  const original=globalThis.fetch;try{globalThis.fetch=async()=>new Response('Unavailable',{status:503});const strictAI=new AIEngine({provider:'openai',openAiKey:'test-key',strict:true});await assert.rejects(()=>strictAI.analyzeEvent(createMockEvents()[0]),/OpenAI elemzés sikertelen/);}finally{globalThis.fetch=original;}
});
test('explicit draft learning stores only the edited owner example and can be disabled',async()=>{
  const env={DB:database(),ENVIRONMENT:'development'} as Env;
  const req=(path:string,body?:unknown)=>worker.fetch(new Request(`http://localhost${path}`,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{} as ExecutionContext);
  await req('/api/tasks');await req('/api/memory/preferences',{learnDrafts:true});
  await req('/api/tasks/task_kamado_tom/commander',{action:'draft',draftEdit:'Hi Tom, please send the price separately.'});
  const data=await (await req('/api/memory')).json() as any;assert.equal(data.examples.length,1);assert.match(data.examples[0].example,/send the price separately/);
  await req('/api/memory/preferences',{learnDrafts:false});await req('/api/tasks/task_airbnb_laurent/commander',{action:'draft',draftEdit:'Dear Laurent, confirmed.'});assert.equal(((await (await req('/api/memory')).json()) as any).examples.length,1);
});

test('Zoofy furniture leads >=150 EUR and <=15 km are auto-accepted with CRITICAL priority and Dutch draft reply', async () => {
  const { ZoofyAdapter } = await import('../src/adapters/zoofy');
  const adapter = new ZoofyAdapter({ minPrice: 150, maxDistanceKm: 15 });
  
  // Qualifying notification: Meubelmontage, €180, 8 km
  const qualifyingText = 'Nieuwe klus: Meubelmontage (IKEA PAX kast) in Amsterdam (8 km) - Verdien €180';
  const event = adapter.createEvent('Zoofy Pro', qualifyingText);
  
  assert.equal(event.source, 'zoofy');
  assert.equal(event.metadata?.isAutoAccepted, true);
  assert.equal(event.metadata?.price, 180);
  assert.equal(event.metadata?.distanceKm, 8);
  assert.match(event.metadata?.whatsappTemplate, /Beste, bedankt voor de opdracht via Zoofy/);
  
  const ai = new AIEngine();
  const analysis = ai.fallbackAnalysis(event);
  assert.equal(analysis.action_required, true);
  assert.equal(analysis.priority, 'CRITICAL');
  assert.equal(analysis.suggested_status, 'now');
  assert.equal(analysis.project_category, 'Klusjes / Zoofy');
  assert.match(analysis.draft_reply, /Beste, bedankt voor de opdracht via Zoofy/);
  assert.match(analysis.title, /AUTO-ELFOGADVA/);

  // Non-qualifying notification: Low price (€80)
  const lowPriceText = 'Nieuwe klus: Meubelmontage in Utrecht (5 km) - Verdien €80';
  const nonQualifyingEvent = adapter.createEvent('Zoofy Pro', lowPriceText);
  assert.equal(nonQualifyingEvent.metadata?.isAutoAccepted, false);
});
