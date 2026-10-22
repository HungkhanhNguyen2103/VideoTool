# Task 113 — "Thêm kênh từ YouTube": create channel profiles from the Google account, and refresh profile fields from YouTube

Work directly on `main` (no feature branch, no worktree). Never push. Do not stage temp files (`.env`, `.env.*`, `vite.*.config.ts`, `Claude outputs/`, `docs/superpowers/tasks/*`, `docs/superpowers/plans/*`, the stray `01M4W…` files in the repo root). Keep LF line endings in commits. Follow AGENTS.md (rule 11: Status line in the same commit; import through each module's `index.ts`; CSS Modules + design tokens). Code, comments, AI prompts and commit messages are English; user-facing text is Vietnamese. Primary viewport 1920×1080. This is a small task: no brainstorming/design-approval round is needed, write a short plan (untracked) and implement. Two commits are fine: `feat(youtube): import channel profiles from a Google account` (server) and `feat(youtube): add-from-YouTube dialog and profile refresh` (client).

## Why

Task 112 shipped a read-only YouTube connection that is bound to an **existing** channel profile: `POST /api/youtube/connect/:channelId` starts OAuth for that profile, and the callback binds the chosen channel to it (`beginYoutubeOauth(profileId, …)`, `completeYoutubeOauth`, `selectYoutubeChannel`, `bindCredential` in `src/server/modules/youtube/service.ts`). Hung must still create the profile by hand (name, handle, description, …) before he can connect, and "Đồng bộ ngay" never writes channel info back into the profile. He wants:

1. A button **"Thêm kênh từ YouTube"** in the channel manager dialog (next to "Tạo kênh"): sign in with Google once, see the channels that account authorises, tick the ones to add, and the tool creates the profiles pre-filled and already connected.
2. A way to **refresh the profile fields from YouTube** later, without overwriting what he typed.

Everything stays **read-only** (same two scopes, no write path to YouTube) and every Task 112 security rule still applies (encrypted refresh token, no token in logs/responses/client, PKCE + single-use state, redaction). Do not touch the analytics, analysis, AI review or linking code except where this task needs a small shared helper.

## Facts and limits to respect

- Authorisation is per Google account consent. A Google account may own several channels (brand accounts); `channels.list?mine=true` returns what the consent granted, which may be a single channel even when the account owns more. **Do not assume it returns all channels.** The UI must therefore support repeating the flow ("Thêm kênh khác từ tài khoản này") and tell the user, in one sentence, that Google decides which channels it lists and that another channel may need another sign-in. Report what you observe in a real test if Hung provides credentials; otherwise say it was not verified.
- The OAuth test-user list gives the app no way to enumerate channels; do not build anything that pretends to.
- A YouTube channel may be bound to only one profile (existing rule). In the picker show already-bound channels as disabled with the name of the profile that owns them.

## 1. Server

### 1.1 Import flow (new, no existing profile)

- `POST /api/youtube/import/start` → `{ authorizationUrl }`. Same PKCE/state mechanics as `beginYoutubeOauth` but the pending state is bound to a new mode `import` instead of a `profileId` (extend `PendingOAuthState` with a discriminated union, or an explicit `mode` field; keep existing profile-bound states working and tested). Same host handling (`localhost` / `127.0.0.1`), same 10-minute single-use state.
- Callback: extend `GET /api/youtube/oauth/callback` to handle `import` states. After code exchange, call `listOwnedChannels` and extend the `YoutubeChannelOption` shape with `description` (from `snippet.description`), `defaultLanguage`/`country` if present (from `snippet`, request `part=snippet,contentDetails` as today; do not add parts that cost quota or need new scopes), keeping the existing fields. Keep the refresh token **encrypted in a short-lived pending record** (reuse the credentials store with a pending document keyed by a random `selectionId`, TTL 10 minutes, deleted on completion/expiry; add a TTL index through `indexes.ts`). No plaintext token in memory beyond the exchange, none in HTML, none in logs.
- The callback shows a Vietnamese server-rendered page (same style as `choicePage`) with **checkboxes** (multi-select), each row showing avatar, title, handle, and "Đã gắn với hồ sơ …" disabled when already bound. Submit → `POST /api/youtube/import/select` with `{ selectionId, youtubeChannelIds[] }` (form or JSON). Show a result page and `postMessage({ type: 'youtube-oauth-finished', success, imported: n })` to the opener with the same origin check as Task 112c.
- `POST /api/youtube/import/select` for each chosen channel, atomically per channel and with a clear per-channel result:
  1. Reject already-bound channels (skip with reason, not a global failure).
  2. Create the profile through the **channel module's public API** (`createChannel`), pre-filled by the pure mapper in 1.3. Name collisions: the channel module normalises names; on `409` duplicate name retry once with a suffix like `"<title> (<handle>)"`, then fail that channel with a Vietnamese reason.
  3. Bind the credential with the existing `bindCredential` (each profile gets its own encrypted copy of the refresh token; the credentials store is keyed per profile).
  4. If step 3 fails after step 2 succeeded, delete the profile just created (compensate), report the failure.
  Return `{ results: [{ youtubeChannelId, ok, profileId?, reason? }] }`.
- Pending record is deleted when all selections are processed or on expiry; selecting twice with the same `selectionId` is rejected.

### 1.2 Refresh profile from YouTube

- `POST /api/youtube/channels/:channelId/refresh-profile` body `{ overwrite: boolean (default false), fields?: ('name'|'handle'|'description'|'language')[] }`. Requires a connection. Fetch the bound channel's snippet with one `channels.list?id=…&part=snippet` (1 quota unit, count it in the existing quota estimate), map with the same pure mapper, then PATCH the profile through the channel module's public API:
  - `overwrite=false` (default): only fields that are empty/default on the profile are written.
  - `overwrite=true`: only the listed `fields` are overwritten.
  - Never touch `links`, `defaultHashtags`, `descriptionFooter`, `aiDisclosureText`, `thumbnailTemplate`, `publishSchedule`, `tagline`.
  - Return `{ updated: string[], skipped: string[] }`.
- Also call the "fill empty fields only" variant automatically at the end of a **successful sync** (the existing job), best-effort: a failure here must never fail the sync; log a Vietnamese line `Đã cập nhật thông tin hồ sơ từ YouTube: …` when something changed.
- Store the avatar URL in the connection summary only (as today). Do not download or store the image in this task.

### 1.3 Pure mapper (`youtube-profile-mapper.ts`, unit-tested)

`mapYoutubeChannelToProfile(option) → { name, handle?, description, language }`:
- `name`: trimmed title, max 100 chars.
- `handle`: use `customUrl` only if it matches the channel contract's handle regex (`^@[\p{L}\p{N}_.-]{3,30}$`); otherwise omit (never invent one).
- `description`: trimmed, truncated to the contract limit (1000) at a word boundary, no ellipsis games.
- `language`: `vi` when `defaultLanguage` starts with `vi`, `en` when it starts with `en`, otherwise the default `vi`.
- Everything else comes from the contract defaults.

### 1.4 Tests (fake `fetch`, temp DB like sibling modules)

Import start produces a URL with the exact two scopes and an import-mode state; callback for import lists channels with already-bound ones flagged; select creates N profiles pre-filled and bound; duplicate channel skipped with reason; name collision retry; bind failure compensates (profile removed); `selectionId` single-use and expiry; pending record holds only the encrypted token; no token string in any response/log (scan captured output for the fake token values, as in Task 112); refresh-profile writes only empty fields by default and only listed fields with overwrite, never touches the protected fields; sync-end auto-fill does not fail the sync when the Google call fails; mapper cases (invalid handle dropped, long description truncated, language detection, empty title).

## 2. Client

- `ChannelManagerDialog.tsx`: add a button **"Thêm kênh từ YouTube"** beside "Tạo kênh". It calls `import/start`, opens the authorization URL in a popup like the existing connect flow (reuse the tracked-popup + origin-checked `postMessage` logic from `ChannelYoutubeControls`; extract a small shared hook rather than duplicating it), and on `youtube-oauth-finished` refreshes the channel list and selects the first created profile. Show the result summary ("Đã thêm 2 kênh, bỏ qua 1 kênh đã được gắn") using the existing notice component.
- When Google is not configured (missing env), the button is disabled with the same setup hint the connect button already shows.
- One line under the button (muted): "Google quyết định kênh nào được liệt kê. Cần thêm kênh khác? Bấm lại và chọn kênh khác khi đăng nhập."
- In `ChannelYoutubeControls`: add **"Cập nhật thông tin từ YouTube"** (calls `refresh-profile` with `overwrite=false`) and a small secondary action "Ghi đè từ YouTube…" that opens a confirm listing the fields (name, handle, description, language) as checkboxes and sends `overwrite=true` with the chosen fields. After success invalidate the channel list/detail queries so the form shows the new values; do not discard unsaved edits silently — if the form is dirty, ask before refreshing it.
- No-DOM tests in the repo's style: api helpers (URLs, methods, bodies, error mapping), hooks cache invalidation, a pure helper for the result-summary text and for the "dirty form" decision.

## Out of scope

Dragging in channels of other people (no API key flow, no paste-a-link import), downloading avatars, importing videos (the existing sync does it), tagline/hashtag generation, changing any Task 112 analytics or write paths, and any YouTube write scope.

## Verification (run and report real output)

`npm run typecheck`, `npm run lint`, new and touched vitest files plus `src/server/modules/youtube`, `src/server/modules/channel`, `src/client/features/youtube`, `src/client/features/channel`, and `npm run build` (reuse the local Mongo workaround from earlier tasks if needed and say so). Live OAuth with a real Google account is not verifiable without Hung's credentials: say so, and give Hung the manual steps (restart server + Vite, open Quản lý kênh, "Thêm kênh từ YouTube", sign in with the test-user Gmail, tick the channel, confirm the profile appears pre-filled and connected, run "Đồng bộ ngay", change the description on YouTube or in the profile and try "Cập nhật thông tin từ YouTube" in both modes, repeat with a second channel/account).

## Report

Write `docs/superpowers/tasks/task-113-report.md` (untracked): commits, files changed, the import flow as implemented, how the pending token is stored and expired, the field-mapping rules, which profile fields are never overwritten, what you observed or could not verify about multi-channel accounts, verification output, deviations. Do not push.
