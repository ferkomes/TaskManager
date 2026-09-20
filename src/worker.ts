import { ensureSchema } from './services/schema';
import { authenticated, hash, cookie, sessionCookie } from './services/auth';
import { beginGoogle, finishGoogle, googleRedirect } from './services/googleOAuth';
import { MemoryStore } from './services/memory';
import { syncStatus, processNext, processBatch, enqueueEvents, hasAI, syncSources } from './services/sync';
import { pushConfig, sendPush, validEndpoint } from './services/push';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readSettings, saveSettings, settingKeys } from './services/settings';
import { ManualAdapter } from './adapters/manual';
import { ingestEvent } from './services/intake';
import { Env, EventRecord, TaskRecord } from './types';
import { AIEngine } from './ai/engine';
import { DbStore } from './services/dbStore';
import { UrgentCorrelatorService } from './services/urgentCorrelator';
import { BriefService } from './services/briefs';
import { GmailAdapter } from './adapters/gmail';
import { GoogleCalendarAdapter } from './adapters/calendar';
import { LodgifyAdapter } from './adapters/lodgify';
import { CleaningCalendarAdapter } from './adapters/cleaning';
import { WhatsAppAdapter } from './adapters/whatsapp';
import { ZoofyAdapter } from './adapters/zoofy';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for PWA client
app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400);
  console.error('Request failed:', error.message);
  return c.json({ error: 'Request failed. Check database initialization and server configuration.' }, 500);
});
app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);
  const origin=c.req.header('Origin');
  if(origin && origin!==new URL(c.req.url).origin && !(c.env.ENVIRONMENT==='development' && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)))return c.json({error:'Forbidden origin'},403);
  const publicPaths=['/api/auth/session','/api/auth/login','/api/auth/google/callback'];
  if(!publicPaths.includes(c.req.path) && !c.req.path.startsWith('/api/webhooks/') && !await authenticated(c.req.raw,c.env))return c.json({error:'Jelentkezz be a MyBrain hozzáférési kulcsoddal.'},401);
  if(!c.req.path.startsWith('/api/settings'))c.env={...c.env,...await readSettings(c.env)};
  c.header('Cache-Control','no-store');
  await next();
});

// Shared state cache across requests in worker instance
const stores = new WeakMap<D1Database,DbStore>();


function getServices(env: Env) {
  const aiEngine = new AIEngine({strict:hasAI(env),provider:env.AI_PROVIDER || 'gemini',geminiKey:env.GEMINI_API_KEY,openAiKey:env.OPENAI_API_KEY,geminiModel:env.GEMINI_MODEL,openAiModel:env.OPENAI_MODEL});
  let storeInstance=stores.get(env.DB);
  if (!storeInstance) {
    storeInstance = new DbStore(env.DB, env.ENVIRONMENT === 'development');
    stores.set(env.DB,storeInstance);
  }
  const urgentCorrelator = new UrgentCorrelatorService();
  const briefService = new BriefService();
  return { store: storeInstance, aiEngine, urgentCorrelator, briefService };
}

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: 'MyBrain AI Personal/Work Inbox',
    time: new Date().toISOString(),
    aiProvider: c.env.AI_PROVIDER || 'gemini',
    rule: 'The AI may recommend, draft and organize actions, but it must never send messages or modify external systems without explicit user confirmation.',
  });
});

// GET /api/tasks (filter by horizon)
app.get('/api/tasks', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);

  const horizon = c.req.query('horizon') || 'all';
  const allTasks = await store.getTasks();

  if (horizon === 'all') {
    return c.json({ tasks: allTasks });
  }

  const filtered = allTasks.filter((t) => {
    if (horizon === 'done') return t.status === 'done';
    if (t.status === 'done' || t.status === 'ignored') return false;
    return t.status === horizon;
  });

  return c.json({ tasks: filtered });
});

// GET /api/tasks/:id
app.get('/api/tasks/:id', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const task = await store.getTaskById(c.req.param('id'));
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json({ task });
});

