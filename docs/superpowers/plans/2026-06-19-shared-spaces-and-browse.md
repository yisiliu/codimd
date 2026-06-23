# Shared Spaces & Browse (Slice 2b/2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shared "Spaces" (institute-wide collections any member creates), owner opt-in via a `NoteSpace` join, and a Browse view of the lab's notes the viewer may see — respecting each note's existing permission.

**Architecture:** New `Space` + `NoteSpace` Sequelize models (no DB FKs; app-level cleanup). A `lib/browse/` service+router exposes member/creator/owner-guarded endpoints for spaces, note↔space assignment, and a permission-filtered browse query. The dashboard gains a "My Notes ⇄ Browse" toggle. Note ids are parsed server-side; routes are `/api/*`-only, mounted above the `/:noteId` catch-all.

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (SQLite `:memory:` tests, Postgres prod), EJS + Bootstrap 3 + `list.js`, mocha + power-assert + supertest. CommonJS, `standard` (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-19-shared-spaces-and-browse-design.md`

**Critical repo facts (learned in prior slices — do not relearn the hard way):**
- **No enforced DB FKs except `Notes.ownerId`** (it carries `onDelete:'CASCADE'`, so sqlite enforces it). Therefore: any test that creates a `Note` with an `ownerId` MUST seed a real `User` first — `User.create({})` (no password → no slow scrypt) and use its `.id`.
- **Note title hook:** `Note.beforeCreate` overwrites `title` from `public/default.md` when `content` is empty. Tests that assert a note's title must create it WITH `content`.
- **Cleanup is app-level** (no FK cascade): do it explicitly in services.
- **Encoded note ids:** `/api/notes/myNotes` returns base64url-encoded ids; mutation routes parse them server-side via `Note.parseNoteIdAsync` (the client must not decode).
- **Mounting:** the router must define ONLY `/api/*` routes, carry NO root-level `router.use(guard)`, and mount above the `/:noteId` catch-all (`lib/routes.js`).
- **HTTP tests** use `test/helpers/httpApp.js` (`buildApp(user)`); the test file must manage the lib require-cache (clear before via `removeLibModuleCache`, share one `models` instance with the harness, clear after) — see `test/http/routing.test.js` for the exact pattern.
- Test DB helper: `test/helpers/db.js` exports `{ models, resetDb }` (sqlite `:memory:`, sync from models).

---

## File Structure

**Create:** `lib/models/space.js`, `lib/models/notespace.js`, `lib/migrations/20260619000002-add-spaces.js`, `lib/browse/index.js`, and tests under `test/models/`, `test/browse/`, `test/http/`.
**Modify:** `lib/models/note.js` (associations), `lib/note/index.js` (`cleanupNoteOrganization` + destructure), `lib/routes.js` (mount), `public/views/dashboard.ejs` + `public/js/dashboard.js` (My Notes space control + Browse view).

---

## Task 1: Space model

**Files:** Create `lib/models/space.js`; Test `test/models/space.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Space model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('stores display name and derives nameLower', async function () {
    const s = await models.Space.create({ name: '  ML-Course  ', createdById: 'u1' })
    assert.strictEqual(s.name, 'ML-Course')
    assert.strictEqual(s.nameLower, 'ml-course')
  })

  it('rejects a case-insensitive duplicate name', async function () {
    await models.Space.create({ name: 'ML-Course', createdById: 'u1' })
    await assert.rejects(() => models.Space.create({ name: 'ml-course', createdById: 'u2' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/space.test.js`
Expected: FAIL (Space undefined).

- [ ] **Step 3: Implement `lib/models/space.js`**

```js
'use strict'

module.exports = function (sequelize, DataTypes) {
  const Space = sequelize.define('Space', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    },
    nameLower: {
      type: DataTypes.STRING,
      allowNull: false
    },
    createdById: {
      type: DataTypes.UUID
    }
  }, {
    indexes: [{ unique: true, fields: ['nameLower'] }]
  })

  function normalize (space) {
    if (space.name) {
      space.name = space.name.trim()
      space.nameLower = space.name.toLowerCase()
    }
  }
  Space.addHook('beforeValidate', normalize)

  Space.associate = function (models) {
    Space.belongsTo(models.User, { foreignKey: 'createdById', constraints: false })
    // NB: no `Space.hasMany(NoteSpace)` here — NoteSpace is created in Task 2 and the
    // model loader runs associate() eagerly, so referencing it now throws when only
    // space.js exists. The services query NoteSpace directly, so the reverse
    // association is unused anyway.
  }

  return Space
}
```

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/space.test.js`
Expected: PASS (2 passing).

```bash
npx standard lib/models/space.js
git add lib/models/space.js test/models/space.test.js
git commit -m "feat(space): add Space model with case-insensitive unique name"
```

---

## Task 2: NoteSpace model

**Files:** Create `lib/models/notespace.js`; Test `test/models/notespace.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('NoteSpace model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('rejects a duplicate (noteId, spaceId)', async function () {
    await models.NoteSpace.create({ noteId: 'n1', spaceId: 's1' })
    await assert.rejects(() => models.NoteSpace.create({ noteId: 'n1', spaceId: 's1' }))
  })

  it('allows the same note in different spaces', async function () {
    await models.NoteSpace.create({ noteId: 'n1', spaceId: 's1' })
    const ns = await models.NoteSpace.create({ noteId: 'n1', spaceId: 's2' })
    assert.ok(ns.id)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/notespace.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/models/notespace.js`**

```js
'use strict'

module.exports = function (sequelize, DataTypes) {
  const NoteSpace = sequelize.define('NoteSpace', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    noteId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    spaceId: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    indexes: [{ unique: true, fields: ['noteId', 'spaceId'] }]
  })

  NoteSpace.associate = function (models) {
    NoteSpace.belongsTo(models.Note, { foreignKey: 'noteId', constraints: false })
    NoteSpace.belongsTo(models.Space, { foreignKey: 'spaceId', constraints: false })
  }

  return NoteSpace
}
```

- [ ] **Step 4: Run pass + lint + commit**

```bash
npx standard lib/models/notespace.js
git add lib/models/notespace.js test/models/notespace.test.js
git commit -m "feat(notespace): add NoteSpace join model"
```
Expected test: PASS (2 passing).

---

## Task 3: Note associations + migration

**Files:** Modify `lib/models/note.js`; Create `lib/migrations/20260619000002-add-spaces.js`

- [ ] **Step 1: Add associations** to the existing `Note.associate` body in `lib/models/note.js`:

```js
    Note.hasMany(models.NoteSpace, { foreignKey: 'noteId', constraints: false })
```

(No test needed for this one line; it is covered by Task 6's assignment tests. Verify nothing breaks: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models --recursive` — all passing.)

- [ ] **Step 2: Write the migration** `lib/migrations/20260619000002-add-spaces.js`

```js
'use strict'
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('Spaces', {
      id: { type: Sequelize.UUID, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      nameLower: { type: Sequelize.STRING, allowNull: false },
      createdById: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('Spaces', ['nameLower'], { unique: true, name: 'spaces_namelower_unique' })

    await queryInterface.createTable('NoteSpaces', {
      id: { type: Sequelize.UUID, primaryKey: true },
      noteId: { type: Sequelize.UUID, allowNull: false },
      spaceId: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('NoteSpaces', ['noteId', 'spaceId'], { unique: true, name: 'notespaces_note_space_unique' })
  },
  down: async function (queryInterface) {
    await queryInterface.dropTable('NoteSpaces')
    await queryInterface.dropTable('Spaces')
  }
}
```

- [ ] **Step 3: Verify migration on a fresh DB**

Run: `cp -n .sequelizerc.example .sequelizerc 2>/dev/null; rm -f /tmp/spaces-mig.sqlite && CMD_DB_URL="sqlite:///tmp/spaces-mig.sqlite" NODE_ENV=production npx sequelize db:migrate --migrations-path lib/migrations 2>&1 | tail -8`
Expected: the new migration runs with no error. Do NOT commit `.sequelizerc` or any sqlite file.

- [ ] **Step 4: Lint + commit**

```bash
npx standard lib/models/note.js lib/migrations/20260619000002-add-spaces.js
git add lib/models/note.js lib/migrations/20260619000002-add-spaces.js
git commit -m "feat(db): Note↔Space association + spaces migration"
```

---

## Task 4: Space services (create / list-with-counts / rename / delete)

**Files:** Create `lib/browse/index.js`; Test `test/browse/spaces.test.js`

> Authz: create = any member; rename/delete = creator OR teacher. Counts = non-private notes in the space. Cleanup on delete is app-level.

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const browse = require('../../lib/browse/index')

describe('space services', function () {
  this.timeout(10000)
  let u1, u2, teacher
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
    teacher = (await models.User.create({ role: 'teacher' })).id
  })

  it('any member creates a space; dedup is case-insensitive', async function () {
    const s = await browse.createSpace(u1, 'ML-Course')
    assert.strictEqual(s.name, 'ML-Course')
    await assert.rejects(() => browse.createSpace(u2, 'ml-course'), /exists/i)
  })

  it('lists spaces with a non-private note count', async function () {
    const s = await browse.createSpace(u1, 'S')
    const pub = await models.Note.create({ ownerId: u1, content: 'x', permission: 'editable' })
    const priv = await models.Note.create({ ownerId: u1, content: 'y', permission: 'private' })
    await models.NoteSpace.create({ noteId: pub.id, spaceId: s.id })
    await models.NoteSpace.create({ noteId: priv.id, spaceId: s.id })
    const list = await browse.listSpaces()
    const row = list.find(x => x.id === s.id)
    assert.strictEqual(row.count, 1) // private excluded from the count
  })

  it('rename/delete allowed for the creator', async function () {
    const s = await browse.createSpace(u1, 'Old')
    await browse.renameSpace({ id: u1, role: 'student' }, s.id, 'New')
    assert.strictEqual((await models.Space.findByPk(s.id)).name, 'New')
    await browse.deleteSpace({ id: u1, role: 'student' }, s.id)
    assert.strictEqual(await models.Space.count(), 0)
  })

  it('rename/delete allowed for a teacher, refused for an unrelated member', async function () {
    const s = await browse.createSpace(u1, 'Shared')
    await assert.rejects(() => browse.deleteSpace({ id: u2, role: 'student' }, s.id), /forbidden/i)
    await browse.renameSpace({ id: teacher, role: 'teacher' }, s.id, 'Renamed')
    assert.strictEqual((await models.Space.findByPk(s.id)).name, 'Renamed')
  })

  it('delete removes the space\'s NoteSpace links (notes survive)', async function () {
    const s = await browse.createSpace(u1, 'X')
    const n = await models.Note.create({ ownerId: u1, content: 'z' })
    await models.NoteSpace.create({ noteId: n.id, spaceId: s.id })
    await browse.deleteSpace({ id: u1, role: 'student' }, s.id)
    assert.strictEqual(await models.NoteSpace.count(), 0)
    assert.ok(await models.Note.findByPk(n.id))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/browse/spaces.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the space services in `lib/browse/index.js`**

```js
'use strict'
const { Op } = require('sequelize')
const models = require('../models')

// A note is viewable by `userId` iff it is not private, or they own it.
// NULL-safe: legacy NULL-permission rows are viewable (matches newCheckViewPermission).
function viewableWhere (userId) {
  return { [Op.or]: [{ ownerId: userId }, { permission: null }, { permission: { [Op.ne]: 'private' } }] }
}

// non-private (shared-visible) predicate for counts
const nonPrivateWhere = { [Op.or]: [{ permission: null }, { permission: { [Op.ne]: 'private' } }] }

async function createSpace (userId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('space name required')
  const existing = await models.Space.findOne({ where: { nameLower: trimmed.toLowerCase() } })
  if (existing) throw new Error('a space with that name already exists')
  return models.Space.create({ name: trimmed, createdById: userId })
}

async function listSpaces () {
  const spaces = await models.Space.findAll({ order: [['name', 'ASC']] })
  return Promise.all(spaces.map(async space => {
    const links = await models.NoteSpace.findAll({ where: { spaceId: space.id } })
    const noteIds = links.map(l => l.noteId)
    const count = noteIds.length
      ? await models.Note.count({ where: { id: noteIds, ...nonPrivateWhere } })
      : 0
    return { id: space.id, name: space.name, createdById: space.createdById, count }
  }))
}

// creator OR teacher
async function mutableSpace (user, spaceId) {
  const space = await models.Space.findByPk(spaceId)
  if (!space) throw new Error('space-not-found')
  const isCreator = String(space.createdById) === String(user.id)
  const isTeacher = user.role === 'teacher'
  if (!isCreator && !isTeacher) throw new Error('forbidden')
  return space
}

async function renameSpace (user, spaceId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('space name required')
  const space = await mutableSpace(user, spaceId)
  const clash = await models.Space.findOne({ where: { nameLower: trimmed.toLowerCase() } })
  if (clash && String(clash.id) !== String(space.id)) throw new Error('a space with that name already exists')
  space.name = trimmed
  await space.save({ fields: ['name', 'nameLower'] })
  return space
}

async function deleteSpace (user, spaceId) {
  await mutableSpace(user, spaceId)
  await models.NoteSpace.destroy({ where: { spaceId } })
  await models.Space.destroy({ where: { id: spaceId } })
}

module.exports = { createSpace, listSpaces, renameSpace, deleteSpace, viewableWhere, nonPrivateWhere }
```

> Note: `space.save({ fields: ['name', 'nameLower'] })` — `nameLower` is recomputed by the `beforeValidate` hook from the new `name`, so include it in the saved fields.

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/browse/spaces.test.js`
Expected: PASS (5 passing).

```bash
npx standard lib/browse/index.js
git add lib/browse/index.js test/browse/spaces.test.js
git commit -m "feat(browse): space create/list/rename/delete services"
```

---

## Task 5: Note↔space assignment + browse query

**Files:** Modify `lib/browse/index.js`; Test `test/browse/assign-and-browse.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const browse = require('../../lib/browse/index')

describe('note↔space assignment + browse', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('owner sets their note\'s spaces; bogus ids ignored; empty clears', async function () {
    const s1 = await browse.createSpace(u1, 'A')
    const s2 = await browse.createSpace(u1, 'B')
    const n = await models.Note.create({ ownerId: u1, content: 'x' })
    await browse.setNoteSpaces(u1, n.id, [s1.id, s2.id, 'bogus-id'])
    assert.strictEqual(await models.NoteSpace.count({ where: { noteId: n.id } }), 2)
    await browse.setNoteSpaces(u1, n.id, [])
    assert.strictEqual(await models.NoteSpace.count({ where: { noteId: n.id } }), 0)
  })

  it('refuses to set spaces on a note I do not own', async function () {
    const s = await browse.createSpace(u2, 'C')
    const n = await models.Note.create({ ownerId: u2, content: 'y' })
    await assert.rejects(() => browse.setNoteSpaces(u1, n.id, [s.id]), /note-not-found/i)
  })

  it('browse lists viewable categorized notes; hides others\' private; shows my own private', async function () {
    const s = await browse.createSpace(u1, 'S')
    const mine = await models.Note.create({ ownerId: u1, title: 'Mine', content: '# Mine', permission: 'editable' })
    const otherPub = await models.Note.create({ ownerId: u2, title: 'Pub', content: '# Pub', permission: 'editable' })
    const otherPriv = await models.Note.create({ ownerId: u2, title: 'Secret', content: '# Secret', permission: 'private' })
    const myPriv = await models.Note.create({ ownerId: u1, title: 'MyPriv', content: '# MyPriv', permission: 'private' })
    for (const note of [mine, otherPub, otherPriv, myPriv]) await models.NoteSpace.create({ noteId: note.id, spaceId: s.id })

    const list = await browse.listBrowse(u1, { space: s.id })
    const titles = list.map(r => r.text).sort()
    assert.deepStrictEqual(titles, ['Mine', 'MyPriv', 'Pub']) // Secret (other's private) excluded
    assert.ok(list.every(r => typeof r.owner === 'string'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/browse/assign-and-browse.test.js`
Expected: FAIL.

- [ ] **Step 3: Add to `lib/browse/index.js`**

```js
async function ownedNote (ownerId, noteId) {
  const note = await models.Note.findByPk(noteId)
  if (!note || String(note.ownerId) !== String(ownerId)) throw new Error('note-not-found')
  return note
}

async function setNoteSpaces (ownerId, noteId, spaceIds) {
  await ownedNote(ownerId, noteId)
  const ids = Array.isArray(spaceIds) ? spaceIds : []
  // keep only spaces that actually exist (no FKs to enforce this)
  const valid = ids.length
    ? (await models.Space.findAll({ where: { id: ids } })).map(s => String(s.id))
    : []
  await models.NoteSpace.destroy({ where: { noteId } })
  for (const spaceId of valid) {
    await models.NoteSpace.findOrCreate({ where: { noteId, spaceId }, defaults: { noteId, spaceId } })
  }
}

async function spacesForNote (noteId) {
  const links = await models.NoteSpace.findAll({ where: { noteId } })
  if (!links.length) return []
  const spaces = await models.Space.findAll({ where: { id: links.map(l => l.spaceId) } })
  return spaces.map(s => ({ id: s.id, name: s.name }))
}

// Browse: notes in `space` (or any space when omitted) that `userId` may view.
async function listBrowse (userId, { space } = {}) {
  const linkWhere = space ? { spaceId: space } : {}
  const links = await models.NoteSpace.findAll({ where: linkWhere })
  const noteIds = [...new Set(links.map(l => l.noteId))]
  if (!noteIds.length) return []
  const notes = await models.Note.findAll({ where: { id: noteIds, ...viewableWhere(userId) } })
  return Promise.all(notes.map(async note => {
    const owner = await models.User.findByPk(note.ownerId)
    const profile = owner ? models.User.getProfile(owner) : null
    return {
      id: models.Note.encodeNoteId(note.id),
      text: note.title,
      owner: (profile && profile.name) || 'Unknown',
      spaces: await spacesForNote(note.id),
      lastchangeAt: note.lastchangeAt,
      shortId: note.shortid
    }
  }))
}

Object.assign(module.exports, { setNoteSpaces, spacesForNote, listBrowse, ownedNote })
```

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/browse/assign-and-browse.test.js`
Expected: PASS (3 passing).

```bash
npx standard lib/browse/index.js
git add lib/browse/index.js test/browse/assign-and-browse.test.js
git commit -m "feat(browse): note↔space assignment + permission-filtered browse query"
```

---

## Task 6: Extend `cleanupNoteOrganization` to remove NoteSpace

**Files:** Modify `lib/note/index.js`; Test `test/note/cleanupSpaces.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const noteCtl = require('../../lib/note/index')

describe('note delete cleans up NoteSpace links', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('removes a note\'s space links on cleanup', async function () {
    const n = await models.Note.create({ ownerId: u1, content: 'x' })
    await models.NoteSpace.create({ noteId: n.id, spaceId: 's1' })
    await noteCtl.cleanupNoteOrganization(n.id)
    assert.strictEqual(await models.NoteSpace.count({ where: { noteId: n.id } }), 0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note/cleanupSpaces.test.js`
Expected: FAIL (NoteSpace rows remain).

- [ ] **Step 3: Implement** — in `lib/note/index.js`, add `NoteSpace` to the destructured models require at the top (`const { Note, User, Revision, NoteTag, NoteSpace } = require('../models')`), and extend `cleanupNoteOrganization`:

```js
async function cleanupNoteOrganization (noteId) {
  await NoteTag.destroy({ where: { noteId } })
  await NoteSpace.destroy({ where: { noteId } })
}
```

- [ ] **Step 4: Run pass + full note suite + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note --recursive`
Expected: PASS.

```bash
npx standard lib/note/index.js
git add lib/note/index.js test/note/cleanupSpaces.test.js
git commit -m "fix(note): remove NoteSpace links when a note is deleted"
```

---

## Task 7: Browse router + mount

**Files:** Modify `lib/browse/index.js` (router); Modify `lib/routes.js`; Test `test/http/browse.test.js`

> Mirror the dashboard router: per-route auth, encoded-id parse, `/api/*`-only, no root `router.use`. Use the same `requireAuth`/`handle` shape as `lib/dashboard/index.js`.

- [ ] **Step 1: Add the router to `lib/browse/index.js`**

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
router.get('/api/spaces', requireAuth, handle(async req => ({ spaces: await listSpaces() })))
router.post('/api/spaces', requireAuth, jsonParser, handle(async req => ({ space: await createSpace(req.user.id, req.body.name) })))
router.put('/api/spaces/:id', requireAuth, jsonParser, handle(async req => ({ space: await renameSpace(req.user, req.params.id, req.body.name) })))
router.delete('/api/spaces/:id', requireAuth, handle(async req => { await deleteSpace(req.user, req.params.id) }))
router.put('/api/notes/:id/spaces', requireAuth, jsonParser, handle(async req => { await setNoteSpaces(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.spaceIds) }))
router.get('/api/browse', requireAuth, handle(async req => ({ notes: await listBrowse(req.user.id, { space: req.query.space }) })))

module.exports.router = router
```

> Note: `renameSpace`/`deleteSpace` take the whole `req.user` (need `.id` + `.role`); `createSpace`/`setNoteSpaces` take `req.user.id`. Keep the single `module.exports = { ... }` from Tasks 4–5 and add `.router` by property assignment (do not reassign module.exports).

- [ ] **Step 2: Mount in `lib/routes.js`** (above the `/:noteId` catch-all, near the other `appRouter.use(require('./...'))` mounts):

```js
appRouter.use(require('./browse').router)
```

- [ ] **Step 3: Write the HTTP test** `test/http/browse.test.js` — follow the cache-management pattern from `test/http/routing.test.js` exactly (clear lib cache in `before`, share one `models` instance with the harness, clear in `after`).

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: spaces & browse', function () {
  this.timeout(15000)
  let models, buildApp, browse, u1, u2

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    browse = require('../../lib/browse/index')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('anonymous /api/spaces is 401', async function () {
    assert.strictEqual((await request(buildApp(null)).get('/api/spaces')).status, 401)
  })

  it('a member can create + list spaces', async function () {
    const app = buildApp({ id: u1, role: 'student', active: true })
    const created = await request(app).post('/api/spaces').send({ name: 'ML' })
    assert.strictEqual(created.status, 200)
    const list = await request(app).get('/api/spaces')
    assert.strictEqual(list.body.spaces.length, 1)
  })

  it('non-creator non-teacher cannot delete a space (403)', async function () {
    const space = await browse.createSpace(u1, 'Owned')
    const res = await request(buildApp({ id: u2, role: 'student', active: true })).delete(`/api/spaces/${space.id}`)
    assert.strictEqual(res.status, 403)
  })

  it('owner cannot put spaces on another user\'s note (403)', async function () {
    const space = await browse.createSpace(u2, 'X')
    const note = await models.Note.create({ ownerId: u2, content: 'x' })
    const encoded = models.Note.encodeNoteId(note.id)
    const res = await request(buildApp({ id: u1, role: 'student', active: true }))
      .put(`/api/notes/${encoded}/spaces`).send({ spaceIds: [space.id] })
    assert.strictEqual(res.status, 403)
  })

  it('browse hides another owner\'s private note', async function () {
    const space = await browse.createSpace(u1, 'S')
    const priv = await models.Note.create({ ownerId: u2, content: '# secret', permission: 'private' })
    await models.NoteSpace.create({ noteId: priv.id, spaceId: space.id })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).get(`/api/browse?space=${space.id}`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.notes.length, 0)
  })
})
```

- [ ] **Step 4: Run + full suite + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/http/browse.test.js` (5 passing), then `NODE_ENV=test npm run mocha` (full suite, no regression).

```bash
npx standard lib/browse/index.js lib/routes.js
git add lib/browse/index.js lib/routes.js test/http/browse.test.js
git commit -m "feat(browse): /api spaces + browse router, owner/creator/teacher guarded"
```

---

## Task 8: My Notes — owner space-assignment control + shared badge

**Files:** Modify `public/views/dashboard.ejs`, `public/js/dashboard.js`; rebuild bundle.

- [ ] **Step 1: Implement** — on each My-Notes note row, add a **"Shared space"** control (a multi-select or a chips+dropdown) labelled clearly distinct from the private **tag** chips, plus a small **"shared" badge** when the note is in ≥1 space. Wire it to `PUT /api/notes/:id/spaces` with the encoded id and `{ spaceIds }`; offer one-action un-share. Fetch the space list (`GET /api/spaces`) for the dropdown, and the note's current spaces (extend `getMyNoteList` to include `spaces`, OR fetch per note — prefer extending `getMyNoteList` with a `spaces` array, mirroring how `userTags` was added in Slice 2a). Follow the existing `public/js/dashboard.js` conventions.
   - If extending `getMyNoteList` (`lib/note/index.js`): add `spaces: await require('../browse').spacesForNote(note.id)` to each row. (Adds a small per-note query; fine at this scale.)

- [ ] **Step 2: Build** — `NODE_OPTIONS=--openssl-legacy-provider npm run build` (or Node 16). Confirm no errors.

- [ ] **Step 3: Manual verify (drive the app)** — sign in, open My Notes, add a note to a space, confirm the "shared" badge appears and `GET /api/browse` now returns it; un-share and confirm it disappears. Screenshot.

- [ ] **Step 4: Commit** (touch only `public/js/dashboard.js`, `public/views/dashboard.ejs`, and `lib/note/index.js` if you extended `getMyNoteList`; do NOT commit `public/build`).

```bash
git commit -m "feat(dashboard): owner space-assignment control + shared badge"
```

---

## Task 9: Browse view (My Notes ⇄ Browse toggle)

**Files:** Modify `public/views/dashboard.ejs`, `public/js/dashboard.js`; rebuild.

- [ ] **Step 1: Implement** — add a **"My Notes" ⇄ "Browse"** toggle. The Browse panel: a spaces sidebar (`All shared` + each space with its non-private count from `GET /api/spaces`; show rename/delete affordances only when `createdById === me` or I am a teacher — the page already knows the user; pass `me`/`role` into the view), and a notes list from `GET /api/browse?space=` showing **owner name**, title (opens in a new tab), and the note's spaces, with `list.js` search + space filter. **Empty state** teaches the path: "No shared notes yet — open a note from My Notes and add it to a space." Reuse the cover chrome + the dashboard CSS (note rows already styled).

- [ ] **Step 2: Build + manual verify** — as two users: u1 shares a note into "ML-Course"; u2 (different account) opens Browse, sees it under ML-Course with u1's name; u2 cannot see u1's private note. Rename a space as its creator; confirm. Screenshot.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): Browse view for shared spaces"
```

---

## Task 10: Docs + full green gate

- [ ] **Step 1: CLAUDE.md** — under the dashboard section, note Spaces (`lib/models/space.js`, `notespace.js`), the `lib/browse` owner/creator/teacher-guarded API, the Browse view, and that browse visibility is `permission != 'private' OR mine` (NULL-safe).

- [ ] **Step 2: Full gate**

Run: `NODE_ENV=test npm run test:ci` (lint + jsonlint + coverage all pass).
Run: `NODE_OPTIONS=--openssl-legacy-provider npm run build`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note shared spaces & browse in CLAUDE.md"
```

---

## Notes & Risk Areas

- **No DB FKs:** all cleanup app-level (space delete → NoteSpace rows; note delete → cleanupNoteOrganization). `setNoteSpaces` filters bogus space ids itself.
- **Test seeding:** every `Note.create` with `ownerId` needs a real seeded `User` (`User.create({})`); notes whose title is asserted need `content`.
- **Permission filter NULL-safety:** `{ [Op.or]: [{ ownerId }, { permission: null }, { permission: { [Op.ne]: 'private' } }] }` — covers legacy NULL rows.
- **Mounting + encoded ids:** browse router is `/api/*`-only, mounted above `/:noteId`; note ids parsed via `parseNoteIdAsync`. HTTP test guards 401/403/visibility.
- **HTTP test isolation:** use the `removeLibModuleCache` before/after + shared-`models` pattern (test/http/routing.test.js) or the suite pollutes the realtime tests.
- **Bundle build:** Node 16 or `--openssl-legacy-provider`.
- **module.exports in lib/browse:** one literal for services (Tasks 4–5), then `module.exports.router = router` (Task 7) by property assignment — never reassign.
