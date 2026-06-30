# Inline Comments (Slice 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Line-anchored inline comments on notes — a 💬 gutter marker + side panel in the editor to read/add/resolve/delete comments, loaded via REST (no OT/realtime), with drift-tolerant anchors.

**Architecture:** Backend mirrors the other slices: a `Comment` model + a `lib/comment` services/router module + note-delete cleanup. Frontend adds a `comment-gutters` CodeMirror lane, a `.ui-comments-panel` flex sibling in the editor view, and load/render/post/resolve/delete wired with `fetch`. Permissions reuse `newCheckViewPermission`.

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (sqlite/PG/MySQL), CodeMirror (vendored), jQuery, EJS, mocha + power-assert + supertest. CommonJS, `standard` (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-30-inline-comments-design.md`

**Critical facts (review + editor map):**
- `Comment` mirrors `spacemember.js` (UUID id PK UUIDV4, UUID FKs, `belongsTo` `constraints:false`, no reverse hasMany). `line` INTEGER, `anchorText`/`content` TEXT, `resolved` BOOLEAN default false, index on `noteId`.
- Migration mirrors `20260619000002-add-spaces.js` (createTable UUID id PK no defaultValue + addIndex). Migration test must be **cache-managed** (`removeLibModuleCache` bracket) because its `up()` does a deferred `require('../models')` — see the 4b migration test.
- View gate: `newCheckViewPermission(note, true, user.id)` (`lib/response.js:122`) — true exactly when a signed-in member may open the note.
- Cleanup: `cleanupNoteOrganization` (`lib/note/index.js:233`, clears NoteTag+NoteSpace, called from `deleteNote` at 253). `lib/note/index.js` uses **destructured** model imports — line 5 is `const { Note, User, Revision, NoteTag, NoteSpace } = require('../models')`. Add `Comment` to that destructure and use the **bare name** `await Comment.destroy({ where: { noteId } })` inside the function (NOT `models.Comment.destroy` — there is no `models` binding in that file).
- Routes `/api/notes/:id/comments` + `/api/comments/:cid` are collision-free; mount above `/:noteId`. Encoded note `:id` → `parseNoteIdAsync`; `:cid` is a raw UUID.
- Editor map: gutters at `public/js/lib/editor/index.js:864-903`; `window.editor` at `index.js:302`, `noteid` imported at 32; doc-ready when `window.loaded` set in `socket.on('refresh')` (~2036); marker pattern `editor.setGutterMarker(line, 'authorship-gutters', dom)` in `iterateLine` (1955-1976); `addStyleRule` helper (1827); menu item pattern `header.ejs:141` (`ui-make-copy`) + delegated `$(document).on('click', '.ui-…')` (index.js:477); editor view layout `public/views/codimd/body.ejs` (`.ui-edit-area`/`.ui-view-area` in a `.row`); **no `currentUser` var** — use the server's `mine` flag; CSS in `public/css/index.css`.
- Seed real `User`s for FK in tests; a viewable note needs `content`.

---

## Task 1: Comment model + migration

**Files — Create:** `lib/models/comment.js`, `lib/migrations/20260630000001-add-comments.js`, `test/models/comment.test.js`, `test/migrations/comments.test.js`.

- [ ] **Step 1: Model test (RED)** — `test/models/comment.test.js`:
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Comment model', function () {
  this.timeout(10000)
  let u, n
  beforeEach(async function () {
    await resetDb()
    u = (await models.User.create({})).id
    n = (await models.Note.create({ ownerId: u, content: '# x' })).id
  })
  it('persists a comment; resolved defaults false', async function () {
    const c = await models.Comment.create({ noteId: n, authorId: u, line: 3, anchorText: '# x', content: 'fix this' })
    assert.strictEqual(c.resolved, false)
    assert.strictEqual((await models.Comment.findByPk(c.id)).content, 'fix this')
  })
})
```

- [ ] **Step 2: Run → FAIL** (`Comment` undefined): `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/comment.test.js`

- [ ] **Step 3: Model** — `lib/models/comment.js` (mirror `notespace.js`/`spacemember.js`):
```js
'use strict'

module.exports = function (sequelize, DataTypes) {
  const Comment = sequelize.define('Comment', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    noteId: { type: DataTypes.UUID, allowNull: false },
    authorId: { type: DataTypes.UUID, allowNull: false },
    line: { type: DataTypes.INTEGER, allowNull: false },
    anchorText: { type: DataTypes.TEXT, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    resolved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    indexes: [{ fields: ['noteId'] }]
  })

  Comment.associate = function (models) {
    Comment.belongsTo(models.Note, { foreignKey: 'noteId', constraints: false })
    Comment.belongsTo(models.User, { foreignKey: 'authorId', constraints: false })
  }

  return Comment
}
```

- [ ] **Step 4: Run → PASS** (auto-loaded by `lib/models/index.js`).

- [ ] **Step 5: Migration** — `lib/migrations/20260630000001-add-comments.js`:
```js
'use strict'

module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('Comments', {
      id: { type: Sequelize.UUID, primaryKey: true },
      noteId: { type: Sequelize.UUID, allowNull: false },
      authorId: { type: Sequelize.UUID, allowNull: false },
      line: { type: Sequelize.INTEGER, allowNull: false },
      anchorText: { type: Sequelize.TEXT, allowNull: true },
      content: { type: Sequelize.TEXT, allowNull: false },
      resolved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('Comments', ['noteId'], { name: 'comments_note_idx' })
  },
  down: async function (queryInterface) {
    await queryInterface.dropTable('Comments')
  }
}
```

- [ ] **Step 6: Migration test** — `test/migrations/comments.test.js` (cache-managed, like 4b; `up()` has no deferred require here but keep the bracket for suite-safety since it shares the dir):
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { removeLibModuleCache } = require('../realtime/utils')

describe('migration: add comments', function () {
  this.timeout(10000)
  let models, migration
  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    migration = require('../../lib/migrations/20260630000001-add-comments')
  })
  after(removeLibModuleCache)
  beforeEach(async function () { await models.sequelize.sync({ force: true }) })

  it('creates the table + index; a comment round-trips', async function () {
    const qi = models.sequelize.getQueryInterface()
    const u = (await models.User.create({})).id
    const n = (await models.Note.create({ ownerId: u, content: '# x' })).id
    await qi.dropTable('Comments')
    await migration.up(qi, models.Sequelize)
    await models.Comment.create({ noteId: n, authorId: u, line: 1, content: 'hi' })
    assert.strictEqual(await models.Comment.count(), 1)
  })
})
```

- [ ] **Step 7: Run both → PASS; real migrate on a throwaway DB:**
`NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/comment.test.js ./test/migrations/comments.test.js`. Then `cp -n .sequelizerc.example .sequelizerc 2>/dev/null; rm -f /tmp/cm-mig.sqlite && CMD_DB_URL="sqlite:///tmp/cm-mig.sqlite" NODE_ENV=production npx sequelize db:migrate --migrations-path lib/migrations 2>&1 | tail -4` (clean). Don't commit `.sequelizerc`/sqlite.

- [ ] **Step 8: Lint + commit**
```bash
npx standard lib/models/comment.js lib/migrations/20260630000001-add-comments.js test/models/comment.test.js test/migrations/comments.test.js
git add lib/models/comment.js lib/migrations/20260630000001-add-comments.js test/models/comment.test.js test/migrations/comments.test.js
git commit -m "feat(comment): Comment model + migration"
```

---

## Task 2: Comment services + router + note cleanup

**Files — Create:** `lib/comment/index.js`, `test/comment/comments.test.js`, `test/http/comments.test.js`. **Modify:** `lib/routes.js` (mount), `lib/note/index.js` (cleanup).

- [ ] **Step 1: Service test (RED)** — `test/comment/comments.test.js`:
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const comment = require('../../lib/comment')

const U = id => ({ id, role: 'user' })
const OWNER = id => ({ id, role: 'owner' })

describe('comment services', function () {
  this.timeout(10000)
  let owner, other, ownerRole, note
  beforeEach(async function () {
    await resetDb()
    owner = (await models.User.create({})).id
    other = (await models.User.create({})).id
    ownerRole = (await models.User.create({ role: 'owner' })).id
    note = await models.Note.create({ ownerId: owner, content: '# Doc', permission: 'editable' })
  })

  it('a viewer can add + list; private note non-owner is refused', async function () {
    await comment.addComment(U(other), note.id, { line: 0, anchorText: '# Doc', content: 'nice' })
    const list = await comment.listComments(U(owner), note.id)
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].author.id, other)
    const priv = await models.Note.create({ ownerId: owner, content: '# p', permission: 'private' })
    await assert.rejects(() => comment.addComment(U(other), priv.id, { line: 0, content: 'x' }), /forbidden/)
    await assert.rejects(() => comment.listComments(U(other), priv.id), /forbidden/)
  })

  it('moderate: author/owner/institute-owner can resolve+delete; a bystander cannot', async function () {
    const c = await comment.addComment(U(other), note.id, { line: 1, content: 'q' })
    const bystander = (await models.User.create({})).id
    await assert.rejects(() => comment.setResolved(U(bystander), c.id, true), /forbidden/)
    await comment.setResolved(U(other), c.id, true) // author
    assert.strictEqual((await models.Comment.findByPk(c.id)).resolved, true)
    await comment.deleteComment(U(owner), c.id) // note owner
    assert.strictEqual(await models.Comment.count(), 0)
    const c2 = await comment.addComment(U(other), note.id, { line: 2, content: 'q2' })
    await comment.deleteComment(OWNER(ownerRole), c2.id) // institute owner
    assert.strictEqual(await models.Comment.count(), 0)
  })

  it('rejects empty + oversized content', async function () {
    await assert.rejects(() => comment.addComment(U(owner), note.id, { line: 0, content: '   ' }), /required/)
    await assert.rejects(() => comment.addComment(U(owner), note.id, { line: 0, content: 'x'.repeat(2001) }), /too long/)
  })
})
```

