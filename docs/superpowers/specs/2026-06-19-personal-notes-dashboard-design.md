# Slice 2a — Personal Notes Dashboard: folders, user-tags, complete "My Notes" view

**Date:** 2026-06-19
**Status:** Approved (design) — revised after adversarial review (architecture-fit + scope/correctness)
**Context:** Second feature for the institute deployment of CodiMD (3 teachers + ~20 grad students), building on Slice 1 (closed instance, roles, invites — `feature/institute-access-slice1`). Note-organization work is prioritized **(1) personal organization → (2) course/project spaces → (3) shared institute-wide browse.** This spec covers (1) only.

## Goal

Give each signed-in member a real **Notes Dashboard** as their home: one place showing *everything they own*, grouped into flat **folders**, labelled with **user-tags** they apply without editing the note body, with live **search/sort** and **pin**. Replaces "my notes are a flat pile of cryptic URLs and a visited-only History tab."

## What already exists (reuse, don't rebuild)

- **Owned-notes listing**: `getMyNoteList(userId)` (`/api/notes/myNotes`, `lib/note/index.js:194`) returns owned notes as `{ id (encoded), text: title, tags (frontmatter), createdAt, lastchangeAt, shortId }`. **We extend this**, not duplicate it.
- **`list.js`** client lib (used by the cover History tab) gives keyword search + sort for free — reuse on the dashboard.
- **Signed-in home**: `lib/homepage` `showIndex` (`:10`) already branches on `req.isAuthenticated()` and passes `csrfToken`; signed-out renders the dark cover/landing (`index.ejs`).
- **Frontmatter tags** (`Note.parseNoteInfo(content).tags`) exist but are NOT surfaced in the dashboard (see "Tags" below) to avoid two competing tag systems.

## Decisions (locked during brainstorming + review)

- **Folders**: flat (one level); a note lives in at most **one** folder; **many** user-tags per note.
- **Dashboard placement**: the **signed-in home page**. Signed-out users still see today's cover/landing. The visited-History UI is no longer shown to signed-in users; `User.history` JSON stays (still written on visits) but becomes vestigial — we do NOT depend on it.
- **Scope**: a member's **own** notes only. Shared/institute-wide browse is a later slice.
- **No database-level FK cascades.** This repo declares all associations `constraints: false` (no FK DDL), tests `sync()` from models (migrations never run in CI), and SQLite doesn't enforce FKs — so DB-level `ON DELETE` is a test-passes/prod-breaks trap. **All cleanup is explicit, app-level, owner-scoped.**

## Data model (one migration set)

- **`Folder`** (`lib/models/folder.js`): `id` UUID pk, `ownerId` UUID (`constraints: false`, matching repo style), `name` STRING (non-empty), timestamps. Unique index on (`ownerId`, `name`).
- **`NoteTag`** (`lib/models/notetag.js`): `id` UUID pk, `noteId` UUID, `tag` STRING (normalized: trimmed + lowercased, non-empty). Unique index on (`noteId`, `tag`).
- **`Note` gains two nullable, owner-personal columns** (same shape/justification as the existing `ownerId` — a note has exactly one owner): `folderId` UUID nullable; `pinned` BOOLEAN default `false`. **Pin lives here, not in the history JSON** — so it works for every owned note including never-visited ones (the history path 404s on notes with no visit entry).
- Associations (all `constraints: false`): `Note.belongsTo(Folder, { foreignKey: 'folderId' })`; `Folder.hasMany(Note)`; `Note.hasMany(NoteTag, { foreignKey: 'noteId' })`.

**Migration ↔ model lockstep:** because the suite syncs from model definitions, the migration file is never exercised by tests. Keep the migration's column/index definitions identical to the models, and verify the migration once by hand against a scratch DB (`sequelize db:migrate`).

## Cleanup (explicit, app-level — no FK cascade)

- **Folder delete**: `Note.update({ folderId: null }, { where: { folderId: id, ownerId: me } })`, then destroy the folder. Notes orphan to "Unfiled"; never deleted.
- **Note delete**: the existing `deleteNote` (`lib/note/index.js:236`) uses **bulk** `Note.destroy({where})`, so add an explicit `NoteTag.destroy({ where: { noteId } })` alongside it. (`folderId`/`pinned` are columns on the note, so they vanish with it.)

## API

Extend the existing endpoint; add folder/tag/pin endpoints in a new `lib/dashboard/` controller. **Mounting (Slice-1 lesson):** mount above the `/:noteId` catch-all (`lib/routes.js:90`) and, if using a sub-router, path-scope any guard — a bare `router.use(guard)` on a root-mounted router leaks onto every later route (the Slice-1 `/admin` bug; the fix pattern is `router.use('/path', guard)` per `lib/admin/index.js`). Every mutation is **owner-guarded** (`note.ownerId === req.user.id`, `folder.ownerId === req.user.id`); all require auth. **No csurf** — mirror the existing `/api/notes/*` and `/history` endpoints, which rely on session auth only (verified: they attach no csurf).

