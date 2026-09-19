import type { EventRecord, TaskRecord } from '../types';
import type { AIEngine } from '../ai/engine';
import type { DbStore } from './dbStore';

function caseKey(event: EventRecord): string | undefined {
  const metadata = event.metadata || {};
  // Stable references only: never merge unrelated messages solely by sender.
  const key = metadata.threadId || metadata.reservationId || metadata.orderId;
  return key ? `${event.source}:${key}` : undefined;
}
let queue: Promise<unknown> = Promise.resolve();
export function ingestEvent(store: DbStore, ai: AIEngine, event: EventRecord): Promise<TaskRecord | undefined> {
  const work = queue.then(() => ingest(store, ai, event));
  queue = work.catch(() => undefined);
  return work;
}
async function ingest(store: DbStore, ai: AIEngine, event: EventRecord): Promise<TaskRecord | undefined> {
  const existing = await store.findTaskForEvent(event.id);
  if (existing) return existing;
  const key = caseKey(event);
  const related = key ? (await store.getEvents()).filter(e => e.id !== event.id && caseKey(e) === key) : [];
  let previous: TaskRecord | undefined;
  for (const item of related) { previous = await store.findTaskForEvent(item.id); if (previous) break; }
  await store.saveEvent(event);
  const analysis = await ai.analyzeEvent(event, [related.slice(-3).map(e => e.raw_content.slice(0,2000)).join('\n'),await store.getMemoryContext(event)].filter(Boolean).join('\n\n'));
  if (!analysis.action_required && !previous) return undefined;
  const { action_required, suggested_status, ...fields } = analysis;
  const task: TaskRecord = { ...fields, id:previous?.id || `task_${event.id}`, status:suggested_status,
    urgent_flag:analysis.priority === 'CRITICAL', created_at:previous?.created_at || event.received_at,
    updated_at:new Date().toISOString(), action_history:previous?.action_history || [], events:[...(previous?.events || []),event] };
  await store.saveTask(task);
  if (task.waiting_for) await store.saveWaitingItem({id:`wait_${task.id}`, task_id:task.id, waiting_for:task.waiting_for, item_description:task.title, since_date:task.updated_at, status:'active'});
  return task;
}