- [ ] **Step 2: Run → FAIL** (module missing).

- [ ] **Step 3: Implement `lib/comment/index.js`**:
```js
'use strict'
const models = require('../models')
const { newCheckViewPermission } = require('../response')

function isOwnerRole (user) { return !!user && user.role === 'owner' }
function canView (user, note) { return newCheckViewPermission(note, true, user.id) }
function canModerate (user, note, c) {
  return String(c.authorId) === String(user.id) ||
    String(note.ownerId) === String(user.id) ||
    isOwnerRole(user)
}

async function loadNote (noteId) {
  const note = await models.Note.findByPk(noteId)
  if (!note) throw new Error('note-not-found')
  return note
}
async function loadComment (commentId) {
  const c = await models.Comment.findByPk(commentId)
  if (!c) throw new Error('comment-not-found')
  return c
}
async function authorOf (authorId) {
  const u = await models.User.findByPk(authorId)
  const p = u ? models.User.getProfile(u) : null
  return { id: authorId, name: (p && p.name) || (u && u.email) || 'Unknown' }
}

async function listComments (user, noteId) {
  const note = await loadNote(noteId)
  if (!canView(user, note)) throw new Error('forbidden')
  const comments = await models.Comment.findAll({ where: { noteId }, order: [['line', 'ASC'], ['createdAt', 'ASC']] })
  return Promise.all(comments.map(async c => ({
    id: c.id, line: c.line, anchorText: c.anchorText, content: c.content,
    resolved: c.resolved, createdAt: c.createdAt,
    author: await authorOf(c.authorId), mine: String(c.authorId) === String(user.id)
  })))
}

async function addComment (user, noteId, { line, anchorText, content }) {
  const note = await loadNote(noteId)
  if (!canView(user, note)) throw new Error('forbidden')
  const text = (content || '').trim()
  if (!text) throw new Error('comment content required')
  if (text.length > 2000) throw new Error('comment too long')
  const ln = parseInt(line, 10)
  if (!(ln >= 0)) throw new Error('invalid line')
  return models.Comment.create({ noteId, authorId: user.id, line: ln, anchorText: (anchorText || '').slice(0, 1000), content: text })
}

async function setResolved (user, commentId, resolved) {
  const c = await loadComment(commentId)
  const note = await loadNote(c.noteId)
  if (!canModerate(user, note, c)) throw new Error('forbidden')
  c.resolved = !!resolved
  await c.save({ fields: ['resolved'] })
  return c
}

async function deleteComment (user, commentId) {
  const c = await loadComment(commentId)
  const note = await loadNote(c.noteId)
  if (!canModerate(user, note, c)) throw new Error('forbidden')
  await c.destroy()
}

module.exports = { listComments, addComment, setResolved, deleteComment, canView, canModerate }

// --- HTTP router (/api/* only; mounted above /:noteId) ---
const { Router } = require('express')
const bodyParser = require('body-parser')
const jsonParser = bodyParser.json()

function requireAuth (req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).send({ status: 'forbidden' })
  next()
}
function handle (fn) {
  return async function (req, res) {
    try {
      const result = await fn(req)
      res.send(Object.assign({ status: 'ok' }, result || {}))
    } catch (err) {
      const code = /not-found|forbidden/.test(err.message) ? 403 : 400
      res.status(code).send({ status: 'error', message: err.message })
    }
  }
}

const router = Router()
router.get('/api/notes/:id/comments', requireAuth, handle(async req => ({ comments: await listComments(req.user, await models.Note.parseNoteIdAsync(req.params.id)) })))
router.post('/api/notes/:id/comments', requireAuth, jsonParser, handle(async req => ({ comment: { id: (await addComment(req.user, await models.Note.parseNoteIdAsync(req.params.id), req.body)).id } })))
router.put('/api/comments/:cid', requireAuth, jsonParser, handle(async req => { await setResolved(req.user, req.params.cid, req.body.resolved) }))
router.delete('/api/comments/:cid', requireAuth, handle(async req => { await deleteComment(req.user, req.params.cid) }))

module.exports.router = router
```

