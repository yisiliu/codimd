# Slice 2a — Personal Notes Dashboard: folders, user-tags, complete "My Notes" view

**Date:** 2026-06-19
**Status:** Approved (design)
**Context:** Second feature for the institute deployment of CodiMD (3 teachers + ~20 grad students), building on Slice 1 (closed instance, roles, invites — `feature/institute-access-slice1`). The user prioritized note-organization work as: **(1) personal organization → (2) course/project spaces → (3) shared institute-wide browse.** This spec covers (1) only. (2) and (3) get their own specs later.

## Goal

Give each signed-in member a real **Notes Dashboard** as their home: one place showing *everything they own*, grouped into flat **folders**, labelled with **user-tags** they apply without editing the note body, with the **pin / search / sort** that already exist. Replaces "my notes are a flat pile of cryptic URLs and a visited-only History tab."

## What already exists (reuse, don't rebuild)

- **Per-user History** (`lib/history`, `public/js/history.js`): a browser-synced list of *visited* notes (`User.history` JSON) with a `pinned` flag (`POST /history/:noteId` with `pinned`), client-side **tag filter + keyword search + sort** via `list.js` on the cover page's History tab.
- **Frontmatter tags**: `Note.parseNoteInfo(note.content).tags` parses `tags:` from the note body.
- **Owned-notes listing**: `getMyNoteList(userId)` (`/api/notes/myNotes`) returns owned notes as `{ id (encoded), text: title, tags (frontmatter), createdAt, lastchangeAt, shortId }`.
- **Signed-in home**: `lib/homepage` `showIndex` renders `index.ejs` with a `signin` flag; signed-out shows the dark cover/landing.

The genuine gaps: (a) History shows only *visited* notes, not everything owned; (b) tags require editing the note body; (c) no folders; (d) no prominent dashboard surface.

## Decisions (locked during brainstorming)

- **Folders**: flat (one level); a note lives in at most **one** folder; **many** tags per note.
- **Dashboard placement**: the **signed-in home page**. Signed-out users still see today's cover/landing.
- **Scope**: a member's **own** notes only. Shared/institute-wide browse is a later slice.
- **Pinning**: keep using the existing history `pinned` flag — not rebuilt.

## Data model (one migration set)

