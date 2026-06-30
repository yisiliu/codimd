# Slice 3b — Inline comments (line-anchored, REST)

**Date:** 2026-06-30
**Status:** Approved (design)
**Context:** The final roadmap feature for the institute deployment — async, line-anchored feedback on notes (teacher→student review, peer questions on handouts). Deliberately scoped to **avoid the OT/realtime engine** (CLAUDE.md's "trickiest part to change safely"): comments are REST, not live-synced. Base branch `feature/institute-ui-responsive` (current tip). Closed institute (owner/admin/user roles, membership-gated spaces already shipped).

## Goal

A signed-in member can attach a **comment to a line** of any note they can view; a 💬 gutter marker shows which lines have threads; a panel lists/adds/resolves/deletes comments. Anchors are **drift-tolerant** (line number + text snapshot, best-effort re-locate). No live sync — comments load on open and refresh after each action.

## Decisions (locked during brainstorming)

- **Line-anchored** (not text-range, not whole-note). Anchor = `line` + `anchorText` snapshot.
- **REST**, no realtime/OT integration.
- **Flat comments per line** — multiple commenters stack chronologically on a line; **no nested replies** (deferred).
- **Editor view only** — the published/pretty read view is deferred.
- **No edit** — delete + re-add instead.
- **Comments visible to anyone who can view the note** (so feedback on a space-shared note is visible to that space's members). Private/participant-only comments are a future, larger model.

## What exists (reuse)

- `newCheckViewPermission(note, isLogin, userId)` (`lib/response.js:122`) — the canonical "can this user view the note" gate. Reuse for view/post authz.
- `Note.parseNoteIdAsync` / `encodeNoteId`; the `/api/*`-only, mounted-above-`/:noteId`, per-route-auth, `handle()`-403-mapping router discipline (`lib/dashboard`, `lib/browse`, `lib/teach`).
- The HTTP test harness (`test/helpers/httpApp.js`); `removeLibModuleCache` cache discipline for HTTP tests.
- The editor: CodeMirror is configured with `gutters: [...]` in `public/js/lib/editor/index.js:886` and exposes `addPanel` (line 269). `index.js` holds `noteid` (imported) + the live editor (`window.editor`).

## Data model (one migration)

- **`Comment`** (`lib/models/comment.js`, mirror the `notespace.js`/`spacemember.js` shape): `id` (UUID PK, UUIDV4), `noteId` (UUID), `authorId` (UUID), `line` (INTEGER, allowNull false), `anchorText` (TEXT — the line's text when the comment was made), `content` (TEXT, allowNull false), `resolved` (BOOLEAN default false), timestamps. Index on `noteId`. `associate`: `belongsTo(Note)` + `belongsTo(User)` (`constraints:false`). No reverse hasMany (load-order lesson).
- **Migration** `lib/migrations/<ts>-add-comments.js`: `createTable('Comments', …)` (UUID id PK no defaultValue, matching the spaces migration) + `addIndex('Comments', ['noteId'])`. `down` drops it.
- **Cleanup:** deleting a note removes its comments — add `Comment.destroy({ where: { noteId } })` to the note-deletion path (`cleanupNoteOrganization` in `lib/note`, which already clears NoteSpace/NoteTag).

## Services (`lib/comment/index.js`)

Authz helpers: `canView(user, note)` = `newCheckViewPermission(note, true, user.id)`; `canModerate(user, note, comment)` = author **or** note owner **or** institute `owner` (`String()` compares).

- `listComments(user, noteId)` — load the note, assert `canView`, return all comments for the note `[{ id, line, anchorText, content, resolved, author: {id,name}, createdAt, mine }]` ordered by `line, createdAt`.
- `addComment(user, noteId, { line, anchorText, content })` — assert `canView`; validate `content` non-empty + `line >= 0` + `content.length <= 2000`; create with `authorId = user.id`.
- `setResolved(user, commentId, resolved)` — load comment + its note; assert `canModerate`; update `resolved`.
- `deleteComment(user, commentId)` — load comment + its note; assert `canModerate`; destroy.

## API (`lib/comment` router; mounted above `/:noteId`)

| method + path | who | purpose |
|---|---|---|
| `GET /api/notes/:id/comments` | anyone who may view the note | list (encoded `:id` → `parseNoteIdAsync`) |
| `POST /api/notes/:id/comments` `{line, anchorText, content}` | viewer | add |
| `PUT /api/comments/:cid` `{resolved}` | author / note owner / institute owner | resolve/unresolve |
| `DELETE /api/comments/:cid` | author / note owner / institute owner | delete |

Per-route `requireAuth`; `handle()` maps `/not-found|forbidden/`→403. `:cid` is a raw UUID (not a note id — no `parseNoteIdAsync`).

## Editor UI (`public/js/index.js` + `public/js/lib/editor/index.js` + `codimd/header.ejs`)

The heavy part — verify integration points live during planning.
- **Gutter:** add a `comment` gutter to the CodeMirror `gutters` array; render a 💬 marker (with count) on each line that has comments via `setGutterMarker`. Clicking a marker (or a "comment on this line" affordance on the active line) opens the panel for that line.
- **Comment panel:** a right-side drawer / Bootstrap popover listing the line's comments (author, relative time, text, a **resolved** badge), a textarea + **Post**, and per-comment **Resolve**/**Delete** (shown when `mine` or the viewer owns the note / is institute owner — server re-checks regardless).
- **Toolbar toggle:** a "Comments" button (in `codimd/header.ejs`, like the "Make a copy" item) to show/hide markers + open an **all-comments list** (including an **Orphaned** section for comments whose anchor was lost).
- **Loading & anchoring:** on note load, `GET …/comments`; for each, resolve its line — if `editor.getLine(line) === anchorText` use `line`; else scan ±5 lines for `anchorText`; else mark **orphaned**. Re-fetch after post/resolve/delete (REST). Posting captures the current cursor line's number + text as `line`/`anchorText`.
- Available only to signed-in members (closed instance); the editor passes `currentUser`/`noteid` already in scope.

## Behaviour & edge cases

- **Drift:** best-effort re-locate by snapshot; unresolved-and-unlocatable comments surface in the Orphaned list (never silently dropped).
- **Empty/oversized content** → 400. **Comment on a note you can't view** → 403.
- **Resolved** comments stay visible (greyed, in the panel) and their line marker reflects unresolved count; resolving doesn't delete.
- **Author display:** `User.getProfile(u)` name, `|| email || 'Unknown'` (null-guard `getProfile`, per the 4b lesson).
- **Read-only notes (handouts):** anchors are stable (doc isn't edited); commenting still allowed for any viewer.

## Testing (mocha + power-assert + sqlite `:memory:`; services + HTTP harness)

- **Model:** Comment persists; `resolved` defaults false; note-delete cleanup removes its comments.
- **Services:** `addComment`/`listComments` gated by `canView` (a non-viewable private note → 403); `setResolved`/`deleteComment` gated by `canModerate` — author ✅, note owner ✅, institute owner ✅, an unrelated viewer ❌(403); content validation (empty/oversize → error).
- **HTTP harness:** the 4 endpoints — 401 anon; 403 on a non-viewable note / cross-user moderate; 200 add/list/resolve/delete; encoded note-id parse.
- Seed real `User`s (FK); a viewable note needs content; cover the moderate matrix (author/owner/institute-owner/other).
- **Migration:** cache-managed test (like the 4b migration test) — create table + index, assert a seeded comment round-trips.
- Client anchoring logic (snapshot re-locate) is verified live (no unit harness for the editor bundle).

## Files (approximate)

- `lib/models/comment.js`; `lib/migrations/<ts>-add-comments.js`.
- `lib/comment/index.js` (services + router); `lib/routes.js` (mount above `/:noteId`); `lib/note/index.js` (`cleanupNoteOrganization` += Comment cleanup).
- `public/js/index.js`, `public/js/lib/editor/index.js`, `public/views/codimd/header.ejs` (+ CSS for the gutter marker/panel — likely a small `public/css` addition or inline).
- `test/models/comment.test.js`, `test/comment/*.test.js`, `test/http/comments.test.js`, `test/migrations/comments.test.js`.
- `docs/manual-test-guide.md`, CLAUDE.md.

## Out of scope (future)

Nested replies; text-range/selection anchors; live realtime sync; comments in the published/pretty view; comment edit; @mentions/notifications; private/participant-only visibility; comment export.

## Open questions for planning

- **Editor integration depth** — exactly which gutter/panel APIs (`setGutterMarker`, `addPanel`/`addLineWidget`, or a custom right drawer) and where in `index.js`/`editor/index.js` to wire load+render without disturbing the OT cursor/gutter setup. Needs a focused read of `public/js/lib/editor/index.js` during planning.
- Marker UX: gutter icon vs a line-hover affordance vs both (lean: gutter marker for lines with comments + a "+ comment" on the active line).
- Panel form: right drawer vs inline `addLineWidget` under the line (lean: a right drawer/sidebar — simpler than line widgets that shift the doc).