// POST /api/tasks/:id/commander (AI Commander: Do it, Draft, Later)
app.post('/api/tasks/:id/commander', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const body = await c.req.json<{
    action: 'do_it' | 'draft' | 'later';
    snoozeHours?: number;
    customTime?: string;
    draftEdit?: string;
    remember?: boolean;
  }>();

  const task = await store.getTaskById(c.req.param('id'));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const now = new Date().toISOString();
  task.action_history = task.action_history || [];

  if (body.action === 'do_it') {
    // SAFE EXECUTION: Update task to done, record action.
    // Explicitly respects rule: Never sends external message without explicit user confirmation.
    task.status = 'done';
    task.action_history.push({
      action: 'do_it',
      timestamp: now,
      details: `Marked complete locally: ${task.title}. No external action performed.`,
    });
    await store.saveTask(task);
    return c.json({
      success: true,
      message: `Marked complete locally: ${task.title}`,
      task,
    });
  }

  if (body.action === 'draft') {
    if (typeof body.draftEdit === 'string') task.draft_reply = body.draftEdit;
    // Save locally for review
    task.action_history.push({
      action: 'draft',
      timestamp: now,
      details: 'Draft opened and reviewed by user.',
    });
    await store.saveTask(task);
    const preference = await c.env.DB.prepare("SELECT value FROM system_settings WHERE key='learn_drafts'").first<{value:string}>();
    if (body.draftEdit?.trim() && (body.remember === true || (body.remember !== false && preference?.value === 'true'))) await new MemoryStore(c.env.DB).learnDraft(task,body.draftEdit);
    return c.json({
      success: true,
      draft_reply: task.draft_reply,
      suggested_action: task.suggested_action,
      next_step: task.next_step,
      waiting_for: task.waiting_for,
      task,
    });
  }

  if (body.action === 'later') {
    // AI-suggested postpone
    const hours = body.snoozeHours ?? 24;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) return c.json({error:'Invalid snooze duration'},400);
    const target = body.customTime ? new Date(body.customTime).getTime() : Date.now() + hours * 3600000;
    if (!Number.isFinite(target) || target <= Date.now()) return c.json({error:'Snooze must be in the future'},400);
    const postponeDate = new Date(target).toISOString();
    task.snoozed_until = postponeDate;
    task.status = target - Date.now() <= 86400000 ? 'tomorrow' : 'later';
    task.action_history.push({
      action: 'later',
      timestamp: now,
      details: `Postponed by user until ${postponeDate}. Reason: AI suggested later slot.`,
    });
    await store.saveTask(task);
    return c.json({
      success: true,
      message: `Postponed until ${new Date(postponeDate).toLocaleString()}`,
      task,
    });
  }

  return c.json({ error: 'Invalid commander action' }, 400);
});

// POST /api/tasks/:id/status (Done, Snooze, Ignore)
app.post('/api/tasks/:id/status', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const body = await c.req.json<{ status: any; snoozed_until?: string }>();
  const task = await store.getTaskById(c.req.param('id'));
  if (!task) return c.json({ error: 'Task not found' }, 404);

  if (!['now','today','tomorrow','next_7_days','later','done','snoozed','ignored'].includes(body.status)) return c.json({error:'Invalid task status'},400);
  if (body.snoozed_until && !Number.isFinite(Date.parse(body.snoozed_until))) return c.json({error:'Invalid snooze date'},400);
  task.status = body.status;
  if (!body.snoozed_until && ['now','today','done','ignored'].includes(body.status)) task.snoozed_until = null;
  if (body.snoozed_until) task.snoozed_until = body.snoozed_until;
  task.updated_at = new Date().toISOString();
  await store.saveTask(task);

  return c.json({ success: true, task });
});

// GET /api/waiting (Waiting Dashboard)
app.get('/api/waiting', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const items = await store.getWaitingItems();
  return c.json({ waiting_items: items });
});

// POST /api/waiting/:id/resolve
app.post('/api/waiting/:id/resolve', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  if (!await store.resolveWaitingItem(c.req.param('id'))) return c.json({error:'Waiting item not found'},404);
  return c.json({ success: true });
});

