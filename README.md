# MyBrain

Personal task inbox with a Hungarian mobile-first PWA, read-only Google consent, a durable AI processing queue, and short owner-approved memory examples. Built with React, Vite, Hono and Cloudflare Workers/D1/R2.

## Production

Target: **https://mybrain.ferkomes.workers.dev**. `wrangler.toml` uses the existing `mybrain` Worker name, its own `mybrain-db` D1 database and `mybrain-attachments` R2 bucket. `wrangler deploy` builds the frontend through `[build].command`; the first API request creates missing schema tables using idempotent statements. Production never seeds demo data.

Cloudflare Workers Builds can use:

- Build command: `npm run build` (optional; Wrangler also builds).
- Deploy command: `npx wrangler deploy` or `npm run deploy`.
- Root directory: repository root.
- Production branch: `main`.

Set the following Cloudflare **Worker secrets** before using the personal workspace:

- `APP_SECRET`: randomly generated owner access/encryption key, at least 32 characters. The production API remains locked without it. Do not commit it or put it in public vars.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: for phone push notifications.

Owner login uses a 30-day HttpOnly/SameSite cookie. The cookie stores a random session token; D1 stores its hash. `APP_SECRET` also encrypts saved integration credentials with AES-GCM. Rotating it requires re-entering saved credentials. The personal memory and imported source texts are stored in private D1 tables behind owner authentication.

## First setup from Android

1. Open the production URL and enter the owner access key.
2. In **Beállítások**, choose OpenAI or Gemini, enter your API key and optionally a model name. Credentials are encrypted server-side. A configured live provider failure is reported; it does not silently produce demo tasks.
3. Complete the one-time Google OAuth application setup below, then tap **Google-fiók csatlakoztatása**. Choose your account and grant Gmail/Calendar read-only access on Google's own consent screen.
4. With an AI key and Google consent both present, the Settings screen starts the first import. The initial scope is explicit: up to 20 recent inbox messages within 30 days, and up to 50 events from the primary calendar in the next 30 days. It is not a complete mailbox archive.
5. The durable queue shows progress and supports retry. An open Settings/Import screen processes entries; a one-minute cron continues processing when the app is closed. Sources are polled every 15 minutes. Messages that are purely informational are recorded without creating a task.
6. Install MyBrain from Chrome's menu to use Android's share sheet and push notifications.

AI API usage is charged by the chosen provider. Imported texts and up to three relevant memory examples are sent to that provider for analysis. The API key itself does not grant access to Gmail, Calendar or WhatsApp.

### Google OAuth setup (once per application)

In Google Cloud Console:

1. Enable Gmail API and Google Calendar API.
2. Configure the OAuth consent screen. While the application is in testing, add your own Google address as a test user. Gmail read scopes are restricted; public distribution may require Google verification. Testing-mode refresh tokens may expire and require reconnecting.
3. Create an OAuth **Web application** client. Add this exact authorized redirect URI:

   `https://mybrain.ferkomes.workers.dev/api/auth/google/callback`

4. Enter the Client ID and Client Secret in **Beállítások → Google-kliens egyszeri beállítása** (or supply `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets).
5. Tap the Google connection button. The authorization-code flow uses PKCE, a browser-bound one-use state and encrypted refresh-token storage. Requested scopes are only `gmail.readonly` and `calendar.readonly`.

Disconnecting removes the application's stored refresh token and pending Google analysis jobs. To revoke Google's authorization as well, remove MyBrain from your Google account's third-party connections. Previously imported tasks remain in your workspace.

### Private WhatsApp

A PWA cannot ask Android for unrestricted access to private WhatsApp messages or notification history. This implementation provides explicit **share/import**:

- WhatsApp → conversation menu → More → Export chat → Without media → share the `.txt` file with installed MyBrain.
- Alternatively, use **Importálás** to select the exported `.txt` file, or paste selected messages.
- Shared text is temporarily held on the device, previewed, then imported only when you press **Kiválasztott szöveg elemzése**. Up to 500,000 text characters are split into 8,000-character queue entries. Repeated chunks are skipped; use a distinct conversation name for distinct chats.
- No continuous monitoring of private WhatsApp is claimed. That requires a separately implemented native Android companion and explicit notification-access permission, and still cannot recover the complete message history.

The optional existing WhatsApp **Business** webhook is separate. It requires Meta configuration, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`; incoming signatures are verified. No WhatsApp messages are sent.

## Personal memory

Enable **Tanuljon a mentett választervezeteimből rövid példákkal** in Settings, or add a rule/example in **Memória**. Learning uses only drafts you explicitly save, not arbitrary incoming messages or merely opened suggestions.

- At most 100 examples, with a 120-character topic, optional 240-character instruction and 600-character example.
- At most three relevant examples, with about 2,600 characters of serialized memory, accompany an analysis.
- Search and **Elfelejtés** make memory visible and removable.
- The model is instructed to use examples for style, never as current prices, dates, entry codes or promises.
- Memory belongs to MyBrain's database, so changing AI provider does not erase it. This is contextual personalization, not model-weight training.

## Local development

Requires Node.js 22.13+.

```sh
npm ci
npm run build
npm run preview
```

Open http://localhost:8787. `preview` uses `wrangler.dev.toml` and `tests/demo.env`; it cannot select production mode accidentally and uses only local D1/R2. The database schema is initialized automatically. Test credentials are not valid production credentials.

For Vite hot reload, run `npm run dev:api` and `npm run dev` separately, then open http://localhost:5173. `dev:api` can read your existing `.dev.vars`; do not overwrite that file. The service worker registers automatically only for production frontend builds.

## Verification

```sh
npm run build
npm test
npm run test:browser
npx wrangler deploy --dry-run
```

Browser tests start their own local Worker on port 8789 with an isolated `.wrangler/browser-tests` database. They use installed Chrome with desktop and Pixel 7 viewports, including memory, setup auto-sync, Android-style share delivery, and offline shell checks. No live Google or AI credentials are used by these tests.

Live Google consent, model calls under the owner's API account, real Android share-sheet installation and actual phone push receipt still require that owner's setup/device. The browser share-target protocol is exercised locally.

## Other behavior and limitations

- Done/Draft/Later/Ignore modify only MyBrain. Drafts are copied for manual sending; no adapter sends email or changes external calendars/reservations.
- Waiting dashboard, deadline agenda, morning/evening brief, urgent-call simulator and keyword/intent-based search remain available.
- Brief notification schedules are 08:00 and 20:00 **UTC**. Local Wrangler does not automatically trigger crons.
- Source-reference deduplication uses thread/reservation/order IDs. Queue entries have atomic leases; different events of the same conversation are serialized by database leases during queued processing.
- Offline support covers the application shell. API data and edits require a connection.
- Voice intake is simulated text; image attachments use the provided text description, without OCR.
- Lodgify and cleaning adapters are optional; Airbnb is available through Lodgify, not a direct private Airbnb account login.
