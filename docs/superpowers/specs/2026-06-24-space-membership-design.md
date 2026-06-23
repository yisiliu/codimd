# Slice 4b — Per-space membership

**Date:** 2026-06-24
**Status:** Approved (design)
**Context:** Adds access control to shared **spaces** (Slice 2b/2c) so a member only sees spaces they belong to. Builds on Slice 4a's institute `owner` role for all-spaces oversight. Base branch `feature/institute-rbac`. Closed institute: 1 institute-owner, ~3 admins, ~20 users.

## Goal

Spaces become membership-gated. Each space has a **space steward** (`Space.createdById`) and a set of **members** (`SpaceMember`). You only see a space — and its notes — if you're a member; institute **`owner`** sees/manages every space.

### Authorization matrix (the heart of this slice)

| Action | member | **space steward** (`createdById`) | institute `owner` role |
|---|---|---|---|
| See the space + its notes in Browse | ✅ (if member) | ✅ | ✅ (every space) |
| **Invite/add** a member | ✅ any member | ✅ | ✅ (any space) |
| **Remove another** member | ❌ never | ✅ (but never the steward) | ✅ (any space, but never the steward) |
| **Leave** (remove self) | ✅ | ❌ — must transfer first | ✅ if they're a plain member |
| **Transfer** stewardship → an existing member | ❌ | ✅ | ✅ (any space) |
| **Rename / delete** the space | ❌ | ✅ | ✅ (any space) |

**Invariants:**
- Every space always has **exactly one steward** (`createdById`); it changes only via **transfer**, never via removal/leaving.
- The steward **cannot leave or be removed** — they transfer stewardship to another member first, then become a plain member who can leave.
- "Space steward" (per-space role) is distinct from the institute **`owner`** role (instance super-admin). The institute owner has steward-equivalent power on *every* space.

## What exists (reuse) — `lib/browse`

Services: `viewableWhere(userId)`, `createSpace(userId,name)`, `listSpaces()` (currently returns **all** spaces), `mutableSpace(user,spaceId)` (steward-or-owner — already correct), `renameSpace`, `deleteSpace`, `setNoteSpaces(ownerId,noteId,spaceIds)`, `spacesForNote(noteId)`, `listBrowse(userId,{space})`. Router: `GET/POST /api/spaces`, `PUT/DELETE /api/spaces/:id`, `PUT /api/notes/:id/spaces`, `GET /api/browse`. Models `Space` (`createdById`, `nameLower` unique) and `NoteSpace` (join). The `/api/*`-only, above-`/:noteId`, per-route-auth, `parseNoteIdAsync` discipline. App-level cleanup (no DB FKs).

## Data model (one migration)

