import type { EventRecord, TaskRecord, WaitingItem, CallerContact } from '../types';
import { createMockEvents, createCallerContacts, createWaitingItems } from '../adapters/mockData';
import { MemoryStore } from './memory';
import { AIEngine } from '../ai/engine';

export class DbStore {
  private memoryEvents: EventRecord[] = [];
  private memoryTasks: TaskRecord[] = [];
  private memoryWaiting: WaitingItem[] = [];
  private memoryContacts: CallerContact[] = [];
  private initialization?: Promise<void>;
  constructor(private db?: D1Database, private demo = true) {}

  async init(_aiEngine: AIEngine) {
    if (!this.initialization) this.initialization = this.initialize().catch(e => { this.initialization = undefined; throw e; });
    await this.initialization;
  }
  private async initialize() {
    if (this.db) {
      // A missing schema is an error: never silently lose writes in memory.
      const count = await this.db.prepare('SELECT count(*) AS count FROM events').first<{count: number}>();
      if ((count?.count || 0) > 0 || !this.demo) {
        if (this.demo) for (const contact of createCallerContacts()) await this.saveCallerContact(contact);
        return;
      }
    } else if (!this.demo) throw new Error('D1 database binding is required.');
    if (this.demo) await this.seedDemo();
  }
  async seedDemo() {
    const engine = new AIEngine({}); // Demo scenarios never consume paid API calls.
    const existing = new Set((await this.getEvents()).map(e => e.id));
    for (const event of createMockEvents()) {
      if (existing.has(event.id)) continue;
      await this.saveEvent(event);
      const ai = engine.fallbackAnalysis(event);
      const { suggested_status, action_required, ...analysis } = ai;
      await this.saveTask({ ...analysis, id: `task_${event.id.replace('evt_', '')}`, status: suggested_status,
        urgent_flag: ai.priority === 'CRITICAL', created_at: event.received_at, updated_at: event.received_at, events: [event] });
    }
    const waitingIds = new Set((await this.getWaitingItems()).map(w => w.id));
    for (const item of createWaitingItems()) if (!waitingIds.has(item.id)) await this.saveWaitingItem(item);
    for (const task of await this.getTasks()) if (task.waiting_for) {
      const id = `wait_${task.id}`;
      if (!waitingIds.has(id) && !createWaitingItems().some(w => w.task_id === task.id)) await this.saveWaitingItem({id, task_id:task.id, waiting_for:task.waiting_for, item_description:task.title, since_date:task.created_at, status:'active'});
    }
    for (const contact of createCallerContacts()) await this.saveCallerContact(contact);
  }
  private parseTask(row: any): TaskRecord {
    return {...row, people_involved:JSON.parse(row.people_involved || '[]'), urgent_flag:Boolean(row.urgent_flag), action_history:JSON.parse(row.action_history || '[]')};
  }
  async getTasks(): Promise<TaskRecord[]> {
    if (!this.db) return structuredClone(this.memoryTasks);
    const {results} = await this.db.prepare("SELECT * FROM tasks ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, created_at DESC").all();
    const {results: links} = await this.db.prepare('SELECT et.task_id,e.* FROM event_tasks et JOIN events e ON e.id=et.event_id ORDER BY e.received_at').all<any>();
    return results.map(r => { const task=this.parseTask(r);task.events=links.filter(e=>e.task_id===task.id).map(({task_id,...e})=>({...e,metadata:JSON.parse(e.metadata || '{}')}));return task; });
  }
  async getTaskById(id: string): Promise<TaskRecord | undefined> {
    const task = (await this.getTasks()).find(t => t.id === id);
    if (task && this.db) {
      const {results} = await this.db.prepare('SELECT e.* FROM events e JOIN event_tasks et ON et.event_id=e.id WHERE et.task_id=? ORDER BY e.received_at').bind(id).all<any>();
      task.events = results.map(r => ({...r, metadata:JSON.parse(r.metadata || '{}')}));
    }
    return task;
  }
  async findTaskForEvent(eventId: string): Promise<TaskRecord | undefined> {
    if (!this.db) return structuredClone(this.memoryTasks.find(t => t.events?.some(e => e.id === eventId)));
    const row = await this.db.prepare('SELECT task_id FROM event_tasks WHERE event_id=? LIMIT 1').bind(eventId).first<{task_id:string}>();
    return row ? this.getTaskById(row.task_id) : undefined;
  }
  async saveTask(task: TaskRecord): Promise<void> {
    task.updated_at = new Date().toISOString();
    if (!this.db) {
      const idx = this.memoryTasks.findIndex(t => t.id === task.id);
      if (idx >= 0) this.memoryTasks[idx] = structuredClone(task); else this.memoryTasks.unshift(structuredClone(task));
      return;
    }
    const columns = ['id','title','summary','project_category','priority','deadline','suggested_action','draft_reply','next_step','waiting_for','people_involved','reservation_property','confidence','priority_reason','status','snoozed_until','urgent_flag','action_history','created_at','updated_at'];
    const data: Record<string, unknown> = {...task, people_involved:JSON.stringify(task.people_involved || []), urgent_flag:task.urgent_flag ? 1 : 0, action_history:JSON.stringify(task.action_history || [])};
    const statements = [this.db.prepare(`INSERT INTO tasks (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c => c !== 'id' && c !== 'created_at').map(c => `${c}=excluded.${c}`).join(',')}`).bind(...columns.map(c => data[c] ?? null))];
    for (const event of task.events || []) statements.push(this.db.prepare('INSERT OR IGNORE INTO event_tasks (event_id,task_id) VALUES (?,?)').bind(event.id,task.id));
    await this.db.batch(statements);
  }
  async getMemoryContext(event:EventRecord) { return this.db ? new MemoryStore(this.db).context(event) : ''; }
  async getEvents(): Promise<EventRecord[]> {
    if (!this.db) return structuredClone(this.memoryEvents);
    const {results} = await this.db.prepare('SELECT * FROM events ORDER BY received_at DESC').all<any>();
    return results.map(r => ({...r,metadata:JSON.parse(r.metadata || '{}')}));
  }
  async saveEvent(event: EventRecord) {
    if (!this.db) { if (!this.memoryEvents.some(e => e.id === event.id)) this.memoryEvents.unshift(structuredClone(event)); return; }
    await this.db.prepare('INSERT OR IGNORE INTO events (id,source,source_id,sender,subject,raw_content,received_at,metadata) VALUES (?,?,?,?,?,?,?,?)').bind(event.id,event.source,event.source_id || null,event.sender,event.subject || null,event.raw_content,event.received_at,JSON.stringify(event.metadata || {})).run();
  }
  async getWaitingItems(): Promise<WaitingItem[]> {
    if (!this.db) return structuredClone(this.memoryWaiting);
    return (await this.db.prepare('SELECT * FROM waiting_items ORDER BY since_date DESC').all<WaitingItem>()).results;
  }
  async saveWaitingItem(item: WaitingItem) {
    if (!this.db) { const idx = this.memoryWaiting.findIndex(w => w.id === item.id); if (idx >= 0) this.memoryWaiting[idx] = structuredClone(item); else this.memoryWaiting.unshift(structuredClone(item)); return; }
    await this.db.prepare('INSERT INTO waiting_items (id,task_id,waiting_for,item_description,since_date,status) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET waiting_for=excluded.waiting_for,item_description=excluded.item_description,status=excluded.status').bind(item.id,item.task_id || null,item.waiting_for,item.item_description,item.since_date,item.status).run();
  }
  async resolveWaitingItem(id: string) {
    const item = (await this.getWaitingItems()).find(w => w.id === id);
    if (!item) return false;
    await this.saveWaitingItem({...item,status:'resolved'}); return true;
  }
  async getCallerContacts(): Promise<CallerContact[]> {
    if (!this.db) return structuredClone(this.memoryContacts);
    return (await this.db.prepare('SELECT * FROM caller_contacts').all<CallerContact>()).results;
  }
  async saveCallerContact(contact: CallerContact) {
    if (!this.db) { const idx = this.memoryContacts.findIndex(c => c.phone_number === contact.phone_number); if (idx >= 0) this.memoryContacts[idx] = structuredClone(contact); else this.memoryContacts.push(structuredClone(contact)); return; }
    await this.db.prepare('INSERT INTO caller_contacts (id,phone_number,guest_name,source,reservation_id,property_name,check_in,check_out) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(phone_number) DO UPDATE SET guest_name=excluded.guest_name,source=excluded.source,reservation_id=excluded.reservation_id,property_name=excluded.property_name,check_in=excluded.check_in,check_out=excluded.check_out').bind(contact.id,contact.phone_number,contact.guest_name,contact.source,contact.reservation_id || null,contact.property_name || null,contact.check_in || null,contact.check_out || null).run();
  }
}