| method + path | purpose |
|---|---|
| `GET /api/notes/myNotes` (extend `getMyNoteList`) | owned notes, each `{ id, text: title, userTags, folderId, pinned, createdAt, lastchangeAt, shortId }` |
| `GET /api/folders` | my folders (note counts computed in app, not SQL) |
| `POST /api/folders` / `PUT /api/folders/:id` / `DELETE /api/folders/:id` | create / rename / delete (delete orphans members to Unfiled per cleanup above) |
| `PUT /api/notes/:id/folder` | body `{ folderId }` or null — file/unfile; verify the note AND target folder are both mine |
| `POST /api/notes/:id/tags` / `DELETE /api/notes/:id/tags/:tag` | add (normalized, dedup) / remove a user-tag |
| `PUT /api/notes/:id/pin` | body `{ pinned }` — set the note's pin flag |

## Tags (one concept, to avoid confusion)

The dashboard exposes **only user-tags** (the new editable `NoteTag`). Frontmatter `tags:` are intentionally NOT shown in the dashboard — surfacing both an editable and a read-only tag set side by side is the confusion the review flagged. (Frontmatter tags keep working inside notes; they're just not part of the dashboard's tag UI.) This still delivers the requested "tag without editing the note body."

## Dashboard UI (signed-in home)

When `req.isAuthenticated()`, `showIndex` renders a new `dashboard` view (else `index.ejs`). CodiMD-styled via the `index/head` cover-CSS chrome (Slice-1 view-chrome lesson). Layout:

- **Folders sidebar**: `All notes`, `Unfiled`, and each folder with its note count; create / rename / delete controls.
- **Notes list** on `list.js` (keyword search + sort-by-title/time as today). Each row: title, current folder, user-tag chips (removable), a pin toggle, and a "move to folder" control — all acting via the API without opening the note.
- **Tag filter** (user-tags) + search box.
- **Empty state**: a brand-new user with zero notes sees `All notes (0)` / `Unfiled` plus a friendly "No notes yet" message and a **New note** button. Zero-folder users just see All/Unfiled.

Client JS in `public/js/` bundled by webpack — reuse the existing `index`/`cover` entry rather than adding a new bundle (avoid build-config churn); rebuild after changes.

## Behaviour & edge cases

- **Owner-only**: organizing a note or folder you don't own → 403. Tested.
- **Editor-created notes** appear automatically (the list is `WHERE ownerId = me`, independent of any organize action).
- **Anonymous notes** (no owner) never appear in any dashboard.
- **Folder delete** orphans notes to Unfiled (app-level update); **note delete** removes its NoteTag rows (app-level).
- **Tag normalization**: trim + lowercase; `(noteId, tag)` unique → re-adding is a no-op.

## Testing (mocha + power-assert + sqlite `:memory:`, per Slice 1; service-layer on the real in-memory DB)

- `Folder`: unique (ownerId,name); create/rename/delete.
- `NoteTag`: normalization + (noteId,tag) uniqueness.
- `Note.folderId`/`pinned`: default unfiled/unpinned; set/clear.
- **Cleanup**: folder delete sets member notes' `folderId` to null (notes survive); note delete removes its NoteTag rows. (Both are app-level, so they're actually exercised under `sync()` — unlike DB FK cascades.)
- Extended `getMyNoteList`: returns all owned notes with `folderId` + `userTags` + `pinned`; excludes other owners' notes.
- Owner-only guards: filing/tagging/pinning another user's note refused; folder CRUD on another user's folder refused.
- (HTTP middleware is not unit-covered — Slice 1 lesson — so keep route mounting simple/explicit; a deeper HTTP harness is a deferred follow-up the user deprioritized.)

## Out of scope (later slices / deferred)

Shared/institute-wide browse (priority #3), course/project spaces (#2), nested folders, organizing notes you don't own, collaborative/shared folders, and surfacing frontmatter tags in the dashboard.

## Files (approximate)

- `lib/models/folder.js`, `lib/models/notetag.js` (new); `lib/models/note.js` (add `folderId` + `pinned` + associations); `lib/migrations/<ts>-add-folders-tags-note-org.js`.
- `lib/dashboard/index.js` (new controller + service functions); `lib/note/index.js` (extend `getMyNoteList`; add `NoteTag` cleanup to `deleteNote`); `lib/routes.js` (mount).
- `lib/homepage/index.js` (render dashboard when signed in); `public/views/dashboard.ejs` (+ partials).
- `public/js/dashboard.js` (or extend `index.js`).
- `test/models/folder.test.js`, `test/models/notetag.test.js`, `test/dashboard/*.test.js`.
- Docs: brief CLAUDE.md note once built.

## Open questions for planning

- Exact field name in the extended `getMyNoteList` (`text` vs `title`) — keep `text` for `list.js` compatibility unless the dashboard JS wants `title`.
- Whether the pin/folder/tag endpoints live under `lib/dashboard/` or extend `lib/note/` — lean toward a dedicated `lib/dashboard/` module for clarity, with the `getMyNoteList` extension staying in `lib/note`.