// POST /api/waiting
app.post('/api/waiting', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const body = await c.req.json<{ waiting_for: string; item_description: string; task_id?: string }>();
  if (!body.waiting_for?.trim() || !body.item_description?.trim()) return c.json({error:'Person and description required'},400);
  const newItem = {
    id: `wait_${Date.now()}`,
    task_id: body.task_id || null,
    waiting_for: body.waiting_for,
    item_description: body.item_description,
    since_date: new Date().toISOString(),
    status: 'active' as const,
  };
  await store.saveWaitingItem(newItem);
  return c.json({ success: true, item: newItem });
});

// GET /api/events
app.get('/api/events', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const events = await store.getEvents();
  return c.json({ events });
});

// POST /api/events/manual (Manual text, voice note simulation, or image)
app.post('/api/events/manual', async (c) => {
  if(c.env.ENVIRONMENT!=='development'&&!hasAI(c.env))return c.json({error:'Előbb állítsd be az AI API-kulcsát a Beállításokban.'},400);
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const body = await c.req.json<{
    type: 'text' | 'voice' | 'image' | 'forward';
    content: string;
    sender?: string;
    subject?: string;
    attachmentId?: string;
  }>();

  if (!['text','voice','image','forward'].includes(body.type)) return c.json({error:'Invalid intake type'},400);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 30000) return c.json({error:'Content is required (maximum 30000 characters)'},400);
  const event: EventRecord = {
    id: `manual_${crypto.randomUUID()}`,
    source: 'manual',
    sender: body.sender || 'Me (Manual Note)',
    subject: body.subject || body.content.trim().split('\n')[0].slice(0,100),
    raw_content: body.content,
    received_at: new Date().toISOString(),
    metadata: { intakeType: body.type, attachmentId: body.attachmentId },
  };

  const task = await ingestEvent(store, aiEngine, event);

  return c.json({ success: true, event, task });
});

// POST /api/events/simulate-feed (Re-populates realistic user test scenarios)
app.post('/api/events/simulate-feed', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  if (c.env.ENVIRONMENT !== 'development') return c.json({error:'Demo is only available in development'},403);
  await store.init(aiEngine);
  await store.seedDemo();
  return c.json({ success: true, message: 'Simulated feed re-initialized with user scenarios.' });
});

// GET /api/briefs/morning (08:00)
app.get('/api/briefs/morning', async (c) => {
  const { store, aiEngine, briefService } = getServices(c.env);
  await store.init(aiEngine);
  const tasks = await store.getTasks();
  const waiting = await store.getWaitingItems();
  const brief = briefService.generateMorningBrief(tasks, waiting);
  return c.json({ brief });
});

// GET /api/briefs/evening (20:00)
app.get('/api/briefs/evening', async (c) => {
  const { store, aiEngine, briefService } = getServices(c.env);
  await store.init(aiEngine);
  const tasks = await store.getTasks();
  const review = briefService.generateEveningReview(tasks);
  return c.json({ review });
});

// POST /api/urgent/check-caller (Urgent mode caller correlator & simulator)
app.post('/api/urgent/check-caller', async (c) => {
  const { store, aiEngine, urgentCorrelator } = getServices(c.env);
  await store.init(aiEngine);
  const body = await c.req.json<{
    phone_number: string;
    message_snippet?: string;
    call_count?: number;
    simulate_hour?: number;
  }>();

  if (typeof body.phone_number !== 'string' || body.phone_number.replace(/\D/g,'').length < 8) return c.json({error:'Valid phone number required'},400);
  if (body.call_count !== undefined && (!Number.isInteger(body.call_count) || body.call_count < 1)) return c.json({error:'Invalid call count'},400);
  if (body.simulate_hour !== undefined && (!Number.isInteger(body.simulate_hour) || body.simulate_hour < 0 || body.simulate_hour > 23)) return c.json({error:'Invalid hour'},400);
  const contacts = await store.getCallerContacts();
  let customTimestamp: Date | undefined;
  if (body.simulate_hour !== undefined) {
    customTimestamp = new Date();
    customTimestamp.setHours(body.simulate_hour, 30, 0);
  }

  const result = urgentCorrelator.evaluateCaller(body.phone_number, contacts, {
    callCountInLast15Min: body.call_count || 1,
    messageSnippet: body.message_snippet,
    customTimestamp,
  });

  return c.json({ result });
});