- **`SpaceMember`** (`lib/models/spacemember.js`): `id` (UUID PK, `defaultValue: UUIDV4`), `spaceId`, `userId`, **`createdAt`/`updatedAt`** (timestamps on — needed for the migration's `bulkInsert`), unique index `['spaceId','userId']`. `associate`: `belongsTo(Space)` + `belongsTo(User)`, both `constraints:false` (repo convention). No reverse `hasMany` that forward-references (the Slice-2 load-order lesson). Mirror `notespace.js`'s shape exactly.
- **`Space.createdById`** is the steward (already exists, UUID); transfer = updating it.
- **Migration** `lib/migrations/<ts>-add-space-members.js`: create the `SpaceMembers` table, then **backfill** one member per existing space (= its `createdById`). **Portability (review F4):** do NOT reuse Slice-4a's `rawSelect` (it returns one scalar, not all rows) and do NOT hand-quote a raw multi-column SELECT (`createdById` folds/quotes differently per dialect — the shipped `20260618000001` migration already works around this). Instead read rows with the **model** (`require('../models').Space.findAll()` → `[{id, createdById}]`) and write with `queryInterface.bulkInsert('SpaceMembers', rows)`, where each row has an explicit `id: require('uuid').v4()` (UUIDV4 is a model marker, not an insert-time value) plus `createdAt`/`updatedAt`. `down` drops the table.

## Services (`lib/browse` extension)

Helpers: `isOwner(user)` = `user.role === 'owner'`; `isMember(userId, spaceId)` (a `SpaceMember` exists); `loadSpace(spaceId)` (404 → `space-not-found`). Authz throws map to 403 via the router's `handle` (`/not-found|forbidden/` → 403).

- `listSpaces(user)` — spaces where `isMember(user.id)` **OR** `isOwner(user)` returns all. Each: `{ id, name, count (notes), memberCount, stewardId, isSteward }`. **(Signature changes from `listSpaces()` → `listSpaces(user)`.)**
- `createSpace(userId, name)` — create the space (`createdById=userId`) **and** a `SpaceMember(userId)`. (Creator is steward + member.)
- `listMembers(user, spaceId)` — requires member-or-owner; returns `[{ id, name, isSteward }]`.
- `addMember(user, spaceId, targetUserId)` — actor must be member-or-owner; target must be an existing institute user; idempotent on the unique index. ("Invite": any member.)
- `removeMember(user, spaceId, targetUserId)` — compare ids with `String(targetUserId) === String(user.id)` (repo convention — `req.params.userId` is a string; review F2):
  - **Leaving** (self): allowed if actor is a member and **not the steward** (`forbidden` if steward — "transfer stewardship first").
  - **Removing another**: actor must be **steward-or-owner**; the target **must not be the steward** (`forbidden`) — protects the exactly-one-steward invariant.
- `transferSteward(user, spaceId, targetUserId)` — actor must be **steward-or-owner**; target must be a **current member**; set `Space.createdById = targetUserId`. (Old steward stays a member.)
- `mutableSpace`/`renameSpace`/`deleteSpace` — unchanged (steward-or-owner). `deleteSpace` also removes the space's `SpaceMember` rows (app-level cleanup, alongside the existing `NoteSpace` cleanup).
- `setNoteSpaces(ownerId, noteId, spaceIds)` — **filter `spaceIds` to spaces the owner is a member of** (you can only file a note into spaces you belong to). **Reconcile only within the owner's member-spaces (review F5):** the current impl `destroy`s *all* of the note's `NoteSpace` rows then re-inserts — that would wipe a legacy link to a space the owner isn't a member of. Instead scope the destroy to `{ noteId, spaceId: { [Op.in]: memberSpaceIds } }`, then insert the filtered desired set. This keeps non-member-space links intact (consistent with the edge-case below).
- `listBrowse(userId, {space})` — restrict to spaces the viewer is a member of (or all, if owner), then the existing note-permission filter on top.
- `listUsers()` — active institute users `[{ id, name }]`, name = `(User.getProfile(u) || {}).name || u.email` (review F6 — `getProfile` returns `null` for a user with neither profile nor email; null-guard it). Filter on `User.active`.

## API (router additions in `lib/browse`)

| method + path | who | purpose |
|---|---|---|
| `GET /api/spaces` | member (owner sees all) | now `listSpaces(req.user)` |
| `GET /api/spaces/:id/members` | member or owner | list members |
| `POST /api/spaces/:id/members` `{userId}` | any member or owner | add a member |
| `DELETE /api/spaces/:id/members/:userId` | self-leave (non-steward) / steward / owner | remove per the matrix |
| `PUT /api/spaces/:id/steward` `{userId}` | steward or owner | transfer stewardship |
| `GET /api/users` | any signed-in member | `[{id,name}]` for the picker |

Unchanged routes keep working; `GET /api/browse` and `PUT /api/notes/:id/spaces` gain the membership gate via their services.

## UI (`public/views/dashboard.ejs` + `public/js/dashboard.js`)

- **Browse sidebar** already renders `listSpaces` — now it only shows member-spaces (owners see all). Add a **"Members"** (people icon) button per space.
- **Members modal** (Bootstrap-3, reuse the template-modal pattern): lists members with a **steward badge**; for each *other* member a **remove ×** (shown only to the steward/owner); a **"Leave"** action for yourself (hidden for the steward); an **add-member picker** (a `<select>`/typeahead from `GET /api/users`, excluding current members) available to any member; and a **"Make steward"** action per member (shown only to the steward/owner) that calls transfer.
- **My-Notes `+ space` picker** lists only spaces you're a member of (from the now-filtered `listSpaces`); inline-create still works and adds you as steward+member.
- Keep labels clear: "space steward" (not "owner").

## Behaviour & edge cases

- Adding an already-member is a no-op (unique index). Removing a non-member → `not-found`→403/404.
- A space with **0 members** is possible only transiently (the steward can't leave), so in practice ≥1 (the steward). If the steward deletes the space, its members + NoteSpaces are cleaned up.
- A note already in a space whose owner isn't a member stays in the space (membership gates *visibility of the space*, not retroactive note removal); the owner just won't see that space in their own Browse.
- Transfer to a non-member → `forbidden` (must be a current member first).
- Institute `owner` acting on a space they're not a member of: allowed (oversight) — `listMembers`/add/remove/transfer/rename/delete all admit `isOwner`.

## Testing (mocha + power-assert + sqlite `:memory:`; services + HTTP harness)

- **Model:** `SpaceMember` unique `[spaceId,userId]`; duplicate add rejected/no-op.
- **Visibility:** `listSpaces` returns only the viewer's member-spaces; an institute owner sees all; `listBrowse` hides notes in non-member spaces even when permission would allow.
- **The matrix (the core):** add by any member ✅; remove-other by a plain member ❌(403); remove-other by steward ✅; self-leave by member ✅; steward self-leave ❌(403, "transfer first"); remove-the-steward ❌; transfer by steward to a member ✅, to a non-member ❌; transfer/rename/delete by institute owner on a space they don't belong to ✅.
- `setNoteSpaces` drops space-ids the owner isn't a member of.
- `deleteSpace` removes the space's `SpaceMember` rows.
- **HTTP harness:** the member endpoints with `buildApp({id,role,active})` — 401 anon; the matrix 403s; `GET /api/users` lists active users.
- **Migration:** backfill inserts one `SpaceMember` per existing space (= its `createdById`).
- Seed real `User`s (FK) + a steward; notes need content where titles are asserted.
- **Update `test/browse/spaces.test.js:29`** for the new `listSpaces(user)` signature (review F1 — the only existing caller besides the router).

## Files (approximate)

- `lib/models/spacemember.js`; `lib/migrations/<ts>-add-space-members.js`.
- `lib/browse/index.js` (services above + 4 routes); `lib/note/index.js` (`cleanupNoteOrganization` already clears NoteSpace — no change needed; confirm space-delete path).
- `public/views/dashboard.ejs` + `public/js/dashboard.js` (Members modal, steward badge, transfer/leave/add, `+space` picker filtered).
- `test/models/spacemember.test.js`, `test/browse/membership.test.js`, `test/http/space-members.test.js`, `test/migrations/space-members.test.js`.
- `docs/manual-test-guide.md`, CLAUDE.md.

## Out of scope

Per-note (vs per-space) sharing; member roles beyond steward/member; join-requests/approval flows; notifications on add/remove; cross-space bulk ops. (Inline comments remain Slice 3b.)

## Open questions for planning

- `GET /api/users` shape — `{id,name}` only (no email) vs include email for disambiguation (lean: `{id, name}` where name falls back to email).
- Whether the add-member picker is a simple `<select>` of all non-member users vs a typeahead (lean: `<select>` — ≤23 users).
- Confirm `listSpaces(user)` signature change doesn't break other callers (grep — only the dashboard/router call it).