- [ ] **Step 4: Mount** in `lib/routes.js` — `appRouter.use(require('./comment').router)` next to the dashboard/browse/teach mounts (above the `/:noteId` catch-all).

- [ ] **Step 5: Note cleanup** — in `lib/note/index.js` (uses **destructured** imports, no `models` binding):
  - Line 5: `const { Note, User, Revision, NoteTag, NoteSpace } = require('../models')` → add `Comment`: `const { Note, User, Revision, NoteTag, NoteSpace, Comment } = require('../models')`.
  - Inside `cleanupNoteOrganization(noteId)` (lines 233–236, currently `await NoteTag.destroy({ where: { noteId } })` + `await NoteSpace.destroy({ where: { noteId } })`), add: `await Comment.destroy({ where: { noteId } })`. Use the **bare name `Comment`**, NOT `models.Comment`.

- [ ] **Step 6: HTTP test** — `test/http/comments.test.js` (cache-managed, shares `models`+`comment` with the app):
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: comments', function () {
  this.timeout(15000)
  let models, buildApp, comment, owner, other

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    comment = require('../../lib/comment')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    owner = (await models.User.create({})).id
    other = (await models.User.create({})).id
  })
  const as = id => buildApp({ id, role: 'user', active: true })
  const enc = id => models.Note.encodeNoteId(id)

  it('401 anon; add+list works for a viewer', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    assert.strictEqual((await request(buildApp(null)).get(`/api/notes/${enc(n.id)}/comments`)).status, 401)
    assert.strictEqual((await request(as(other)).post(`/api/notes/${enc(n.id)}/comments`).send({ line: 0, content: 'hi' })).status, 200)
    const res = await request(as(owner)).get(`/api/notes/${enc(n.id)}/comments`)
    assert.strictEqual(res.body.comments.length, 1)
  })

  it('403 on a private note you do not own', async function () {
    const p = await models.Note.create({ ownerId: owner, content: '# p', permission: 'private' })
    assert.strictEqual((await request(as(other)).post(`/api/notes/${enc(p.id)}/comments`).send({ line: 0, content: 'x' })).status, 403)
  })

  it('a bystander cannot delete; the author can', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    const c = await comment.addComment({ id: other, role: 'user' }, n.id, { line: 0, content: 'q' })
    const bystander = (await models.User.create({})).id
    assert.strictEqual((await request(as(bystander)).delete(`/api/comments/${c.id}`)).status, 403)
    assert.strictEqual((await request(as(other)).delete(`/api/comments/${c.id}`)).status, 200)
  })
})
```

- [ ] **Step 7: Run + full suite + cleanup test + lint + commit.**
`NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/comment ./test/http/comments.test.js --recursive` (passing). Add a cleanup assertion to the comment service test OR verify via the note suite. Then `NODE_ENV=test npm run mocha` → 0 failing. Verify exports: `node -e "const c=require('./lib/comment'); console.log(typeof c.addComment, typeof c.router)"` → `function function`.
```bash
npx standard lib/comment/index.js lib/routes.js lib/note/index.js test/comment/comments.test.js test/http/comments.test.js
git add lib/comment/index.js lib/routes.js lib/note/index.js test/comment test/http/comments.test.js
git commit -m "feat(comment): services + /api routes + note-delete cleanup"
```

---

## Task 3: Editor — gutter markers, load, add comment

The heavy part. Read `public/js/index.js` (the marker pattern at 1955-1976, the `socket.on('refresh')` ready hook at ~2036, `addStyleRule` at 1827), `public/js/lib/editor/index.js` (gutters ~886), `public/views/codimd/body.ejs` (layout), and `public/css/index.css` first.

**Files — Modify:** `public/js/lib/editor/index.js`, `public/js/index.js`, `public/views/codimd/body.ejs`, `public/css/index.css`.

- [ ] **Step 1: Gutter lane** — in `public/js/lib/editor/index.js`, add `'comment-gutters'` to the `gutters:` array (after `'CodeMirror-foldgutter'`). Do NOT touch the other lanes.

- [ ] **Step 2: Panel container** — in `public/views/codimd/body.ejs`, add a hidden side panel as a sibling of `.ui-view-area` inside the `.row.ui-content`:
```html
<div class="ui-comments-panel" style="display:none;">
  <div class="comments-panel-header">
    <span class="comments-panel-title"><i class="fa fa-comments-o"></i> <%= __('Comments') %></span>
    <button type="button" class="close ui-comments-close">&times;</button>
  </div>
  <div class="comments-panel-body"></div>