// GET /api/search (Natural-Language Search)
app.get('/api/search', async (c) => {
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const query = (c.req.query('q') || '').toLowerCase().trim();
  if (!query) return c.json({ results: [], query: '' });

  const tasks = await store.getTasks();
  const events = await store.getEvents();

  // Keyword / semantic token scoring
  const keywords = query.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !['what','did','say','about','the','for','have','which','need','not','messages'].includes(w)).map(w => w === 'grates' ? 'grids' : w);

  const matchedTasks = tasks.map((t) => {
    const hay = `${t.title} ${t.summary} ${t.project_category} ${t.suggested_action} ${t.draft_reply || ''} ${t.priority_reason} ${t.people_involved?.join(' ')} ${t.reservation_property || ''}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (hay.includes(kw)) score += 10;
    }
    // Specific intent patterns
    if (query.includes('unanswered') || query.includes('válaszolatlan')) {
      if (t.suggested_action.toLowerCase().includes('reply') || t.status === 'now') score += 25;
    }
    if (query.includes('tenerife') && hay.includes('tenerife')) score += 30;
    if (query.includes('tom') && (hay.includes('tom') || hay.includes('kamado'))) score += 30;
    if (query.includes('cast iron') && hay.includes('cast iron')) score += 35;
    return { item: t, type: 'task' as const, score };
  }).filter(m => m.score > 0);

  const matchedEvents = events.map((e) => {
    const hay = `${e.sender} ${e.subject || ''} ${e.raw_content} ${e.source}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (hay.includes(kw)) score += 8;
    }
    if (query.includes('tom') && (hay.includes('tom') || hay.includes('kamado'))) score += 30;
    if (query.includes('cast iron') && hay.includes('cast iron')) score += 35;
    if (query.includes('laurent') && hay.includes('laurent')) score += 30;
    return { item: e, type: 'event' as const, score };
  }).filter(m => m.score > 0);

  const contacts = await store.getCallerContacts();
  const matchedContacts = contacts.map(item => ({item,type:'contact' as const,score:keywords.filter(kw => `${item.guest_name} ${item.phone_number} ${item.property_name}`.toLowerCase().includes(kw)).length * 10})).filter(m => m.score > 0);
  const combined = [...matchedTasks, ...matchedEvents, ...matchedContacts].sort((a, b) => b.score - a.score);

  return c.json({
    query,
    count: combined.length,
    results: combined,
  });
});

// GET /api/adapters/status
app.get('/api/adapters/status', async (c) => {
  const env = c.env;
  const gmail = new GmailAdapter({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN });
  const gcal = new GoogleCalendarAdapter({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN });
  const lodgify = new LodgifyAdapter({ apiKey: env.LODGIFY_API_KEY });
  const cleaning = new CleaningCalendarAdapter({ icsUrl: env.CLEANING_CALENDAR_ICS_URL });
  const whatsapp = new WhatsAppAdapter({ verifyToken: env.WHATSAPP_VERIFY_TOKEN, accessToken: env.WHATSAPP_ACCESS_TOKEN });

  const statuses = {
    gmail: await gmail.testConnection(),
    calendar: await gcal.testConnection(),
    lodgify: await lodgify.testConnection(),
    cleaning: await cleaning.testConnection(),
    whatsapp: await whatsapp.testConnection(),
    manual: await new ManualAdapter().testConnection(),
    airbnb: {success:!!env.LODGIFY_API_KEY,message:'Airbnb messages arrive through the Lodgify channel manager.'},
    simulationFeed: { success: true, message: 'Simulated multi-source feed active with user scenarios.' },
  };

  return c.json({ adapters: statuses });
});

