# MyBrain implementation status

Updated 2026-09-19 after the Android permissions, personal memory and Git/Cloudflare request.

## Implemented and locally tested

- [x] Task dashboard, horizons, local complete/draft/snooze/ignore, waiting items, daily agenda, briefs and search.
- [x] OpenAI/Gemini selection, configurable model, encrypted API credentials.
- [x] Owner login and persistent HttpOnly session; production API closed without APP_SECRET.
- [x] Google account connection with read-only consent, PKCE, browser-bound one-use state and encrypted refresh tokens.
- [x] Automatic initial sync when AI and Google are ready; explicitly bounded 30-day import.
- [x] Durable leased processing queue, progress, retry and background crons.
- [x] Android installed-PWA share target and explicit private WhatsApp text-export import with preview.
- [x] Short owner-approved memory examples, opt-in learning from saved drafts, bounded retrieval, search and forgetting.
- [x] Strict live-provider errors instead of silent demo fallback.
- [x] Production Worker name/URL, actual dedicated D1/R2 bindings, frontend build hook and automatic schema initialization.
- [x] Separate local/demo configuration; secrets, dependencies and test artifacts ignored by Git.

## Owner setup / external verification

- [ ] APP_SECRET and VAPID secrets installed on the production Worker. Automatic approval review rejected this upload; no workaround was attempted. It needs explicit user approval or manual dashboard entry.
- [ ] Google OAuth Client ID/Secret supplied by the owner; real account consent completed.
- [ ] Owner AI API key supplied and a live model call checked.
- [ ] Android home-screen installation, real WhatsApp share-sheet use and device push receipt verified.

## Explicit scope boundaries

Private WhatsApp is share/import only. No native Android notification reader has been built, and the PWA never claims an operating-system-wide read permission. Initial Gmail import is the most recent 20 inbox messages within 30 days, not the whole mailbox. Calendar import covers at most 50 events in the next 30 days from the primary calendar. Memory is stored context, not model-weight training. Search is keyword/intent based. External sends and calendar modifications are not performed.
