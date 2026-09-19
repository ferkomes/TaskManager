-- ==============================================================================
-- MYBRAIN D1 DATABASE SCHEMA
-- ==============================================================================

-- 1. Immutable Events: Original raw information ingested from all sources
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL, -- 'gmail', 'calendar', 'lodgify', 'airbnb', 'cleaning', 'whatsapp', 'manual'
    source_id TEXT,
    sender TEXT NOT NULL,
    subject TEXT,
    raw_content TEXT NOT NULL,
    received_at DATETIME NOT NULL,
    metadata TEXT, -- JSON format: threadId, phone, reservationId, attachmentUrls
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);

-- 2. Tasks: AI-generated actionable items linked to events
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    project_category TEXT NOT NULL DEFAULT 'General',
    priority TEXT NOT NULL CHECK(priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
    deadline DATETIME,
    suggested_action TEXT NOT NULL,
    draft_reply TEXT,
    next_step TEXT,
    waiting_for TEXT,
    people_involved TEXT, -- JSON array of strings
    reservation_property TEXT,
    confidence REAL DEFAULT 0.90,
    priority_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'now' CHECK(status IN ('now', 'today', 'tomorrow', 'next_7_days', 'later', 'done', 'snoozed', 'ignored')),
    snoozed_until DATETIME,
    urgent_flag INTEGER DEFAULT 0,
    action_history TEXT, -- JSON array of actions taken (Do it, Draft, Later, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);

-- 3. Event <-> Task Many-to-Many / Deduplication Linkage
CREATE TABLE IF NOT EXISTS event_tasks (
    event_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, task_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 4. Waiting Items: What are we waiting for, from whom, and since when?
CREATE TABLE IF NOT EXISTS waiting_items (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    waiting_for TEXT NOT NULL, -- e.g. "Tom", "Lodgify", "Laurent", "Supplier"
    item_description TEXT NOT NULL, -- e.g. "Final quotation", "API whitelist"
    since_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_waiting_status ON waiting_items(status);

-- 5. Caller & Guest Directory for Real-time Urgent Mode correlation
CREATE TABLE IF NOT EXISTS caller_contacts (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL UNIQUE,
    guest_name TEXT NOT NULL,
    source TEXT NOT NULL, -- 'lodgify', 'airbnb', 'cleaning'
    reservation_id TEXT,
    property_name TEXT,
    check_in DATETIME,
    check_out DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_caller_phone ON caller_contacts(phone_number);

-- 6. Web Push Notification Subscriptions (Morning Brief & Evening Review)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. App Settings & Integration Tokens (Encrypted or server-only)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Compact, owner-approved examples; never learn from incoming third-party text.
CREATE TABLE IF NOT EXISTS memory_examples (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    example TEXT NOT NULL,
    task_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_updated ON memory_examples(updated_at);

CREATE TABLE IF NOT EXISTS owner_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_requests (
    state_hash TEXT PRIMARY KEY,
    verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_queue (
    event_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status, lease_until);