- **`Folder`** (`lib/models/folder.js`): `id` UUID pk, `ownerId` UUID FK → User (`constraints: false`, matching repo style), `name` STRING (non-empty), `createdAt`/`updatedAt`. A user's flat folders. Unique on (`ownerId`, `name`) so a user can't have two folders with the same name.
- **`NoteTag`** (`lib/models/notetag.js`): `id` UUID pk, `noteId` UUID FK → Note (`onDelete: CASCADE`), `tag` STRING (non-empty, normalized: trimmed, lowercased). Unique on (`noteId`, `tag`). User-applied tags stored outside the note body.
- **`Note.folderId`**: nullable UUID FK column added to the existing `Notes` table (a note has exactly one owner, so its folder is that owner's — same shape as the existing `ownerId`). **`ON DELETE SET NULL`** so deleting a folder orphans its notes to "Unfiled", never deletes notes.

Associations: `User.hasMany(Folder, { foreignKey: 'ownerId' })`; `Folder.hasMany(Note, { foreignKey: 'folderId' })` / `Note.belongsTo(Folder)`; `Note.hasMany(NoteTag, { foreignKey: 'noteId' })`.

## API

New controller module `lib/dashboard/` mounted in `lib/routes.js`. **Mounting lesson from Slice 1:** mount with an explicit path prefix and/or path-scoped guards — a bare `router.use(authGuard)` on a root-mounted router leaks onto every later route. Prefer `appRouter.use('/api', require('./dashboard'))` with routes relative to `/api`, OR per-route guards; place above the `/:noteId` catch-all. Every mutation is **owner-guarded**: only `note.ownerId === req.user.id` (and for folders, `folder.ownerId === req.user.id`) may organize. All require authentication.

| method + path | purpose |
|---|---|
| `GET /api/dashboard/notes` | every note `WHERE ownerId = me`, each with `{ id, title, frontmatterTags, userTags, folderId, pinned, createdAt, lastchangeAt, shortId }` |
| `GET /api/folders` | my folders with note counts |
| `POST /api/folders` | create a folder (name; reject blank/duplicate) |
| `PUT /api/folders/:id` | rename |
| `DELETE /api/folders/:id` | delete (members orphan to Unfiled via FK SET NULL) |
| `PUT /api/notes/:id/folder` | body `{ folderId }` (or null) — file/unfile; verify both the note and the target folder are mine |
| `POST /api/notes/:id/tags` | body `{ tag }` — add a normalized user-tag (dedup) |
| `DELETE /api/notes/:id/tags/:tag` | remove a user-tag |

CSRF: these are JSON/fetch endpoints called by the dashboard's own client JS. Follow CodiMD's existing pattern for its `/api/notes/*` and `/history` endpoints (which are not csurf-protected and rely on session auth); match whatever those do rather than inventing a new scheme. Confirm during planning.

## Dashboard UI (signed-in home)

When `req.isAuthenticated()`, `showIndex` renders a new `dashboard` view instead of the cover History; signed-out still renders `index.ejs`. The dashboard is a CodiMD-styled page (reuse the `index/head` cover CSS chrome — see the Slice 1 view-chrome lesson) with:

- A **folders sidebar**: `All notes`, `Unfiled`, and each folder with a live note count; create / rename / delete controls.
- A **notes list** built on CodiMD's `list.js` (so keyword search, sort-by-title/time, and pin all work as they do today). Each row shows title, folder, user-tags (removable chips) + frontmatter tags (read-only), pin toggle, and a "move to folder" control.
- A **tag filter** and a **search box** (list.js).
- All organize actions (create folder, move note, add/remove tag, pin) hit the API above and update in place — **no need to open the note**.

Client JS lives in `public/js/` and is bundled by webpack into the existing `index`/`cover` entry (or a new `dashboard` entry) — rebuild the bundle after changes.

## Behaviour & edge cases

- **Owner-only**: organizing a note or folder you don't own → 403/blocked. Tested.
- **Folder delete**: notes inside become Unfiled (FK `SET NULL`); notes are never deleted.
- **Tag normalization**: trim + lowercase; `(noteId, tag)` unique → adding an existing tag is a no-op.
- **Completeness**: the list is `ownerId = me` (all owned notes), independent of the visited-History; pin state is read from history (a never-visited note is simply unpinned).
- **Anonymous notes** (no owner) never appear in anyone's dashboard.

## Testing (mocha + power-assert + sqlite `:memory:`, per Slice 1)

- `Folder` model: unique (ownerId,name); create/rename/delete.
- `NoteTag`: normalization + (noteId,tag) uniqueness; cascade delete with the note.
- `Note.folderId`: FK `SET NULL` on folder delete (note survives, folderId null).
- Dashboard query: returns all owned notes with folder + userTags + frontmatterTags + pinned; excludes notes owned by others.
- Owner-only guards: filing/tagging another user's note is refused; CRUD on another user's folder is refused.
- Service-layer tests like Slice 1 (exercise exported functions on the real in-memory DB). NOTE: Slice 1 surfaced that unit tests bypass HTTP middleware — keep route **mounting** simple and explicit; a deeper HTTP-level harness is a deferred follow-up (user deprioritized it).

## Files (approximate)

- `lib/models/folder.js`, `lib/models/notetag.js` (new); `lib/models/note.js` (add `folderId` + associations); `lib/migrations/<ts>-create-folder-notetag-and-note-folderid.js`.
- `lib/dashboard/index.js` (new controller + service functions); `lib/routes.js` (mount).
- `lib/homepage/index.js` (render dashboard when signed in); `public/views/dashboard.ejs` (+ partials).
- `public/js/dashboard.js` (or extend `index.js`); webpack entry wiring if a new bundle.
- `test/models/folder.test.js`, `test/models/notetag.test.js`, `test/dashboard/*.test.js`.
- Docs: brief note in CLAUDE.md once built.

## Open questions for planning

- Exact CSRF stance for the new `/api/*` endpoints — mirror existing `/api/notes/*` and `/history`.
- Whether to add a new `dashboard` webpack entry or extend the existing `index`/`cover` bundle (lean: reuse to avoid build-config churn).
- Whether folder note-counts are computed in SQL (GROUP BY) or in the app after the notes query (lean: one notes query + count in app for simplicity at this scale).
