# Module: channel

**Purpose:** Store and manage reusable YouTube channel profiles assigned to projects.
**Owns collection(s):** `channels`
**May import (via their index.ts only):** project.
**Public API:** `createChannelRouter`, `assertChannelExists`, CRUD service functions, and `ensureChannelIndexes`, exported from `index.ts`.

## Invariants

- Channel API documents are strict and contain only the profile fields in `contracts/channel.ts`; Mongo documents add only `_id`, `schemaVersion`, and `nameSearch`.
- `nameSearch` is trimmed, accent-stripped, `đ`-normalized, whitespace-collapsed, and lowercased. A unique index enforces case-insensitive name uniqueness; service checks return `409 CHANNEL_NAME_TAKEN` before insert/update.
- `defaultHashtags` are normalized through the shared SEO hashtag normalizer and capped at five values. Profile links accept only HTTP or HTTPS URLs.
- `publishSchedule` is stored as an optional nullable placeholder with a `null` default for legacy-safe reads.
- Channel deletion calls `project.countProjectsByChannelId` through the public project index. The channel module never reads the `projects` collection directly; a referenced channel returns `409 CHANNEL_IN_USE` with the project count.
- The project module remains import-free. `assertChannelExists` is injected into the project router from the public channel API and is used for create and assignment requests.
- `GET`, `POST`, `GET/:id`, `PATCH/:id`, and `DELETE/:id` are mounted under `/api/channels` by `app.ts`.

## Client flow

- `features/channel/api.ts` and `hooks.ts` own channel list/detail and CRUD requests; `useChannel(id)` loads an assigned profile for SEO, and successful channel writes invalidate the channel query.

- `features/channel/api.ts` and `hooks.ts` own channel list and CRUD requests; successful channel writes invalidate the channel query.
- The create-project form remembers its last selected channel in local storage when available. The SEO page owns the project's channel selection through the project mutation and invalidates channel, project-detail, and project-list queries.
- Channel management uses a native `<dialog>`. The history-channel template only prefills the editor and never saves automatically.

## Known gaps

- `publishSchedule` and `thumbnailTemplate` are persisted for later SEO tasks; only the template is editable in this task, and schedule rules/UI are reserved for Task 110.
- Browser acceptance is recorded in the Task 108 report; any unavailable step is explicitly marked unverified there.
