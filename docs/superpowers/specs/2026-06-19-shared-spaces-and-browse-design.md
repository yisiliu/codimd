# Slice 2b/2c — Shared Spaces & Browse

**Date:** 2026-06-19
**Status:** Approved (design)
**Context:** Third feature for the institute deployment of CodiMD (3 teachers + ~20 grad students). Follows Slice 1 (closed access) and Slice 2a (personal notes dashboard). The note-organization roadmap was prioritized **personal → spaces → shared browse**; this spec covers the last two, unified into one slice. Builds on the dashboard (merged to `develop`) and the HTTP test harness + server-side note-id parsing (on `feature/dashboard-hardening`, this branch's base).

## Goal

Let members **share and discover** the lab's notes without a membership/access-control subsystem: any member creates flat **Spaces** (shared collections like "ML-Course", "Lab-Meetings"); a note's **owner opts it in** by adding it to spaces; a **Browse** view lists the spaces' notes that the viewer is permitted to see. Access stays governed by each note's existing `permission`.

## Decisions (locked during brainstorming)

- **Organization & discovery, not access control.** No space membership, no per-space permissions. Visibility is the note's own `permission` (`['freely','editable','limited','locked','protected','private']`, `lib/models/note.js:27`).
- **Opt-in.** A note appears in Browse only when its owner adds it to a space — never auto-listed.
- **Any member** can create spaces. Deleting a space (a shared label others use) is restricted to its **creator or a teacher**.
- **Many spaces per note** (a note can surface under several courses/projects).

## Data model (one migration set)

- **`Space`** (`lib/models/space.js`): `id` UUID pk, `name` STRING (non-empty, **unique across the instance** — shared namespace), `createdById` UUID (`constraints: false`), timestamps. Unique index on `name` (normalize: trim; keep original case for display but compare case-insensitively — store a `name` plus a `nameLower` unique index, or lowercase the stored name; **decision: store trimmed name, unique index on a lowercased value** to avoid "ML"/"ml" duplicates).
- **`NoteSpace`** (`lib/models/notespace.js`): `id` UUID pk, `noteId` UUID, `spaceId` UUID. Unique index on (`noteId`, `spaceId`). The owner's opt-in link; many-to-many.
- Associations (`constraints: false`): `Note.hasMany(NoteSpace)`, `Space.hasMany(NoteSpace)`, `NoteSpace.belongsTo(Note)`/`belongsTo(Space)`.

**No DB foreign keys** (repo-wide; sqlite tests sync from models and don't enforce FKs). All cleanup is explicit, app-level.

## Cleanup (app-level)

- **Space delete:** `NoteSpace.destroy({ where: { spaceId } })`, then destroy the space. (Notes are untouched.)
- **Note delete:** extend `cleanupNoteOrganization(noteId)` (`lib/note/index.js:230`, already removes `NoteTag`) to also `NoteSpace.destroy({ where: { noteId } })`.

## API

New controller `lib/browse/` (or extend `lib/dashboard`), mounted above the `/:noteId` catch-all with **only `/api/*` routes** and **per-route auth** (no root-level `router.use` — the Slice-1 leak lesson; covered by the HTTP harness). Note ids arrive **base64url-encoded** and are parsed server-side via `Note.parseNoteIdAsync` (the Slice-2a hardening pattern — the client must not decode).

| method + path | who | purpose |
|---|---|---|
| `GET /api/spaces` | any member | list spaces, each with a **viewable**-note count |
| `POST /api/spaces` | any member | create (name; reject blank/duplicate, case-insensitive) |
| `DELETE /api/spaces/:id` | creator **or** teacher | delete (removes its NoteSpace links; notes untouched) |
| `PUT /api/notes/:id/spaces` | note **owner** | set the note's spaces (body `{ spaceIds: [...] }`); owner-guarded |
| `GET /api/browse?space=&q=` | any member | notes in a space that the viewer may see, with owner name + spaces |

**Browse visibility filter:** a categorized note is listed for viewer `me` iff `permission != 'private' OR ownerId = me`. (All non-private permissions are logged-in-viewable; the instance is closed. Anonymous never reaches these routes.) Search/space-filter applied on top.

**Teacher check** for space delete reuses Slice-1's role (`req.user.role === 'teacher'`); creator check compares `space.createdById`.

## UI (signed-in home)

Add a **"My Notes" ⇄ "Browse"** toggle to the dashboard (`public/views/dashboard.ejs` + `public/js/dashboard.js`, reusing the cover chrome + `list.js`):

- **Browse view:** a spaces sidebar (`All shared`, each space + viewable-note count, create-space control); a notes list showing **owner name**, title (opens the note in a new tab), the note's spaces, and a search + space filter. Read-only — you open notes; their own permission governs editing.
- **My Notes view:** each note row gains a **"spaces"** control (multi-select / chips) so the owner opts the note into shared spaces (`PUT /api/notes/:id/spaces`). Distinct from the existing personal user-tags (private) and folder (private, one).
- **Empty states** for both (no spaces yet / no shared notes yet).

## Behaviour & edge cases

- **Opt-in only:** notes never appear in Browse unless their owner added them to a space.
- **Permission respected:** a note made private after being added to a space simply stops appearing to others (filtered at browse time); it still shows to its owner.
- **Owner-only** note↔space assignment; **creator-or-teacher** space delete; **any member** space create.
- **Space name dedup:** case-insensitive unique; creating an existing name returns the existing one (or a friendly 400) rather than a raw DB error.
- **Counts** in the spaces sidebar are *viewable* counts for the current user (computed in app from the browse query, not raw totals).

## Testing (mocha + power-assert + sqlite `:memory:`; service-level + HTTP harness)

- `Space`: case-insensitive unique name; create/delete.
- `NoteSpace`: (noteId, spaceId) uniqueness; owner-guarded assignment refuses another user's note (403 via HTTP).
- Cleanup: space delete removes NoteSpace links (notes survive); note delete removes its NoteSpace links.
- Browse query: returns categorized notes for the viewer; **excludes private notes owned by others**; includes the viewer's own private note; space + keyword filter.
- Space delete authz: creator allowed; teacher allowed; unrelated member refused (403).
- **HTTP harness** (`test/helpers/httpApp.js`): anon → 401 on `/api/spaces`/`/api/browse`; cross-owner `PUT /api/notes/:id/spaces` → 403; browse hides another owner's private note.

## Files (approximate)

- `lib/models/space.js`, `lib/models/notespace.js` (new); `lib/models/note.js` (associations); `lib/migrations/<ts>-add-spaces.js`.
- `lib/browse/index.js` (new: space + browse services + router) — or extend `lib/dashboard`; `lib/note/index.js` (extend `cleanupNoteOrganization`); `lib/routes.js` (mount).
- `public/views/dashboard.ejs` (My Notes ⇄ Browse toggle + Browse markup); `public/js/dashboard.js` (browse rendering + space assignment).
- `test/models/space.test.js`, `test/browse/*.test.js`, `test/http/browse.test.js`.
- CLAUDE.md note once built.

## Out of scope (deferred)

Space membership and per-space access control; nested spaces; following/subscriptions/notifications; renaming spaces (v1: create + delete only — add rename later if needed); cross-instance/multi-lab isolation.

## Open questions for planning

- Whether `lib/browse` is its own module or part of `lib/dashboard` (lean: dedicated `lib/browse` for clarity; share the owner-guard helpers).
- Space-name storage for case-insensitive uniqueness (lowercased `name` vs separate `nameLower` index) — pick the simplest the sqlite+postgres unique index supports.
- Owner display name in Browse: reuse `User.getProfile(...).name` (the existing avatar/name helper) so rows show a human name, not a UUID.