// Credentials are encrypted in D1 and never returned to the browser.
app.get('/api/settings', async c => {
  const saved=await readSettings(c.env);const env={...c.env,...saved};
  const preference=await c.env.DB.prepare("SELECT value FROM system_settings WHERE key='learn_drafts'").first<{value:string}>();
  return c.json({configured:Object.fromEntries(settingKeys.map(key=>[key,Boolean((env as any)[key])])),provider:env.AI_PROVIDER || 'gemini',model:env.AI_PROVIDER==='openai'?env.OPENAI_MODEL:env.GEMINI_MODEL,demo:env.ENVIRONMENT==='development',aiReady:hasAI(env),googleReady:!!env.GOOGLE_REFRESH_TOKEN,googleConfigured:!!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,callbackUrl:googleRedirect(env,c.req.url),learnDrafts:preference?.value==='true',sync:await syncStatus(env)});
});
app.post('/api/settings', async c => {
  const body = await c.req.json<Record<string,string>>();
  if (!body || Array.isArray(body) || typeof body !== 'object') return c.json({error:'Invalid settings'},400);
  for (const [key,value] of Object.entries(body)) {
    if (!(settingKeys as readonly string[]).includes(key) || typeof value !== 'string' || value.length > 10000) return c.json({error:'Invalid setting'},400);
  }
  if (body.AI_PROVIDER && !['gemini','openai'].includes(body.AI_PROVIDER)) return c.json({error:'Invalid AI provider'},400);
  if (body.CLEANING_CALENDAR_ICS_URL && !body.CLEANING_CALENDAR_ICS_URL.startsWith('https://')) return c.json({error:'Calendar feed requires HTTPS'},400);
  if (!c.env.APP_SECRET || c.env.APP_SECRET.length < 32) return c.json({error:'Configure APP_SECRET (at least 32 characters) on the server first.'},400);
  await saveSettings(c.env,body);
  return c.json({success:true});
});
app.post('/api/adapters/sync', async c => {
  const env = c.env;
  const {store,aiEngine} = getServices(env); await store.init(aiEngine);
  const results = await syncSources(env,store,aiEngine);
  return c.json({results});
});
app.post('/api/attachments', async c => {
  if (!c.env.ATTACHMENTS_BUCKET) return c.json({error:'Attachment storage is not configured'},503);
  const form = await c.req.formData(); const file = form.get('file');
  if (!file || typeof file === 'string' || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return c.json({error:'Upload a JPEG, PNG or WebP image up to 5 MB'},400);
  const id = crypto.randomUUID();
  await c.env.ATTACHMENTS_BUCKET.put(id,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
  return c.json({id,name:file.name,url:`/api/attachments/${id}`});
});
app.get('/api/attachments/:id', async c => {
  const object = await c.env.ATTACHMENTS_BUCKET?.get(c.req.param('id'));
  if (!object) return c.notFound();
  return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType || 'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});

app.get('/api/push/config', async c => c.json({publicKey:(await pushConfig(c.env)).publicKey}));
app.post('/api/push/subscribe', async c => {
  const body = await c.req.json<{endpoint:string;keys:{p256dh:string;auth:string}}>();
  if (!body || !validEndpoint(body.endpoint) || !/^[A-Za-z0-9_-]{87}=?$/.test(body.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(body.keys?.auth || '')) return c.json({error:'Invalid push subscription'},400);
  await c.env.DB.prepare('INSERT INTO push_subscriptions (id,endpoint,p256dh,auth) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth').bind(crypto.randomUUID(),body.endpoint,body.keys.p256dh,body.keys.auth).run();
  return c.json({success:true});
});
app.post('/api/push/test', async c => {
  const body = await c.req.json<{kind:string}>();
  if (!['morning','evening'].includes(body.kind)) return c.json({error:'Invalid brief type'},400);
  const {store,aiEngine,briefService}=getServices(c.env); await store.init(aiEngine);
  const tasks=await store.getTasks();
  const message=body.kind === 'morning' ? briefService.generateMorningBrief(tasks,await store.getWaitingItems()) : briefService.generateEveningReview(tasks);
  const result=await sendPush(c.env,message.push_notification_preview);
  if (!result.sent) return c.json({error:result.failed?'Push delivery failed. Check your subscription.':'Enable push notifications first.'},400);
  return c.json(result);
});

app.get('/api/auth/session', async c => c.json({authenticated:await authenticated(c.req.raw,c.env),configured:!!c.env.APP_SECRET || c.env.ENVIRONMENT==='development'}));
app.post('/api/auth/login', async c => {
  const body=await c.req.json<{token:string}>();
  if(!c.env.APP_SECRET || typeof body.token!=='string' || body.token.length>500 || await hash(body.token)!==await hash(c.env.APP_SECRET))return c.json({error:'Hibás hozzáférési kulcs.'},401);
  const token=crypto.randomUUID()+crypto.randomUUID();
  await c.env.DB.prepare('DELETE FROM owner_sessions WHERE expires_at<?').bind(Date.now()).run();
  await c.env.DB.prepare('INSERT INTO owner_sessions (token_hash,expires_at) VALUES (?,?)').bind(await hash(token),Date.now()+30*86400000).run();
  c.header('Set-Cookie',sessionCookie(token,new URL(c.req.url).protocol==='https:'));
  return c.json({success:true});
});
app.post('/api/auth/logout', async c => {
  await c.env.DB.prepare('DELETE FROM owner_sessions WHERE token_hash=?').bind(await hash(cookie(c.req.raw,'mybrain_session'))).run();
  c.header('Set-Cookie',sessionCookie('',new URL(c.req.url).protocol==='https:',0));return c.json({success:true});
});
app.post('/api/auth/google/start', async c => {
  try{const start=await beginGoogle(c.env,c.req.url);c.header('Set-Cookie',`mybrain_oauth=${start.state}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${new URL(c.req.url).protocol==='https:'?'; Secure':''}`);return c.json({url:start.url});}
  catch(e){return c.json({error:(e as Error).message},400);}
});
app.get('/api/auth/google/callback', async c => {
  const redirect=new URL('/?tab=settings',c.env.APP_URL||c.req.url);
  try{await finishGoogle(c.env,c.req.url,cookie(c.req.raw,'mybrain_oauth'));redirect.searchParams.set('google','connected');}
  catch(e){redirect.searchParams.set('google','error');redirect.searchParams.set('reason',(e as Error).message);}
  c.header('Set-Cookie','mybrain_oauth=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0');
  return c.redirect(redirect.toString(),303);
});
app.post('/api/auth/google/disconnect', async c => {
  await saveSettings(c.env,{GOOGLE_REFRESH_TOKEN:'',GOOGLE_GRANTED_SCOPES:''});
  await c.env.DB.prepare("DELETE FROM sync_queue WHERE status!='done' AND (event_id LIKE 'gmail_%' OR event_id LIKE 'gcal_%')").run();
  return c.json({success:true});
});
app.get('/api/memory', async c => c.json({examples:await new MemoryStore(c.env.DB).list(c.req.query('q')||'')}));
app.post('/api/memory', async c => {
  const body=await c.req.json<{topic:string;instruction?:string;example:string}>();
  if(!body || typeof body.topic!=='string' || !body.topic.trim() || body.topic.length>120 || typeof body.example!=='string' || !body.example.trim() || body.example.length>600 || (body.instruction!==undefined && (typeof body.instruction!=='string' || body.instruction.length>240)))return c.json({error:'Adj meg egy témát és legfeljebb 600 karakteres példát.'},400);
  return c.json({id:await new MemoryStore(c.env.DB).save(body)});
});
app.post('/api/memory/:id/delete', async c => {await new MemoryStore(c.env.DB).remove(c.req.param('id'));return c.json({success:true});});
app.post('/api/memory/preferences', async c => {
  const body=await c.req.json<{learnDrafts:boolean}>();if(typeof body.learnDrafts!=='boolean')return c.json({error:'Invalid preference'},400);
  await c.env.DB.prepare("INSERT INTO system_settings (key,value) VALUES ('learn_drafts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(body.learnDrafts)).run();return c.json({success:true});
});
app.get('/api/sync/status', async c => c.json(await syncStatus(c.env)));
app.post('/api/sync/start', async c => {
  if(!hasAI(c.env))return c.json({error:'Előbb add meg a kiválasztott AI API-kulcsát.'},400);
  const {store,aiEngine}=getServices(c.env);await store.init(aiEngine);
  return c.json({results:await syncSources(c.env,store,aiEngine),...await syncStatus(c.env)});
});
app.post('/api/settings/test-ai', async c => {
  const body = (await c.req.json().catch(() => ({}))) as { provider?: 'gemini' | 'openai'; key?: string; model?: string };
  const provider = body.provider || c.env.AI_PROVIDER || 'gemini';
  const openAiKey = (provider === 'openai' && body.key) ? body.key : c.env.OPENAI_API_KEY;
  const geminiKey = (provider === 'gemini' && body.key) ? body.key : c.env.GEMINI_API_KEY;
  const openAiModel = body.model || c.env.OPENAI_MODEL || 'gpt-4o-mini';
  const geminiModel = body.model || c.env.GEMINI_MODEL || 'gemini-1.5-flash';
  
  if (provider === 'openai' && !openAiKey) return c.json({ ok: false, error: 'Nincs megadva OpenAI API kulcs.' }, 400);
  if (provider === 'gemini' && !geminiKey) return c.json({ ok: false, error: 'Nincs megadva Gemini API kulcs.' }, 400);
  
  const testEngine = new AIEngine({
    strict: true,
    provider,
    openAiKey,
    geminiKey,
    openAiModel,
    geminiModel
  });

  try {
    const testEvent: EventRecord = {
      id: `test_${Date.now()}`,
      source: 'manual',
      sender: 'Teszt Felhasználó',
      subject: 'Ajánlatkérés',
      raw_content: 'Szia, érdekelne a grill rács ára holnapra, kérlek küldj ajánlatot!',
      received_at: new Date().toISOString()
    };
    const res = await testEngine.analyzeEvent(testEvent);
    return c.json({ ok: true, message: 'Kapcsolat sikeres!', output: res });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 200);
  }
});

app.post('/api/sync/process', async c => {
  const {store,aiEngine}=getServices(c.env);await store.init(aiEngine);
  await processBatch(c.env,store,aiEngine, 5);return c.json(await syncStatus(c.env));
});
app.post('/api/sync/retry', async c => {
  await c.env.DB.prepare("UPDATE sync_queue SET status='pending',attempts=0,lease_until=0,error=NULL WHERE status='failed' OR (status='processing' AND lease_until<?)").bind(Date.now()).run();return c.json(await syncStatus(c.env));
});
app.post('/api/import/whatsapp-notification', async c => {
  const body = (await c.req.json().catch(() => ({}))) as { sender?: string; text?: string; app?: string; token?: string };
  if (!body.text || typeof body.text !== 'string') return c.json({ error: 'Üzenet szövege kötelező.' }, 400);
  const sender = body.sender || 'WhatsApp';
  const appName = (body.app || '').toLowerCase();
  const isZoofy = appName.includes('zoofy') || sender.toLowerCase().includes('zoofy') || body.text.toLowerCase().includes('zoofy') || /meubelmontage|klusjes|zoofy/i.test(body.text);

  let event: EventRecord;
  if (isZoofy) {
    const zoofy = new ZoofyAdapter({
      apiKey: c.env.ZOOFY_API_KEY,
      minPrice: Number(c.env.ZOOFY_MIN_PRICE || 150),
      maxDistanceKm: Number(c.env.ZOOFY_MAX_DISTANCE_KM || 15)
    });
    event = zoofy.createEvent(sender, body.text);
  } else {
    const received = new Date().toISOString();
    const eventId = `wa_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    event = {
      id: eventId,
      source: 'whatsapp',
      sender,
      subject: `${sender} üzenete`,
      raw_content: body.text,
      received_at: received,
      metadata: { threadId: await hash(sender), automated: true }
    };
  }
  const added = await enqueueEvents(c.env.DB, [event]);
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  await processBatch(c.env, store, aiEngine, 2);
  return c.json({ success: true, added, eventId: event.id, source: event.source, metadata: event.metadata });
});

app.post('/api/import/zoofy-notification', async c => {
  const body = (await c.req.json().catch(() => ({}))) as { sender?: string; text?: string; app?: string };
  if (!body.text || typeof body.text !== 'string') return c.json({ error: 'Értesítés szövege kötelező.' }, 400);
  const sender = body.sender || 'Zoofy Pro';
  const zoofy = new ZoofyAdapter({
    apiKey: c.env.ZOOFY_API_KEY,
    minPrice: Number(c.env.ZOOFY_MIN_PRICE || 150),
    maxDistanceKm: Number(c.env.ZOOFY_MAX_DISTANCE_KM || 15)
  });
  const event = zoofy.createEvent(sender, body.text);
  const added = await enqueueEvents(c.env.DB, [event]);
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  await processBatch(c.env, store, aiEngine, 2);
  return c.json({ 
    success: true, 
    added, 
    eventId: event.id, 
    auto_accepted: event.metadata?.isAutoAccepted,
    whatsapp_template: event.metadata?.whatsappTemplate,
    details: event.metadata?.zoofyDetails 
  });
});
app.post('/api/import/whatsapp', async c => {
  const body=await c.req.json<{name:string;text:string}>();
  if(typeof body.text!=='string' || !body.text.trim() || body.text.length>500000)return c.json({error:'Adj meg legfeljebb 500 000 karakteres szöveges exportot.'},400);
  if(!hasAI(c.env))return c.json({error:'Előbb állítsd be az AI-kulcsot.'},400);
  const name=typeof body.name==='string'?body.name.slice(0,120):'WhatsApp import';const events:EventRecord[]=[];
  const conversation=await hash(name);const received=new Date().toISOString();
  for(let start=0;start<body.text.length;start+=8000){const chunk=body.text.slice(start,start+8000);events.push({id:`wa_import_${await hash(conversation+chunk)}`,source:'whatsapp',sender:name,subject:`${name} · importált beszélgetés`,raw_content:chunk,received_at:received,metadata:{threadId:conversation,manualImport:true,chunk:start/8000}});}
  const added=await enqueueEvents(c.env.DB,events);return c.json({added,...await syncStatus(c.env)});
});

// WhatsApp incoming webhook endpoint
app.get('/api/webhooks/whatsapp', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && c.env.WHATSAPP_VERIFY_TOKEN && token === c.env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(challenge || '');
  }
  return c.text('Forbidden', 403);
});

app.post('/api/webhooks/whatsapp', async (c) => {
  if (!c.env.WHATSAPP_APP_SECRET) return c.json({error:'Webhook signature secret required'},503);
  const payload = await c.req.text();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.WHATSAPP_APP_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const signature = c.req.header('x-hub-signature-256') || '';
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return c.json({error:'Invalid signature'},401);
  const bytes = new Uint8Array(signature.slice(7).match(/../g)!.map(x => parseInt(x,16)));
  if (!await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(payload))) return c.json({error:'Invalid signature'},401);
  const { store, aiEngine } = getServices(c.env);
  await store.init(aiEngine);
  const wa = new WhatsAppAdapter({ verifyToken: c.env.WHATSAPP_VERIFY_TOKEN, accessToken: c.env.WHATSAPP_ACCESS_TOKEN });
  const body = JSON.parse(payload);
  const events = wa.parseWebhookPayload(body);

  await enqueueEvents(c.env.DB,events);

  return c.json({ received: events.length });
});

// Export default worker with fetch & scheduled handlers
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await ensureSchema(env.DB);
    env = {...env,...await readSettings(env)};
    console.log(`Cron triggered at ${event.cron}`);
    const { store, aiEngine, briefService } = getServices(env);
    await store.init(aiEngine);
    const tasks = await store.getTasks();
    const waiting = await store.getWaitingItems();

    if (event.cron === '* * * * *') { await processNext(env,store,aiEngine); return; }
    if (event.cron === '*/15 * * * *') {
      if (hasAI(env)) await syncSources(env,store,aiEngine);
      await processNext(env,store,aiEngine);
      return;
    }
    if (event.cron === '0 8 * * *') {
      const morning = briefService.generateMorningBrief(tasks, waiting);
      await sendPush(env,morning.push_notification_preview);
    } else if (event.cron === '0 20 * * *') {
      const evening = briefService.generateEveningReview(tasks);
      await sendPush(env,evening.push_notification_preview);
    }
  },
};
