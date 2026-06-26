# Slice 3a — Copy & Templates (teaching workflow)

**Date:** 2026-06-23
**Status:** Approved (design)
**Context:** Fourth feature for the institute deployment of CodiMD (3 teachers + ~20 grad students). First half of the "teaching workflow" slice; **inline comments** are deferred to Slice 3b. Builds on Slices 1/2a/2b-2c (closed access, dashboard, shared spaces) — base branch `feature/institute-shared-spaces`.

## Goal

Deliver the handout → student-copy teaching loop and reusable assignment **templates**, both on one **clone** mechanism:
- **Make a copy** of any note you can view → a fresh note you own, from three places (dashboard/browse rows, the editor menu, the published view).
- **Templates:** an owner flags a note as a template; "New from template" lists templates you can view and clones the chosen one.
- **Read-only handouts** need no new code — they are CodiMD's existing `protected`/`locked` permission. The new affordance is the copy button.

## What already exists (reuse, don't rebuild)

- `newNote` (`lib/response.js:92`) creates a note from posted content, owner = the authed user, with a `config.documentMaxLength` (100000) guard.
- Note permission (`['freely','editable','limited','locked','protected','private']`) already makes notes read-only for non-owners (`protected`/`locked`); set in the editor. Handouts = this.
- View-permission predicate (Slice 2b/2c): a note is viewable by `me` iff `permission != 'private' OR ownerId = me` (NULL-safe). Reuse for clone-source and template visibility.
- The dashboard (`public/js/dashboard.js`, `lib/dashboard`, `lib/browse`), the HTTP test harness (`test/helpers/httpApp.js`), and `Note.parseNoteIdAsync` / `Note.encodeNoteId`.

## Decisions (locked during brainstorming)

- **Content-only clone:** the copy carries the source's `content` and nothing else — fresh owner, default permission, no folder/tags/spaces/pin/template flag, no back-reference to the source.
- **Template = a `template` boolean on `Note`**, owner-toggled; the note *is* the template. No separate template model.
- **Copy button on three surfaces:** dashboard + browse rows, the editor menu, the published (pretty) view — all calling one endpoint.

## Data model (one migration)

- **`Note.template`**: BOOLEAN, default `false`, owner-personal flag (same shape as `pinned`/`folderId`). Marks a note as a reusable template.

No new tables; no DB FKs introduced.

## API (`lib/dashboard` extension, or a small `lib/teach` module)

Owner/viewer-guarded; mounted with the existing `/api/*`-only, above-`/:noteId`, per-route-auth discipline. Note ids arrive base64url-encoded → `Note.parseNoteIdAsync`.

| method + path | who | purpose |
|---|---|---|
| `POST /api/notes/:id/clone` | any member who may **view** the source | create a new note (`ownerId = me`, `content = source.content`, **`title = Note.parseNoteTitle(source.content)`**, default permission); return `{ id: encodedNewId }`. Reject if source not viewable (403) or content over `documentMaxLength` (400). |
| `PUT /api/notes/:id/template` | note **owner** | body `{ template: true|false }` — toggle the flag |
| `GET /api/templates` | any member | template notes (`template = true`) the viewer may see, each `{ id (encoded), text: title-or-derived, owner }` |

Clone service (testable, no Express): `cloneNote(userId, sourceNoteId)` → loads the source, checks `viewableWhere`, `Note.create({ ownerId: userId, content: source.content, title: Note.parseNoteTitle(source.content) })`, returns the new note. **The explicit `title` is required:** the `beforeCreate` hook only derives a title when `content` is empty, and `getMyNoteList` returns the raw `title` column — without this the cloned note shows a **blank title** in the dashboard. `parseNoteTitle` already exists (`lib/models/note.js`). Owner check for the template toggle reuses the `ownedNote` helper pattern. `GET /api/templates` likewise falls back to `Note.parseNoteTitle(content)` when a template note's `title` column is empty.

## UI

