# Slice 2b/2c — Shared Spaces & Browse

**Date:** 2026-06-19
**Status:** Approved (design) — revised after adversarial review (architecture-fit + scope/product)
**Context:** Third feature for the institute deployment of CodiMD (3 teachers + ~20 grad students). Follows Slice 1 (closed access) and Slice 2a (personal notes dashboard). Unifies the planned "course/project spaces" + "shared browse". Builds on the dashboard (merged to `develop`) and the HTTP test harness + server-side note-id parsing (base branch `feature/dashboard-hardening`).

## Goal

Let members **share and discover** the lab's notes without a membership/access-control subsystem: any member creates flat **Spaces** (shared collections like "ML-Course"); a note's **owner opts it in** by adding it to spaces; a **Browse** view lists the spaces' notes the viewer is permitted to see. Access stays governed by each note's existing `permission`.

## Decisions (locked during brainstorming + review)

- **Organization & discovery, not access control.** No membership, no per-space permissions. Visibility = the note's `permission` (`['freely','editable','limited','locked','protected','private']`, `lib/models/note.js:27`).
- **Opt-in.** A note is in Browse only when its owner adds it to a space.
- **Any member** creates spaces. **Creator or teacher** may rename/delete a space (mutating a shared label others rely on is a curation action — the teacher gate also covers a creator who has left the lab). *(This keeps a small gate on shared-space mutations; a reviewer argued for any-member delete for simplicity, but deleting a space wipes everyone's opt-in links, so we keep the gate.)*
- **Many spaces per note** (the join table is required for opt-in anyway).
- **Three organizing axes are intentional and must be labeled in the UI:** private **folder** (one/note), private **tag** (many/note), shared **space** (many/note). The private/shared split is the point of this slice — say "Private tag" vs "Shared space" wherever both appear.

## Data model (one migration set)

- **`Space`** (`lib/models/space.js`): `id` UUID pk, `name` STRING (trimmed, non-empty — kept for display), `nameLower` STRING (set in `beforeValidate` = `name.trim().toLowerCase()`), `createdById` UUID (`constraints: false`), timestamps. **Unique index on `['nameLower']`** (plain-column index — matches the repo idiom; a functional/expression index on a lowercased value does NOT sync on the sqlite test engine). This gives case-insensitive uniqueness while preserving display case.
- **`NoteSpace`** (`lib/models/notespace.js`): `id` UUID pk, `noteId` UUID, `spaceId` UUID. Unique index on `['noteId','spaceId']`. The owner's opt-in link; many-to-many.
- Associations (`constraints: false`): `Note.hasMany(NoteSpace)`, `Space.hasMany(NoteSpace)`, `NoteSpace.belongsTo(Note)`/`belongsTo(Space)`.

**No DB foreign keys** (repo-wide; sqlite tests sync from models). All cleanup is explicit, app-level.

## Cleanup (app-level)

- **Space delete:** `NoteSpace.destroy({ where: { spaceId } })`, then destroy the space. Notes untouched.
- **Note delete:** extend `cleanupNoteOrganization(noteId)` (`lib/note/index.js:230`) to also `NoteSpace.destroy({ where: { noteId } })`. (Add `NoteSpace` to the destructured `require('../models')` at `lib/note/index.js:5`.)

## API

New controller `lib/browse/index.js`, mounted **above** the `/:noteId` catch-all with **only `/api/*` routes** and **per-route auth** (no root-level `router.use` — the Slice-1 leak lesson; HTTP-harness covered). Note ids arrive **base64url-encoded** → parse server-side via `Note.parseNoteIdAsync` (the client must not decode).

| method + path | who | purpose |
|---|---|---|
| `GET /api/spaces` | any member | list spaces, each with a **raw count of non-private notes** (one count for everyone — a per-viewer count would leak that hidden private notes exist) |
| `POST /api/spaces` | any member | create (name; reject blank; case-insensitive dedup → return the existing space or a friendly 400, not a raw DB error) |
| `PUT /api/spaces/:id` | creator **or** teacher | rename (same dedup check) — **shipped in v1**: a typo in a shared label otherwise needs every owner to re-file |
| `DELETE /api/spaces/:id` | creator **or** teacher | delete (removes its NoteSpace links; notes untouched) |
| `PUT /api/notes/:id/spaces` | note **owner** | set the note's spaces (`{ spaceIds: [...] }`); owner-guarded; **filter spaceIds to spaces that exist** (no FKs); empty array clears all the note's links |
| `GET /api/browse?space=&q=` | any member | notes in a space the viewer may see, with owner display name + spaces |

**Browse visibility filter (NULL-safe):** list a categorized note for viewer `me` iff `(permission IS NULL OR permission != 'private') OR ownerId = me`. Verified against `newCheckViewPermission` (`lib/response.js`): every non-private permission is logged-in-viewable; `private` is owner-only. The `IS NULL` guard matches the JS helper's treatment of legacy NULL-permission rows.

**Authz checks:** teacher = `req.user.role === 'teacher'` (Slice-1; `deserializeUser` puts role on `req.user` and already guarantees `active`). Creator = `space.createdById === req.user.id`. Owner display name via `User.getProfile(owner)` — guard its possible `null` return.

## UI (signed-in home)

A **"My Notes" ⇄ "Browse"** toggle on the dashboard (`public/views/dashboard.ejs` + `public/js/dashboard.js`, reusing cover chrome + `list.js`):

- **Browse:** spaces sidebar (`All shared`, each space + non-private count, create-space control; rename/delete shown when you're the creator or a teacher); a notes list showing **owner name**, title (opens the note in a new tab), the note's spaces, with search + space filter. Read-only — you open notes; their own permission governs editing. **Empty state teaches the path:** "No shared notes yet — open a note from *My Notes* and add it to a space."
- **My Notes:** each note row gains a **"Shared space"** control (multi-select/chips → `PUT /api/notes/:id/spaces`) clearly labeled distinct from the private **tag** chips. A note that's in any space shows a small **"shared" badge**, and the control offers one-action un-share — so the owner can see at a glance which of their notes are shared and pull one back easily.

## Behaviour & edge cases

- **Opt-in only**; **permission respected** (a note flipped to private after sharing simply stops appearing to others; still shows to its owner).
- **Owner-only** note↔space assignment; **creator-or-teacher** rename/delete; **any member** create.
- **Dedup** case-insensitive on create and rename.
- **Bogus spaceIds** filtered out before creating links; **empty `spaceIds`** clears the note's links.
- **Counts** = non-private notes in the space (consistent for all viewers, no private-existence leak).

## Testing (mocha + power-assert + sqlite `:memory:`; service-level + HTTP harness)

- `Space`: case-insensitive unique (`nameLower`); create / rename (dedup) / delete; display case preserved.
- `NoteSpace`: `(noteId,spaceId)` uniqueness; owner-guarded assignment refuses another user's note; bogus spaceIds ignored; empty array clears.
- Cleanup: space delete removes NoteSpace links (notes survive); note delete removes its NoteSpace links.
- Browse query: returns categorized notes for the viewer; **excludes another owner's private note**; **includes the viewer's own private note**; space + keyword filter; count = non-private.
- Rename/delete authz: creator allowed; teacher allowed; unrelated member refused.
- **HTTP harness** (`test/helpers/httpApp.js`): anon → 401 on `/api/spaces`/`/api/browse`; cross-owner `PUT /api/notes/:id/spaces` → 403; non-creator/non-teacher `DELETE/PUT /api/spaces/:id` → 403; browse hides another owner's private note.

## Files (approximate)

- `lib/models/space.js`, `lib/models/notespace.js` (new); `lib/models/note.js` (associations); `lib/migrations/<ts>-add-spaces.js`.
- `lib/browse/index.js` (new: space + browse services + router); `lib/note/index.js` (extend `cleanupNoteOrganization` + destructure); `lib/routes.js` (mount).
- `public/views/dashboard.ejs` (My Notes ⇄ Browse + space control + shared badge); `public/js/dashboard.js` (browse rendering, space assignment, labels).
- `test/models/space.test.js`, `test/browse/*.test.js`, `test/http/browse.test.js`.
- CLAUDE.md note once built.

## Out of scope (deferred)

Space membership and per-space access control; nested spaces; following/subscriptions/notifications; cross-instance/multi-lab isolation. (Rename is now in v1.)

## Open questions for planning

- `lib/browse` as its own module vs part of `lib/dashboard` (lean: dedicated `lib/browse`; share owner-guard helpers from `lib/dashboard`).
- Whether the My-Notes "shared space" control and the Browse view ship as one UI task or two (lean: two — the owner-side opt-in control, then the Browse reader).
