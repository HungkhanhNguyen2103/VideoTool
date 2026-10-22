# Task 113 — YouTube channel import and profile refresh

## Commits

- `f2666d6` — `feat(youtube): import channel profiles from a Google account`
- `f02eacf` — `feat(youtube): add-from-YouTube dialog and profile refresh`

Both commits are local on `main`; nothing was pushed. The plan and this report remain untracked as requested.

## Implementation

### Server

- Added `POST /api/youtube/import/start` and import-mode handling in the existing PKCE OAuth callback. OAuth still requests exactly `youtube.readonly` and `yt-analytics.readonly`.
- The callback lists channels Google makes available for that consent and renders a Vietnamese multi-select page. Already-bound channels are disabled and show their owning profile name. Google may return only a subset of an account's channels; the page explains that another channel can require another sign-in.
- The OAuth refresh token is encrypted with AES-256-GCM in a pending document keyed by a random selection id. A ten-minute Mongo TTL index expires the record. Selection uses an atomic find-and-delete, rejects reuse/expiry, and re-encrypts the token with a fresh IV for each created profile. No plaintext token is put in HTML, API responses, logs, or browser state.
- Each selected channel is checked for an existing binding, mapped, created through the channel module's public API, then bound with the existing credential flow. A duplicate local name retries once with a validated handle or channel id suffix. A failed bind attempts to delete the new profile and reports a per-channel result.
- The pure mapper trims and caps the name at 100 characters, accepts only contract-valid YouTube custom URLs as handles, trims and truncates descriptions to 1,000 characters at a word boundary, and maps `vi*` to Vietnamese, `en*` to English, and other/missing languages to Vietnamese.
- Manual refresh calls `channels.list?id=…&part=snippet` once and counts one quota unit. Default mode fills only empty fields (and the default Vietnamese language); overwrite mode changes only checked fields. `links`, `defaultHashtags`, `descriptionFooter`, `aiDisclosureText`, `thumbnailTemplate`, `publishSchedule`, and `tagline` are preserved.
- Successful sync reuses its existing channel snippet response to fill empty profile fields, so it adds no Google request or quota unit. Profile-fill errors are best-effort and do not fail sync. The avatar URL remains in the connection summary; the image is not downloaded.
- The OAuth state and temporary import record carry a strictly allowlisted local opener origin. This keeps `postMessage` targeted to the Vite/API app across ports 5173 and 3000 while preserving the existing popup source and callback-origin checks.

### Client

- Added “Thêm kênh từ YouTube” to the channel manager, with a configuration hint/disabled state, the Google channel-list limitation, popup status, a result summary, list refresh, and selection of the first newly created profile.
- Extracted the tracked-popup and origin-checked message handling into a shared hook used for account import and existing profile connection.
- Added fill-only refresh and a checkbox confirmation for selected-field overwrite. The channel manager asks before replacing dirty edits and refreshes the editor after an accepted update.
- Added API and query hooks, cache invalidation, and no-DOM tests for request shapes, summary text, and dirty-form decisions.

## Changed files

Server commit:

- `AGENTS.md`, `src/contracts/youtube.ts`
- `src/server/modules/youtube/MODULE.md`
- `src/server/modules/youtube/docs.ts`, `indexes.ts`, `oauth-state.test.ts`, `oauth.ts`, `repo.ts`, `routes.ts`, `service.ts`, `sync.ts`, `youtube-service.test.ts`
- `src/server/modules/youtube/profile-refresh.ts`, `profile-refresh.test.ts`
- `src/server/modules/youtube/youtube-profile-mapper.ts`, `youtube-profile-mapper.test.ts`, `youtube-routes.test.ts`

Client commit:

- `AGENTS.md`
- `src/client/features/channel/channel-helpers.ts`, `channel-helpers.test.ts`, `components/ChannelManagerDialog.tsx`, `components/ChannelManagerDialog.module.css`
- `src/client/features/youtube/api.ts`, `api.test.ts`, `hooks.ts`, `hooks.test.ts`, `youtube-view.ts`, `youtube-view.test.ts`, `use-youtube-oauth-popup.ts`
- `src/client/features/youtube/components/ChannelYoutubeControls.tsx`, `ChannelYoutubeControls.module.css`

## Verification

- `npm test -- src/server/modules/youtube src/server/modules/channel src/client/features/youtube src/client/features/channel --run` — 21 files passed, 74 tests passed. Mongo-backed tests used the installed MongoDB 8.0.6 binary through `MONGOMS_SYSTEM_BINARY`; Vitest noted that the default requested binary is 8.2.6 and used the system binary.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed. Vite emitted the existing informational warning for a minified client chunk larger than 500 kB.
- `git diff --check` — passed. Staged Git blobs were verified as LF; `.git` normalization emitted Windows working-copy warnings because `core.autocrlf` is enabled.
- Live Google OAuth, real multi-channel enumeration, and a real YouTube sync were not run because no Google credentials/account were supplied.
- Browser acceptance at 1920×1080 remains unverified. The Computer Use tool stopped because it could not determine the current Chrome URL; the local Vite server started, but the API and worker could not reach MongoDB under the sandbox (`EACCES`), so the dev process was stopped.

## Manual acceptance

Restart the server and Vite, open **Quản lý kênh**, choose **Thêm kênh từ YouTube**, sign in with the configured test-user Gmail, tick a channel, and confirm that its prefilled profile appears connected. Run **Đồng bộ ngay**. Change the description on YouTube or in the profile, then try **Cập nhật thông tin từ YouTube** in fill-only and selected overwrite modes. Repeat the import with a second channel/account and note which channels Google lists for each consent.

## Unverified multi-channel behavior

No real account was available, so the channels returned by `channels.list?mine=true` were not observed live. The picker works with the list the consent returns, but cannot enumerate channels Google omits. If a desired channel is absent, repeat the flow with another Google sign-in, as the UI says.