</div>
```

- [ ] **Step 3: CSS** — in `public/css/index.css`, add gutter + panel styles (match the existing gutter/foldgutter style block):
```css
.CodeMirror-gutter.comment-gutters { width: 16px; }
.comment-marker { color: #f0ad4e; cursor: pointer; text-align: center; width: 16px; }
.comment-marker.has-unresolved { color: #d9534f; }
.ui-comments-panel { width: 300px; flex: 0 0 300px; border-left: 1px solid #ddd; background: #f9f9f9; overflow-y: auto; }
.comments-panel-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #ddd; font-weight: 600; }
.comment-item { padding: 8px 12px; border-bottom: 1px solid #eee; }
.comment-item.resolved { opacity: .55; }
.comment-item .comment-meta { font-size: 11px; color: #888; }
.comment-add textarea { width: 100%; }
@media (max-width: 768px) { .ui-comments-panel { width: 100%; flex-basis: 100%; } }
```

- [ ] **Step 4: Client logic** in `public/js/index.js` — add a comments module (near the other feature wiring). Core behaviour (use `fetch`, `noteid`, `window.editor`):
  - `loadComments()`: `fetch(serverurl + '/api/notes/' + noteid + '/comments', { credentials: 'same-origin' })` → store `commentsByLine` after **re-anchoring** each comment: if `editor.getLine(c.line) === c.anchorText` keep `c.line`; else scan `c.line-5..c.line+5` for a line equal to `anchorText` and use that; else mark `c.orphaned = true`. Then `renderCommentGutter()`.
  - `renderCommentGutter()`: clear existing markers, then for each line with ≥1 non-orphaned comment, build `$('<div class="comment-marker">').html('💬')` (add `has-unresolved` if any unresolved), and `editor.setGutterMarker(line, 'comment-gutters', el[0])`. Click on a marker → `openCommentPanel(line)`.
  - `openCommentPanel(line)`: show `.ui-comments-panel`, render that line's comments into `.comments-panel-body` (author name, relative time via `moment`, content, resolved badge), plus an **add** form (textarea + Post). Post → `fetch(POST /api/notes/:id/comments, {line, anchorText: editor.getLine(line), content})` → `loadComments()` + re-render panel.
  - Call `loadComments()` once the doc is ready — in `socket.on('refresh')` right after `window.loaded = true` (guard so it runs once), and also after the editor has content. (If `window.editor.getValue()` is empty at first call, retry after the `doc` event.)
- [ ] **Step 5: Build** — `NODE_OPTIONS=--openssl-legacy-provider npm run build` (no errors). Lint `npx standard public/js/index.js public/js/lib/editor/index.js`.
- [ ] **Step 6: Manual verify (controller drives the app):** open a note, add a comment on a line → a 💬 marker appears on that line; reload → the marker + comment persist; clicking the marker opens the panel with the comment.
- [ ] **Step 7: Commit** (touch only the 4 files; not `public/build`):
```bash
git commit -m "feat(editor): comment gutter markers + side panel — load + add"
```

---

## Task 4: Editor — resolve, delete, toggle button, orphaned list

**Files — Modify:** `public/js/index.js`, `public/views/codimd/header.ejs`, `public/js/lib/editor/ui-elements.js`.

- [ ] **Step 1: Resolve + delete** — in the panel render (Task 3), add per-comment **Resolve/Unresolve** (`PUT /api/comments/:cid {resolved}`) and **Delete** (`DELETE /api/comments/:cid`) buttons, shown when `comment.mine` OR the viewer owns the note (`personalInfo.userid === window.owner`) OR `window.dashboardUser`-style owner role is available — but since the server re-checks, you may show them and let a 403 surface. After each action → `loadComments()` + re-render. Resolved comments stay visible (greyed via `.resolved`).
- [ ] **Step 2: Comments toggle** — add a menu item in `public/views/codimd/header.ejs` (mirror the `ui-make-copy` dropdown item shape at line ~141): `<li role="presentation"><a role="menuitem" class="ui-toggle-comments" tabindex="-1" href="#"><i class="fa fa-comments-o fa-fw"></i> <%= __('Comments') %></a></li>`. Register `toggleComments: $('.ui-toggle-comments')` in `public/js/lib/editor/ui-elements.js`. In `index.js`, bind `$(document).on('click', '.ui-toggle-comments', …)` to open the panel showing an **all-comments list** (grouped by line, plus an **Orphaned** section for `c.orphaned` comments — clicking an in-doc one scrolls the editor to that line via `editor.scrollIntoView`/`setCursor`).
- [ ] **Step 3: Close** — `$(document).on('click', '.ui-comments-close', …)` hides the panel.
- [ ] **Step 4: Build + lint** — `NODE_OPTIONS=--openssl-legacy-provider npm run build`; `npx standard public/js/index.js public/js/lib/editor/ui-elements.js`.
- [ ] **Step 5: Manual verify (controller):** resolve a comment (greys out, marker color updates); delete (disappears); the Comments menu item toggles the all-comments list; an orphaned comment (edit the anchored line away) shows in the Orphaned section.
- [ ] **Step 6: Commit** (only the 3 files):
```bash
git commit -m "feat(editor): comment resolve/delete + Comments toggle + orphaned list"
```

---

## Task 5: Docs + gate + live verify

- [ ] **Step 1: CLAUDE.md** — add an "Inline comments" subsection: `lib/comment` (line-anchored, REST, no OT); `Comment` model; `/api/notes/:id/comments` + `/api/comments/:cid`; visible to note viewers, moderate by author/note-owner/institute-owner; editor `comment-gutters` lane + side panel; drift-tolerant anchors (line + snapshot, orphaned list); note-delete cleanup.
- [ ] **Step 2: `docs/manual-test-guide.md`** — add §5 (Inline comments): open a note, add a line comment, see the gutter marker; another member sees it on open and replies; resolve/delete; moderation (author/owner only); orphaned behaviour when the line is edited away.
- [ ] **Step 3: Full gate** — `NODE_ENV=test npm run test:ci` (pass) + `NODE_OPTIONS=--openssl-legacy-provider npm run build`.
- [ ] **Step 4: Commit** `git add CLAUDE.md docs/manual-test-guide.md && git commit -m "docs: inline comments in CLAUDE.md + test guide"`.

**Live verification (controller):** restart (sync creates `Comments`), then drive the editor — add a comment on a line, confirm the gutter marker + panel; reload and confirm persistence; resolve/delete; verify a non-author bystander gets 403 on delete; verify drift (insert lines above → comment re-anchors or goes orphaned).

---

## Notes & risk areas
- **Editor (Tasks 3–4) is the risk** — it's the 3300-line bundle. Keep changes additive (new gutter lane, new panel div, new fetch calls); do NOT touch the OT/cursor/authorship code. Verify live after each.
- **Anchoring:** `editor.getLine(n)` is 0-indexed and returns `undefined` out of range (safe). Re-locate by snapshot ±5; orphaned comments are listed, never dropped.
- **Permissions:** `canView` = `newCheckViewPermission(note, true, user.id)`; `canModerate` = author/owner/institute-owner, `String()` compares. Server re-checks every mutation regardless of client affordances.
- **No `currentUser`** client var — use the server `mine` flag (+ `personalInfo.userid`/`window.owner` for owner affordance).
- **Cache-managed** migration + HTTP tests (shared `models` instance) to avoid realtime-suite pollution.
- Bundle build needs Node 16 or `--openssl-legacy-provider`.
