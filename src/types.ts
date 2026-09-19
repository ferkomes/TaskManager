export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export type TaskStatus = 
  | 'now' 
  | 'today' 
  | 'tomorrow' 
  | 'next_7_days' 
  | 'later' 
  | 'done' 
  | 'snoozed' 
  | 'ignored';

export type EventSource = 
  | 'gmail' 
  | 'calendar' 
  | 'lodgify' 
  | 'airbnb' 
  | 'cleaning' 
  | 'whatsapp' 
  | 'manual';

export interface EventRecord {
  id: string;
  source: EventSource;
  source_id?: string;
  sender: string;
  subject?: string;
  raw_content: string;
  received_at: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  summary: string;
  project_category: string;
  priority: Priority;
  deadline?: string | null;
  suggested_action: string;
  draft_reply?: string | null;
  next_step?: string | null;
  waiting_for?: string | null;
  people_involved?: string[];
  reservation_property?: string | null;
  confidence: number;
  priority_reason: string;
  status: TaskStatus;
  snoozed_until?: string | null;
  urgent_flag: boolean;
  action_history?: Array<{
    action: 'do_it' | 'draft' | 'later' | 'done' | 'snooze' | 'ignore';
    timestamp: string;
    details?: string;
  }>;
  created_at: string;
  updated_at: string;
  events?: EventRecord[];
}

export interface WaitingItem {
  id: string;
  task_id?: string | null;
  waiting_for: string; // e.g. "Tom", "Lodgify", "Guest", "Supplier"
  item_description: string;
  since_date: string;
  status: 'active' | 'resolved';
}

export interface CallerContact {
  id: string;
  phone_number: string;
  guest_name: string;
  source: 'lodgify' | 'airbnb' | 'cleaning';
  reservation_id?: string;
  property_name?: string;
  check_in?: string;
  check_out?: string;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at?: string;
}

export interface AIAnalysisOutput {
  action_required: boolean;
  title: string;
  summary: string;
  project_category: string;
  priority: Priority;
  deadline: string | null;
  suggested_action: string;
  draft_reply: string;
  next_step: string;
  waiting_for: string | null;
  people_involved: string[];
  reservation_property: string | null;
  confidence: number;
  priority_reason: string;
  suggested_status: TaskStatus;
}

export interface Env {
  DB: D1Database;
  ATTACHMENTS_BUCKET?: R2Bucket;
  ENVIRONMENT?: string;
  AI_PROVIDER?: 'gemini' | 'openai';
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  LODGIFY_API_KEY?: string;
  CLEANING_CALENDAR_ICS_URL?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  APP_SECRET?: string;
  APP_URL?: string;
  GOOGLE_GRANTED_SCOPES?: string;
}