- **Dashboard + Browse rows:** a **"Make a copy"** action per note row (`public/js/dashboard.js`) → `POST /api/notes/:id/clone` → open `/<newId>` (new tab). My-Notes rows also get a **template toggle** (+ a "template" badge) wired to `PUT /api/notes/:id/template`.
- **"New from template"** control near the dashboard's "New note": opens a picker from `GET /api/templates`; choosing one POSTs clone and opens the new note.
- **Editor menu** (`public/views/codimd/header.ejs` + the editor client, `public/js/index.js`/lib): a **"Make a copy"** menu item that POSTs clone for the current note and opens the result. *(Heaviest integration — CodiMD's editor bundle; verify live.)*
- **Published (pretty) view** (`public/views/pretty.ejs` + a small nonce'd script): a **"Make a copy"** button → POST clone → open the copy.

All copy affordances require login; on a closed instance every member is logged in. Anonymous (if ever enabled) gets 401 and the button is hidden.

## Behaviour & edge cases

- **Clone permission:** you can copy a note you can view (non-private or yours); copying a private note you don't own → 403.
- **Independent copy:** no folder/tags/spaces/pin/template/permission carried; no "copied from" link. The copy's `title` is set explicitly at clone time (`parseNoteTitle(source.content)`) so it is not blank; it **matches the source title** (content-only clone, no owner-stamp — user decision). Copies are disambiguated by the **owner name** the Browse view already shows, and each copy lives in its own owner's "My Notes". If grading later proves painful, owner-stamped titles can be added.
- **Length guard:** mirror `newNote`'s `documentMaxLength` check.
- **Template toggle is owner-only;** the template list shows only viewable, flagged notes (a private template shows only to its owner).
- **Empty/new-from-template with zero templates:** the picker shows a gentle "No templates yet" and how to make one (flag a note as a template).

## Testing (mocha + power-assert + sqlite `:memory:`; service-level + HTTP harness)

- `cloneNote`: creates an owned copy with the source content; refuses a non-viewable source; respects the length guard. The copy has default permission and no org carry-over.
- Template toggle: owner-guarded (cross-owner refused); flips the flag.
- Template list: returns only `template = true` notes the viewer may see; excludes another owner's private template; includes the viewer's own.
- **HTTP harness** (`test/helpers/httpApp.js`): `POST /api/notes/:id/clone` → 401 anon, 403 for a non-viewable source, 200 + new id for a viewable source; `PUT /api/notes/:id/template` → 403 cross-owner; `GET /api/templates` → 401 anon, hides others' private templates.
- Seed real `User`s for any `Note.create` (Notes.ownerId FK); give clone-source notes non-empty `content`.

## Files (approximate)

- `lib/models/note.js` (`template` column); `lib/migrations/<ts>-add-note-template.js`.
- `lib/dashboard/index.js` or new `lib/teach/index.js` (`cloneNote`, `setTemplate`, `listTemplates` + routes); `lib/routes.js` (mount if new module); `lib/note/index.js` (extend `getMyNoteList` with `template` so the dashboard row can show the toggle state, mirroring `pinned`).
- `public/js/dashboard.js` + `public/views/dashboard.ejs` (copy action, template toggle/badge, "New from template" picker).
- `public/views/pretty.ejs` (+ copy button); `public/views/codimd/header.ejs` + editor client (copy menu item).
- `test/teach/*.test.js`, `test/http/clone-templates.test.js`.
- CLAUDE.md note once built.

## Out of scope (deferred)

Inline comments (Slice 3b); "copied from" attribution / lineage; template categories, descriptions, or versioning; copying a note's history/revisions; bulk "distribute to all students".

## Open questions for planning

- New `lib/teach` module vs extending `lib/dashboard`/`lib/browse` (lean: small `lib/teach` for clone+templates, sharing the owner-guard/viewable helpers).
- Editor-menu integration point: where in `codimd/header.ejs` the item goes and which client file wires the POST (verify during planning by reading the menu + the editor's existing action handlers).
- Whether "New from template" is a modal or a dropdown (lean: a simple modal listing templates, reusing Bootstrap-3 modal markup already in the views).
