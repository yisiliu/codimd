# Copy & Templates (Slice 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click "make a copy" of any viewable note into a new note you own, from three surfaces (dashboard/browse rows, the editor menu, the published view), plus a `template` flag + "New from template".

**Architecture:** A small `lib/teach` module: `cloneNote` (copy a viewable note's content into a new owned note, with a derived title), `setTemplate` (owner-toggle), `listTemplates`, and an `/api/*` router. Reuses `viewableWhere`/`ownedNote` from `lib/browse`, `Note.parseNoteIdAsync`/`parseNoteTitle`/`encodeNoteId`, and the existing owner-guard/handle/requireAuth patterns. Handouts are CodiMD's existing read-only permissions — no new code.

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (sqlite `:memory:` tests, Postgres prod), EJS + Bootstrap 3 + jQuery, mocha + power-assert + supertest. CommonJS, `standard` (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-23-copy-and-templates-design.md`

**Critical repo facts (from prior slices):**
- **`Notes.ownerId` is an enforced FK on sqlite** → tests creating a `Note` must seed a real `User` (`User.create({})`). Notes whose title is asserted need non-empty `content` (the `beforeCreate` hook only derives title when content is empty).
- **Clone must set `title` explicitly** (`Note.parseNoteTitle(content)`) — otherwise the cloned note has a blank `title` column and shows blank in the dashboard (which returns the raw `note.title`).
- **No DB FKs** beyond `Notes.ownerId`; cleanup app-level (not relevant here — no new tables).
- **Encoded note ids** parsed server-side via `Note.parseNoteIdAsync`; routes `/api/*`-only, mounted above `/:noteId`, per-route auth (no root `router.use`).
- **HTTP tests** use `test/helpers/httpApp.js` + the `removeLibModuleCache` before/after + shared-`models` pattern (`test/http/routing.test.js`).
- **`lib/browse`** exports `viewableWhere(userId)` and `ownedNote(ownerId, noteId)` — reuse them.
- Bundle build needs Node 16 or `--openssl-legacy-provider`.

---

## File Structure

**Create:** `lib/teach/index.js`, `lib/migrations/20260623000001-add-note-template.js`, tests under `test/teach/` + `test/http/`.
**Modify:** `lib/models/note.js` (`template` column), `lib/note/index.js` (`getMyNoteList` + `template`), `lib/routes.js` (mount), `public/js/dashboard.js` + `public/views/dashboard.ejs` (copy action, template toggle/badge, picker), `public/views/pretty.ejs` (copy button), `public/views/codimd/header.ejs` + `public/js/index.js` (editor copy item).

---

## Task 1: Note `template` column + migration

**Files:** Modify `lib/models/note.js`; Create `lib/migrations/20260623000001-add-note-template.js`; Test `test/models/note-template.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Note.template column', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('defaults to false and can be set', async function () {
    const n = await models.Note.create({ ownerId: u1, content: 'x' })
    assert.strictEqual(n.template, false)
    n.template = true
    await n.save()
    assert.strictEqual((await models.Note.findByPk(n.id)).template, true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/note-template.test.js`
Expected: FAIL (template undefined → null/undefined).

- [ ] **Step 3: Implement** — add to the Note attribute map in `lib/models/note.js` (next to `pinned`):

```js
    template: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
```

Create `lib/migrations/20260623000001-add-note-template.js`:

```js
'use strict'
module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.addColumn('Notes', 'template', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false })
  },
  down: function (queryInterface) {
    return queryInterface.removeColumn('Notes', 'template')
  }
}
```

- [ ] **Step 4: Run pass + migration check + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/note-template.test.js` → PASS.
Migration: `cp -n .sequelizerc.example .sequelizerc 2>/dev/null; rm -f /tmp/tmpl-mig.sqlite && CMD_DB_URL="sqlite:///tmp/tmpl-mig.sqlite" NODE_ENV=production npx sequelize db:migrate --migrations-path lib/migrations 2>&1 | tail -6` → new migration runs clean. Do NOT commit `.sequelizerc`/sqlite.

```bash
npx standard lib/models/note.js lib/migrations/20260623000001-add-note-template.js
git add lib/models/note.js lib/migrations/20260623000001-add-note-template.js test/models/note-template.test.js
git commit -m "feat(note): add template flag column"
```

---

## Task 2: Clone service

**Files:** Create `lib/teach/index.js`; Test `test/teach/clone.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const teach = require('../../lib/teach/index')

describe('cloneNote', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('clones a viewable note into a new note I own, with a derived title', async function () {
    const src = await models.Note.create({ ownerId: u2, content: '# Handout\n\nbody', permission: 'editable' })
    const copy = await teach.cloneNote(u1, src.id)
    assert.strictEqual(copy.ownerId, u1)
    assert.strictEqual(copy.content, '# Handout\n\nbody')
    assert.strictEqual(copy.title, 'Handout') // derived, not blank
    assert.notStrictEqual(copy.id, src.id)
  })

  it('refuses to clone another owner\'s private note', async function () {
    const src = await models.Note.create({ ownerId: u2, content: '# secret', permission: 'private' })
    await assert.rejects(() => teach.cloneNote(u1, src.id), /forbidden|not-found/i)
  })

  it('clones my own private note', async function () {
    const src = await models.Note.create({ ownerId: u1, content: '# mine', permission: 'private' })
    const copy = await teach.cloneNote(u1, src.id)
    assert.strictEqual(copy.ownerId, u1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/teach/clone.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/teach/index.js`**

```js
'use strict'
const models = require('../models')
const config = require('../config')

async function cloneNote (userId, sourceId) {
  const source = await models.Note.findByPk(sourceId)
  if (!source) throw new Error('note-not-found')
  const viewable = source.permission !== 'private' || String(source.ownerId) === String(userId)
  if (!viewable) throw new Error('forbidden')
  const content = source.content
  if (content && content.length > config.documentMaxLength) throw new Error('content too long')
  return models.Note.create({
    ownerId: userId,
    content: content,
    title: models.Note.parseNoteTitle(content)
  })
}

module.exports = { cloneNote }
```

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/teach/clone.test.js` → PASS (3 passing).

```bash
npx standard lib/teach/index.js
git add lib/teach/index.js test/teach/clone.test.js
git commit -m "feat(teach): cloneNote — copy a viewable note into a new owned note"
```

---

## Task 3: Template services (toggle + list)

**Files:** Modify `lib/teach/index.js`; Test `test/teach/templates.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const teach = require('../../lib/teach/index')

describe('template services', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('owner toggles the template flag; cross-owner refused', async function () {
    const n = await models.Note.create({ ownerId: u1, content: '# T', title: 'T' })
    await teach.setTemplate(u1, n.id, true)
    assert.strictEqual((await models.Note.findByPk(n.id)).template, true)
    await assert.rejects(() => teach.setTemplate(u2, n.id, false), /note-not-found/i)
  })

  it('lists viewable template notes; hides another owner\'s private template', async function () {
    const pub = await models.Note.create({ ownerId: u2, content: '# Pub', title: 'Pub', permission: 'editable', template: true })
    const priv = await models.Note.create({ ownerId: u2, content: '# Priv', title: 'Priv', permission: 'private', template: true })
    const mine = await models.Note.create({ ownerId: u1, content: '# Mine', title: 'Mine', permission: 'private', template: true })
    await models.Note.create({ ownerId: u2, content: '# NotTpl', title: 'NotTpl', permission: 'editable' }) // template:false

    const list = await teach.listTemplates(u1)
    const titles = list.map(t => t.text).sort()
    assert.deepStrictEqual(titles, ['Mine', 'Pub']) // Priv (other's private) excluded; NotTpl not a template
    assert.ok(list.every(t => typeof t.owner === 'string'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/teach/templates.test.js`
Expected: FAIL.

- [ ] **Step 3: Add to `lib/teach/index.js`** (reuse `viewableWhere`/`ownedNote` from `lib/browse`)

```js
const { viewableWhere, ownedNote } = require('../browse')

async function setTemplate (userId, noteId, template) {
  const note = await ownedNote(userId, noteId)
  note.template = !!template
  await note.save({ fields: ['template'] })
  return note
}

async function listTemplates (userId) {
  const notes = await models.Note.findAll({ where: { template: true, ...viewableWhere(userId) }, order: [['title', 'ASC']] })
  return Promise.all(notes.map(async note => {
    const owner = await models.User.findByPk(note.ownerId)
    const profile = owner ? models.User.getProfile(owner) : null
    return {
      id: models.Note.encodeNoteId(note.id),
      text: note.title || models.Note.parseNoteTitle(note.content),
      owner: (profile && profile.name) || 'Unknown'
    }
  }))
}

Object.assign(module.exports, { setTemplate, listTemplates })
```

> `ownedNote` throws `note-not-found` for a non-owner — that's the cross-owner refusal. Add `const { viewableWhere, ownedNote } = require('../browse')` near the top requires (no cycle: teach→browse→models).

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/teach/templates.test.js` → PASS (2 passing).

```bash
npx standard lib/teach/index.js
git add lib/teach/index.js test/teach/templates.test.js
git commit -m "feat(teach): template toggle + viewable template list"
```

---

## Task 4: Extend `getMyNoteList` with `template`

**Files:** Modify `lib/note/index.js`; Test `test/note/myNotesTemplate.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const noteCtl = require('../../lib/note/index')

function getMyNoteList (userId) {
  return new Promise((resolve, reject) => noteCtl.getMyNoteListForTest(userId, (e, l) => e ? reject(e) : resolve(l)))
}

describe('getMyNoteList includes template flag', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('returns the template flag per note', async function () {
    await models.Note.create({ ownerId: u1, title: 'T', content: '# T', template: true })
    const list = await getMyNoteList(u1)
    assert.strictEqual(list[0].template, true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note/myNotesTemplate.test.js`
Expected: FAIL (`template` undefined).

- [ ] **Step 3: Implement** — in `lib/note/index.js` `getMyNoteList`, add `template: note.template,` next to the existing `pinned: note.pinned,` (line ~206).

- [ ] **Step 4: Run pass + note suite + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note --recursive` → all passing.

```bash
npx standard lib/note/index.js
git add lib/note/index.js test/note/myNotesTemplate.test.js
git commit -m "feat(note): include template flag in getMyNoteList"
```

---

## Task 5: Teach router + mount + HTTP tests

**Files:** Modify `lib/teach/index.js` (router); Modify `lib/routes.js`; Test `test/http/clone-templates.test.js`

- [ ] **Step 1: Add the router to `lib/teach/index.js`** (mirror `lib/browse` router shape)

```js
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
router.post('/api/notes/:id/clone', requireAuth, handle(async req => {
  const copy = await cloneNote(req.user.id, await models.Note.parseNoteIdAsync(req.params.id))
  return { id: models.Note.encodeNoteId(copy.id) }
}))
router.put('/api/notes/:id/template', requireAuth, jsonParser, handle(async req => {
  await setTemplate(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.template)
}))
router.get('/api/templates', requireAuth, handle(async req => ({ templates: await listTemplates(req.user.id) })))

module.exports.router = router
```

> Keep the single `module.exports = { cloneNote }` (Task 2) + `Object.assign(module.exports, { setTemplate, listTemplates })` (Task 3), then `module.exports.router = router` by property assignment (no reassignment).

- [ ] **Step 2: Mount in `lib/routes.js`** (above the `/:noteId` catch-all, next to the dashboard/browse mounts):

```js
appRouter.use(require('./teach').router)
```

- [ ] **Step 3: Write `test/http/clone-templates.test.js`** (cache-management pattern from `test/http/routing.test.js`)

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: clone & templates', function () {
  this.timeout(15000)
  let models, buildApp, u1, u2

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  function enc (id) { return models.Note.encodeNoteId(id) }

  it('anon clone is 401', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# h', permission: 'editable' })
    assert.strictEqual((await request(buildApp(null)).post(`/api/notes/${enc(n.id)}/clone`)).status, 401)
  })

  it('clones a viewable note → 200 + new id', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# Handout', permission: 'editable' })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).post(`/api/notes/${enc(n.id)}/clone`)
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.id)
    assert.strictEqual(await models.Note.count({ where: { ownerId: u1 } }), 1)
  })

  it('refuses to clone another owner\'s private note → 403', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# s', permission: 'private' })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).post(`/api/notes/${enc(n.id)}/clone`)
    assert.strictEqual(res.status, 403)
  })

  it('template toggle is owner-only → 403 cross-owner', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# t' })
    const res = await request(buildApp({ id: u1, role: 'student', active: true }))
      .put(`/api/notes/${enc(n.id)}/template`).send({ template: true })
    assert.strictEqual(res.status, 403)
  })

  it('templates list hides another owner\'s private template', async function () {
    await models.Note.create({ ownerId: u2, content: '# p', title: 'P', permission: 'private', template: true })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).get('/api/templates')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.templates.length, 0)
  })
})
```

- [ ] **Step 4: Run + full suite + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/http/clone-templates.test.js` (5 passing), then `NODE_ENV=test npm run mocha` (full suite, 0 failing). Verify exports: `node -e "const t=require('./lib/teach'); console.log(typeof t.cloneNote, typeof t.listTemplates, typeof t.router)"` → `function function function`.

```bash
npx standard lib/teach/index.js lib/routes.js test/http/clone-templates.test.js
git add lib/teach/index.js lib/routes.js test/http/clone-templates.test.js
git commit -m "feat(teach): /api clone + template router, mounted above /:noteId"
```

---

## Task 6: Dashboard UI — copy action, template toggle/badge, New-from-template

**Files:** Modify `public/js/dashboard.js`, `public/views/dashboard.ejs`; rebuild.

- [ ] **Step 1: Implement** (match existing dashboard idioms — `apiSend`, encoded id, per-row controls):
  - **Copy action** on each My-Notes AND Browse row: a "Make a copy" button → `apiSend('POST', '/api/notes/'+encodedId+'/clone')` → on `{ id }` open `serverurl + '/' + id` in a new tab.
  - **Template toggle** on My-Notes rows: a control (e.g. a star/"template" button) → `PUT /api/notes/:id/template` with `{ template: !current }`; show a **"template" badge** when `note.template` is true (now available from `getMyNoteList`).
  - **"New from template"** control near the dashboard "New note" button: opens a Bootstrap-3 modal listing `GET /api/templates` (title + owner); choosing one POSTs clone and opens the new note. Empty state: "No templates yet — mark one of your notes as a template."

- [ ] **Step 2: Build** — `NODE_OPTIONS=--openssl-legacy-provider npm run build` (no errors).

- [ ] **Step 3: Manual verify (drive the app)** — copy a note from a row → new owned note opens; toggle a note as template → badge appears + it shows in "New from template"; create from template → new note. Screenshot.

- [ ] **Step 4: Lint + commit** (touch only `public/js/dashboard.js`, `public/views/dashboard.ejs`; not `public/build`).

```bash
npx standard public/js/dashboard.js
git commit -m "feat(dashboard): copy action, template toggle/badge, new-from-template"
```

---

## Task 7: Published (pretty) view — copy button

**Files:** Modify `public/views/pretty.ejs`; rebuild if needed.

- [ ] **Step 1: Implement** — add a **"Make a copy"** button to `pretty.ejs` and a small `<script nonce="<%= cspNonce %>">` that, on click, POSTs to clone and opens the result. **Note-id derivation (corrected):** the published view's `window.location.pathname` is `/s/:shortid` (or `/s/:alias`), NOT a bare note id. Take the **last path segment** and POST to that — it resolves server-side via `parseNoteIdAsync`'s shortid/alias handling:
```html
<script nonce="<%= cspNonce %>">
  document.querySelector('.ui-make-copy').addEventListener('click', function () {
    var seg = window.location.pathname.split('/').filter(Boolean).pop()
    fetch('<%- serverURL %>/api/notes/' + seg + '/clone', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (d) { if (d.id) window.open('<%- serverURL %>/' + d.id, '_blank') })
  })
</script>
```
Use the EJS `<%- serverURL %>` template local (available in pretty.ejs) — `pretty.js` has no `serverurl` JS global. `cspNonce` is passed by `showPublishNote` (`cspNonce: res.locals.nonce`). Mirror the nonce'd inline-script pattern in `public/views/shared/disqus.ejs`.

- [ ] **Step 2: Manual verify** — open a published note (`/s/:shortid` or the note view), click Make a copy → your copy opens. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add public/views/pretty.ejs
git commit -m "feat(pretty): Make a copy button on the published view"
```

---

## Task 8: Editor menu — Make a copy (the heavy surface)

**Files:** Modify `public/views/codimd/header.ejs`, `public/js/index.js`; rebuild.

> The editor bundle is large; verify live. The current note id is the imported `noteid` in `public/js/index.js`. No CSRF token needed (`/api/*` has no csurf; session + same-origin, like `dashboard.js`).

- [ ] **Step 1: Implement**
  - In `public/views/codimd/header.ejs`, add a dropdown menu item. **Mirror the `<li role="presentation"><a role="menuitem" class="ui-new">` shape at line ~28** (the dropdown item), NOT the bare `<a class="ui-new">` button at line ~125. Add it to both dropdown menu blocks (the `visible-xs` mobile menu and the desktop Menu dropdown): `<li role="presentation"><a role="menuitem" class="ui-make-copy" tabindex="-1" href="#"><i class="fa fa-copy fa-fw"></i> <%= __('Make a copy') %></a></li>`.
  - In `public/js/index.js`, bind a delegated handler: `$(document).on('click', '.ui-make-copy', function (e) { e.preventDefault(); ... })` that `fetch`es `POST ${serverurl}/api/notes/${noteid}/clone` (credentials same-origin) and on `{ id }` opens `serverurl + '/' + id` in a new tab. (`serverurl` and `noteid` are already in scope in index.js.)

- [ ] **Step 2: Build** — `NODE_OPTIONS=--openssl-legacy-provider npm run build` (no errors).

- [ ] **Step 3: Manual verify (drive the app)** — open a note in the editor, use the menu "Make a copy" → a new owned copy opens. Test on a read-only handout (a note with `protected`/`locked` permission owned by someone else) → the copy is created and editable. Screenshot.

- [ ] **Step 4: Lint + commit** (touch only `public/views/codimd/header.ejs`, `public/js/index.js`).

```bash
npx standard public/js/index.js
git commit -m "feat(editor): Make a copy menu item"
```

---

## Task 9: Docs + full green gate

- [ ] **Step 1: CLAUDE.md** — add a short "Copy & templates" note: `lib/teach` (`cloneNote`/`setTemplate`/`listTemplates` + `/api/notes/:id/clone`, `/api/notes/:id/template`, `/api/templates`); the `Note.template` flag; clone is content-only with a derived title; handouts = existing read-only permission + the copy button. Note the teacher workflow: publish handouts / set `protected` permission, share the link, students "Make a copy".

- [ ] **Step 2: Full gate**

Run: `NODE_ENV=test npm run test:ci` (lint + jsonlint + coverage pass).
Run: `NODE_OPTIONS=--openssl-legacy-provider npm run build`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note copy & templates in CLAUDE.md"
```

---

## Notes & Risk Areas

- **Derived clone title** is load-bearing: without `title: Note.parseNoteTitle(content)` the dashboard row is blank. Tested in Task 2.
- **Clone permission:** viewable = `permission != 'private' OR mine`; a private note you don't own → 403. The HTTP test guards it.
- **Test seeding:** real `User`s for any `Note.create`; clone-source notes need `content`.
- **Mounting + encoded ids:** teach router is `/api/*`-only, above `/:noteId`, per-route auth; ids via `parseNoteIdAsync`.
- **HTTP test isolation:** `removeLibModuleCache` before/after + shared `models` (else it pollutes the realtime suite).
- **Editor surface (Task 8):** heaviest; the `noteid`/`serverurl` are already in `index.js` scope; no csurf needed. Verify live.
- **exports in lib/teach:** `{ cloneNote }` then `Object.assign(..., { setTemplate, listTemplates })` then `module.exports.router = router` — never reassign.
- **Bundle build:** Node 16 or `--openssl-legacy-provider`.
