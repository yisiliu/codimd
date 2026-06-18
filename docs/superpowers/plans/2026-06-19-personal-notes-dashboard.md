# Personal Notes Dashboard (Slice 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each signed-in member a Notes Dashboard home: all their owned notes, grouped into flat folders, with user-applied tags, pin, and live search/sort.

**Architecture:** New `Folder` + `NoteTag` Sequelize models and two owner-personal columns (`folderId`, `pinned`) on the existing `Note`. A `lib/dashboard/` service+router exposes owner-guarded folder/tag/pin/file endpoints; `getMyNoteList` is extended to return organization. The signed-in home renders a new `dashboard.ejs` (CodiMD cover chrome) driven by client JS over those APIs. **All cleanup is explicit app-level code — this repo emits no DB foreign keys and SQLite doesn't enforce them.**

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (SQLite `:memory:` for tests, Postgres in prod), EJS + Bootstrap 3 + `list.js`, mocha + power-assert. CommonJS, `standard` lint (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-19-personal-notes-dashboard-design.md`

**Prerequisite (already true on this branch from Slice 1):** deps installed, `config.json` present (test env = SQLite `:memory:`), `sqlite3` devDependency installed, `test/helpers/db.js` exists (exports `{ models, resetDb }`). Run tests with `NODE_ENV=test`.

---

## File Structure

**Create:**
- `lib/models/folder.js` — Folder model (id, ownerId, name) + associate.
- `lib/models/notetag.js` — NoteTag model (id, noteId, tag) + associate.
- `lib/migrations/20260619000001-add-folders-tags-note-org.js` — create tables + add Note columns.
- `lib/dashboard/index.js` — service functions (folders/tags/pin/file) + owner-guarded router.
- `public/views/dashboard.ejs` — signed-in dashboard page.
- `public/js/dashboard.js` — client logic (fetch + render + actions).
- `test/models/folder.test.js`, `test/models/notetag.test.js`, `test/dashboard/folders.test.js`, `test/dashboard/organize.test.js`, `test/note/myNotesOrg.test.js`.

**Modify:**
- `lib/models/note.js` — add `folderId` + `pinned` columns + `belongsTo(Folder)` / `hasMany(NoteTag)`.
- `lib/note/index.js` — extend `getMyNoteList`; add `NoteTag` cleanup in `deleteNote`.
- `lib/routes.js` — mount the dashboard router (above `/:noteId`).
- `lib/homepage/index.js` — render `dashboard` when authenticated.

---

## Task 1: Folder model

**Files:** Create `lib/models/folder.js`; Test `test/models/folder.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Folder model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('creates a folder for an owner', async function () {
    const f = await models.Folder.create({ ownerId: 'u1', name: 'Thesis' })
    assert.strictEqual(f.name, 'Thesis')
    assert.strictEqual(f.ownerId, 'u1')
  })

  it('rejects two folders with the same name for the same owner', async function () {
    await models.Folder.create({ ownerId: 'u1', name: 'Course' })
    await assert.rejects(() => models.Folder.create({ ownerId: 'u1', name: 'Course' }))
  })

  it('allows the same folder name for different owners', async function () {
    await models.Folder.create({ ownerId: 'u1', name: 'Course' })
    const f = await models.Folder.create({ ownerId: 'u2', name: 'Course' })
    assert.ok(f.id)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/folder.test.js`
Expected: FAIL (Folder undefined).

- [ ] **Step 3: Implement `lib/models/folder.js`**

```js
'use strict'

module.exports = function (sequelize, DataTypes) {
  const Folder = sequelize.define('Folder', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    ownerId: {
      type: DataTypes.UUID
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    }
  }, {
    indexes: [{ unique: true, fields: ['ownerId', 'name'] }]
  })

  Folder.associate = function (models) {
    Folder.belongsTo(models.User, { foreignKey: 'ownerId', constraints: false })
    Folder.hasMany(models.Note, { foreignKey: 'folderId', constraints: false })
  }

  return Folder
}
```

- [ ] **Step 4: Run to verify pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/folder.test.js`
Expected: PASS (3 passing).

```bash
npx standard lib/models/folder.js
git add lib/models/folder.js test/models/folder.test.js
git commit -m "feat(folder): add Folder model with per-owner unique name"
```

---

## Task 2: NoteTag model

**Files:** Create `lib/models/notetag.js`; Test `test/models/notetag.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('NoteTag model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('normalizes tags to trimmed lowercase', async function () {
    const t = await models.NoteTag.create({ noteId: 'n1', tag: '  Machine Learning  ' })
    assert.strictEqual(t.tag, 'machine learning')
  })

  it('rejects a duplicate (noteId, tag)', async function () {
    await models.NoteTag.create({ noteId: 'n1', tag: 'ml' })
    await assert.rejects(() => models.NoteTag.create({ noteId: 'n1', tag: 'ML' }))
  })

  it('allows the same tag on different notes', async function () {
    await models.NoteTag.create({ noteId: 'n1', tag: 'ml' })
    const t = await models.NoteTag.create({ noteId: 'n2', tag: 'ml' })
    assert.ok(t.id)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/notetag.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/models/notetag.js`**

```js
'use strict'

module.exports = function (sequelize, DataTypes) {
  const NoteTag = sequelize.define('NoteTag', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    noteId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    tag: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    }
  }, {
    indexes: [{ unique: true, fields: ['noteId', 'tag'] }]
  })

  function normalize (instance) {
    if (instance.tag) instance.tag = instance.tag.trim().toLowerCase()
  }
  NoteTag.addHook('beforeValidate', normalize)

  NoteTag.associate = function (models) {
    NoteTag.belongsTo(models.Note, { foreignKey: 'noteId', constraints: false })
  }

  return NoteTag
}
```

> Note: normalize in `beforeValidate` so `notEmpty` validation and the unique index both see the normalized value.

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/notetag.test.js`
Expected: PASS (3 passing).

```bash
npx standard lib/models/notetag.js
git add lib/models/notetag.js test/models/notetag.test.js
git commit -m "feat(notetag): add NoteTag model with normalization + uniqueness"
```

---

## Task 3: Note model — folderId + pinned columns + associations

**Files:** Modify `lib/models/note.js`; Test `test/models/note-org.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Note organization columns', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('defaults to unfiled + unpinned', async function () {
    const n = await models.Note.create({})
    assert.strictEqual(n.folderId, null)
    assert.strictEqual(n.pinned, false)
  })

  it('stores folderId and pinned', async function () {
    const f = await models.Folder.create({ ownerId: 'u1', name: 'F' })
    const n = await models.Note.create({ ownerId: 'u1', folderId: f.id, pinned: true })
    assert.strictEqual(n.folderId, f.id)
    assert.strictEqual(n.pinned, true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/note-org.test.js`
Expected: FAIL (folderId/pinned undefined → null vs undefined mismatch or column missing).

- [ ] **Step 3: Implement — add to the `Note` attribute map in `lib/models/note.js`**

Add these two attributes (e.g. right after the `content` attribute, before the closing `}` of the attribute object):

```js
    folderId: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null
    },
    pinned: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
```

Then add to the existing `Note.associate = function (models) { ... }` body:

```js
    Note.belongsTo(models.Folder, { foreignKey: 'folderId', constraints: false })
    Note.hasMany(models.NoteTag, { foreignKey: 'noteId', constraints: false })
```

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/note-org.test.js`
Expected: PASS (2 passing).

```bash
npx standard lib/models/note.js
git add lib/models/note.js test/models/note-org.test.js
git commit -m "feat(note): add folderId + pinned owner-personal columns"
```

---

## Task 4: Migration

**Files:** Create `lib/migrations/20260619000001-add-folders-tags-note-org.js`

> Keep column/index defs in lockstep with the models (the suite syncs from models, so this file is verified manually only).

- [ ] **Step 1: Write the migration**

```js
'use strict'
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('Folders', {
      id: { type: Sequelize.UUID, primaryKey: true },
      ownerId: { type: Sequelize.UUID, allowNull: true },
      name: { type: Sequelize.STRING, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('Folders', ['ownerId', 'name'], { unique: true, name: 'folders_owner_name_unique' })

    await queryInterface.createTable('NoteTags', {
      id: { type: Sequelize.UUID, primaryKey: true },
      noteId: { type: Sequelize.UUID, allowNull: false },
      tag: { type: Sequelize.STRING, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('NoteTags', ['noteId', 'tag'], { unique: true, name: 'notetags_note_tag_unique' })

    await queryInterface.addColumn('Notes', 'folderId', { type: Sequelize.UUID, allowNull: true, defaultValue: null })
    await queryInterface.addColumn('Notes', 'pinned', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false })
  },
  down: async function (queryInterface) {
    await queryInterface.removeColumn('Notes', 'pinned')
    await queryInterface.removeColumn('Notes', 'folderId')
    await queryInterface.dropTable('NoteTags')
    await queryInterface.dropTable('Folders')
  }
}
```

- [ ] **Step 2: Verify it applies on a fresh DB**

Run: `rm -f /tmp/dash-mig.sqlite && CMD_DB_URL="sqlite:///tmp/dash-mig.sqlite" NODE_ENV=production npx sequelize db:migrate --migrations-path lib/migrations 2>&1 | tail -8`
Expected: the new migration runs with no error (it runs all migrations on the fresh DB). If `.sequelizerc` is missing, `cp .sequelizerc.example .sequelizerc` first. Do NOT commit `.sequelizerc` or any sqlite file.

- [ ] **Step 3: Lint + commit (migration only)**

```bash
npx standard lib/migrations/20260619000001-add-folders-tags-note-org.js
git add lib/migrations/20260619000001-add-folders-tags-note-org.js
git commit -m "feat(db): migrate folders, note tags, and note org columns"
```

---

## Task 5: Folder service functions (owner-guarded, with orphan-on-delete)

**Files:** Create `lib/dashboard/index.js` (service layer first); Test `test/dashboard/folders.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const dash = require('../../lib/dashboard/index')

describe('folder services', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('creates, lists, renames folders for the owner', async function () {
    const f = await dash.createFolder('u1', 'Thesis')
    await dash.renameFolder('u1', f.id, 'Dissertation')
    const list = await dash.listFolders('u1')
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].name, 'Dissertation')
  })

  it('rejects blank folder names', async function () {
    await assert.rejects(() => dash.createFolder('u1', '   '), /name/i)
  })

  it('refuses to rename/delete a folder owned by someone else', async function () {
    const f = await dash.createFolder('u1', 'Mine')
    await assert.rejects(() => dash.renameFolder('u2', f.id, 'Hacked'), /not-found|forbidden/i)
    await assert.rejects(() => dash.deleteFolder('u2', f.id), /not-found|forbidden/i)
  })

  it('orphans member notes to Unfiled on folder delete (notes survive)', async function () {
    const f = await dash.createFolder('u1', 'Course')
    const n = await models.Note.create({ ownerId: 'u1', folderId: f.id })
    await dash.deleteFolder('u1', f.id)
    const reloaded = await models.Note.findByPk(n.id)
    assert.ok(reloaded, 'note still exists')
    assert.strictEqual(reloaded.folderId, null)
    assert.strictEqual(await models.Folder.count(), 0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/dashboard/folders.test.js`
Expected: FAIL (module/functions missing).

- [ ] **Step 3: Implement the folder services in `lib/dashboard/index.js`**

```js
'use strict'
const models = require('../models')

// --- folder services (owner-guarded) ---

async function listFolders (ownerId) {
  return models.Folder.findAll({ where: { ownerId }, order: [['name', 'ASC']] })
}

async function createFolder (ownerId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('folder name required')
  return models.Folder.create({ ownerId, name: trimmed })
}

async function ownedFolder (ownerId, folderId) {
  const folder = await models.Folder.findByPk(folderId)
  if (!folder || String(folder.ownerId) !== String(ownerId)) throw new Error('folder-not-found')
  return folder
}

async function renameFolder (ownerId, folderId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('folder name required')
  const folder = await ownedFolder(ownerId, folderId)
  folder.name = trimmed
  await folder.save({ fields: ['name'] })
  return folder
}

async function deleteFolder (ownerId, folderId) {
  await ownedFolder(ownerId, folderId)
  // App-level orphan: this repo emits no DB foreign keys, so SET NULL must be explicit.
  await models.Note.update({ folderId: null }, { where: { folderId, ownerId } })
  await models.Folder.destroy({ where: { id: folderId, ownerId } })
}

module.exports = { listFolders, createFolder, renameFolder, deleteFolder }
```

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/dashboard/folders.test.js`
Expected: PASS (4 passing).

```bash
npx standard lib/dashboard/index.js
git add lib/dashboard/index.js test/dashboard/folders.test.js
git commit -m "feat(dashboard): folder create/list/rename/delete with orphan-on-delete"
```

---

## Task 6: Note-organize services — file, tag, pin (owner-guarded)

**Files:** Modify `lib/dashboard/index.js`; Test `test/dashboard/organize.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const dash = require('../../lib/dashboard/index')

async function myNote (ownerId) { return models.Note.create({ ownerId }) }

describe('note organize services', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('files a note into my folder and can unfile it', async function () {
    const f = await dash.createFolder('u1', 'F')
    const n = await myNote('u1')
    await dash.setFolder('u1', n.id, f.id)
    assert.strictEqual((await models.Note.findByPk(n.id)).folderId, f.id)
    await dash.setFolder('u1', n.id, null)
    assert.strictEqual((await models.Note.findByPk(n.id)).folderId, null)
  })

  it('refuses to file my note into someone else\'s folder', async function () {
    const other = await dash.createFolder('u2', 'Other')
    const n = await myNote('u1')
    await assert.rejects(() => dash.setFolder('u1', n.id, other.id), /folder-not-found/i)
  })

  it('refuses to organize a note I do not own', async function () {
    const n = await myNote('u2')
    await assert.rejects(() => dash.setPin('u1', n.id, true), /note-not-found/i)
    await assert.rejects(() => dash.addTag('u1', n.id, 'x'), /note-not-found/i)
  })

  it('adds and removes user-tags (dedup, normalized)', async function () {
    const n = await myNote('u1')
    await dash.addTag('u1', n.id, 'Machine Learning')
    await dash.addTag('u1', n.id, 'machine learning') // dedup, no-op
    let tags = await dash.tagsFor(n.id)
    assert.deepStrictEqual(tags, ['machine learning'])
    await dash.removeTag('u1', n.id, 'machine learning')
    tags = await dash.tagsFor(n.id)
    assert.deepStrictEqual(tags, [])
  })

  it('sets the pin flag', async function () {
    const n = await myNote('u1')
    await dash.setPin('u1', n.id, true)
    assert.strictEqual((await models.Note.findByPk(n.id)).pinned, true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/dashboard/organize.test.js`
Expected: FAIL.

- [ ] **Step 3: Add to `lib/dashboard/index.js`**

```js
async function ownedNote (ownerId, noteId) {
  const note = await models.Note.findByPk(noteId)
  if (!note || String(note.ownerId) !== String(ownerId)) throw new Error('note-not-found')
  return note
}

async function setFolder (ownerId, noteId, folderId) {
  const note = await ownedNote(ownerId, noteId)
  if (folderId !== null && folderId !== undefined) {
    await ownedFolder(ownerId, folderId) // throws folder-not-found if not mine
  }
  note.folderId = folderId || null
  await note.save({ fields: ['folderId'] })
  return note
}

async function setPin (ownerId, noteId, pinned) {
  const note = await ownedNote(ownerId, noteId)
  note.pinned = !!pinned
  await note.save({ fields: ['pinned'] })
  return note
}

async function addTag (ownerId, noteId, tag) {
  await ownedNote(ownerId, noteId)
  const normalized = (tag || '').trim().toLowerCase()
  if (!normalized) throw new Error('tag required')
  const [row] = await models.NoteTag.findOrCreate({ where: { noteId, tag: normalized }, defaults: { noteId, tag: normalized } })
  return row
}

async function removeTag (ownerId, noteId, tag) {
  await ownedNote(ownerId, noteId)
  await models.NoteTag.destroy({ where: { noteId, tag: (tag || '').trim().toLowerCase() } })
}

async function tagsFor (noteId) {
  const rows = await models.NoteTag.findAll({ where: { noteId }, order: [['tag', 'ASC']] })
  return rows.map(r => r.tag)
}
```

Then **update the SINGLE `module.exports = {...}` object literal** (do NOT add a second `module.exports = ...` assignment — that would clobber Task 5's exports) so it lists every service function:

```js
module.exports = { listFolders, createFolder, renameFolder, deleteFolder, setFolder, setPin, addTag, removeTag, tagsFor, ownedNote, ownedFolder }
```

(Task 9 later adds the router via `module.exports.router = router` — a property assignment that preserves these.)

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/dashboard/organize.test.js`
Expected: PASS (5 passing).

```bash
npx standard lib/dashboard/index.js
git add lib/dashboard/index.js test/dashboard/organize.test.js
git commit -m "feat(dashboard): owner-guarded file/tag/pin services"
```

---

## Task 7: Extend `getMyNoteList` with organization

**Files:** Modify `lib/note/index.js`; Test `test/note/myNotesOrg.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const dash = require('../../lib/dashboard/index')
const noteCtl = require('../../lib/note/index')

function getMyNoteList (userId) {
  return new Promise((resolve, reject) => {
    noteCtl.getMyNoteListForTest(userId, (err, list) => err ? reject(err) : resolve(list))
  })
}

describe('getMyNoteList with organization', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('returns owned notes with folderId, userTags, pinned; excludes others', async function () {
    const f = await dash.createFolder('u1', 'F')
    const mine = await models.Note.create({ ownerId: 'u1', title: 'Mine', folderId: f.id, pinned: true })
    await dash.addTag('u1', mine.id, 'ml')
    await models.Note.create({ ownerId: 'u2', title: 'Theirs' })

    const list = await getMyNoteList('u1')
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].text, 'Mine')
    assert.strictEqual(list[0].folderId, f.id)
    assert.strictEqual(list[0].pinned, true)
    assert.deepStrictEqual(list[0].userTags, ['ml'])
  })
})
```

> The existing `getMyNoteList` is not exported. Export a test seam: add `exports.getMyNoteListForTest = getMyNoteList` near the bottom of `lib/note/index.js` (it already exports `listMyNotes`). This keeps the HTTP handler untouched while making the function testable.

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note/myNotesOrg.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement — extend `getMyNoteList` in `lib/note/index.js`**

Replace the `myNoteList` mapping so each note includes organization. The current code maps synchronously; change it to gather tags per note. Implementation:

```js
async function getMyNoteList (userId, callback) {
  try {
    const myNotes = await Note.findAll({ where: { ownerId: userId } })
    if (!myNotes) return callback(null, null)
    const NoteTag = require('../models').NoteTag
    const myNoteList = await Promise.all(myNotes.map(async note => ({
      id: Note.encodeNoteId(note.id),
      text: note.title,
      tags: Note.parseNoteInfo(note.content).tags,
      userTags: (await NoteTag.findAll({ where: { noteId: note.id }, order: [['tag', 'ASC']] })).map(t => t.tag),
      folderId: note.folderId,
      pinned: note.pinned,
      createdAt: note.createdAt,
      lastchangeAt: note.lastchangeAt,
      shortId: note.shortid
    })))
    return callback(null, myNoteList)
  } catch (err) {
    logger.error('Parse myNoteList failed')
    return callback(err, null)
  }
}
```

(Keep `tags` (frontmatter) in the payload for backward compatibility with any existing consumer, but the dashboard UI uses `userTags`.) Add the test-seam export near the other exports:

```js
exports.getMyNoteListForTest = getMyNoteList
```

- [ ] **Step 4: Run pass + full note suite + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note/myNotesOrg.test.js`
Expected: PASS.
Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test --recursive` (ensure no regression)

```bash
npx standard lib/note/index.js
git add lib/note/index.js test/note/myNotesOrg.test.js
git commit -m "feat(note): include folder, user-tags, pinned in getMyNoteList"
```

---

## Task 8: NoteTag cleanup on note delete

**Files:** Modify `lib/note/index.js` (`deleteNote`); Test `test/note/deleteCleanup.test.js`

- [ ] **Step 1: Write the failing test** (service-level: assert the cleanup helper removes tags)

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const noteCtl = require('../../lib/note/index')

describe('note delete cleans up NoteTags', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('removes a note\'s tags when the note is deleted', async function () {
    const n = await models.Note.create({ ownerId: 'u1' })
    await models.NoteTag.create({ noteId: n.id, tag: 'ml' })
    await noteCtl.cleanupNoteOrganization(n.id)
    assert.strictEqual(await models.NoteTag.count({ where: { noteId: n.id } }), 0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note/deleteCleanup.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a small helper in `lib/note/index.js` and call it from `deleteNote` after the note is destroyed:

```js
async function cleanupNoteOrganization (noteId) {
  await require('../models').NoteTag.destroy({ where: { noteId } })
}
exports.cleanupNoteOrganization = cleanupNoteOrganization
```

In `deleteNote`, after the successful `Note.destroy(...)` (and before/with `historyDelete`), add:

```js
      await cleanupNoteOrganization(noteId)
```

(`folderId`/`pinned` are columns on the deleted note, so they need no cleanup.)

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/note/deleteCleanup.test.js`
Expected: PASS.

```bash
npx standard lib/note/index.js
git add lib/note/index.js test/note/deleteCleanup.test.js
git commit -m "fix(note): remove NoteTag rows when a note is deleted"
```

---

## Task 9: Dashboard HTTP router (owner-guarded, mounted safely)

**Files:** Modify `lib/dashboard/index.js` (add router); Modify `lib/routes.js`

> Mirror existing `/api/notes/*` (session auth, NO csurf). Mount ABOVE the `/:noteId` catch-all. Guard each route by requiring auth + delegating to the owner-guarded services (which already throw on non-owner).

- [ ] **Step 1: Add the router to `lib/dashboard/index.js`**

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
      const code = /not-found/.test(err.message) ? 403 : 400
      res.status(code).send({ status: 'error', message: err.message })
    }
  }
}

const router = Router()
router.get('/api/folders', requireAuth, handle(async req => ({ folders: await listFolders(req.user.id) })))
router.post('/api/folders', requireAuth, jsonParser, handle(async req => ({ folder: await createFolder(req.user.id, req.body.name) })))
router.put('/api/folders/:id', requireAuth, jsonParser, handle(async req => ({ folder: await renameFolder(req.user.id, req.params.id, req.body.name) })))
router.delete('/api/folders/:id', requireAuth, handle(async req => { await deleteFolder(req.user.id, req.params.id) }))
router.put('/api/notes/:id/folder', requireAuth, jsonParser, handle(async req => { await setFolder(req.user.id, req.params.id, req.body.folderId || null) }))
router.put('/api/notes/:id/pin', requireAuth, jsonParser, handle(async req => { await setPin(req.user.id, req.params.id, req.body.pinned) }))
router.post('/api/notes/:id/tags', requireAuth, jsonParser, handle(async req => { await addTag(req.user.id, req.params.id, req.body.tag) }))
router.delete('/api/notes/:id/tags/:tag', requireAuth, handle(async req => { await removeTag(req.user.id, req.params.id, req.params.tag) }))

module.exports.router = router
```

> Note: `module.exports` already holds the service functions (from Tasks 5–6). Add `module.exports.router = router` without clobbering them. Confirm the final `module.exports` exposes both the services AND `.router`.

- [ ] **Step 2: Mount in `lib/routes.js`** (above the `/:noteId` catch-all, near the other `appRouter.use(require('./...'))` mounts)

```js
appRouter.use(require('./dashboard').router)
```

- [ ] **Step 3: Manual smoke (server)**

Start the dev server (Node 16 via `--openssl-legacy-provider` or pinned 16). As a logged-in user:
```
curl -s -b cookies.txt http://localhost:3300/api/folders          # {"status":"ok","folders":[...]}
curl -s -b cookies.txt -X POST -H 'Content-Type: application/json' -d '{"name":"Thesis"}' http://localhost:3300/api/folders
```
Anonymous → 401. Paste outputs.

- [ ] **Step 4: Regression-guard the mount (router-stack test, Slice-1 style)**

Create `test/dashboard/routing.test.js`:

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { router } = require('../../lib/dashboard/index')

it('dashboard routes are all under /api', function () {
  const paths = router.stack.filter(l => l.route).map(l => l.route.path)
  assert.ok(paths.length >= 8)
  paths.forEach(p => assert.ok(p.startsWith('/api/'), `route ${p} must be under /api`))
})
```

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/dashboard/routing.test.js`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npx standard lib/dashboard/index.js lib/routes.js test/dashboard/routing.test.js
git add lib/dashboard/index.js lib/routes.js test/dashboard/routing.test.js
git commit -m "feat(dashboard): owner-guarded /api folder/tag/pin router"
```

---

## Task 10: Render the dashboard as the signed-in home

**Files:** Modify `lib/homepage/index.js`; Create `public/views/dashboard.ejs`

- [ ] **Step 1: Build the view** `public/views/dashboard.ejs`

A CodiMD-styled page using the cover chrome (reuse `../index/head`), with: a folders sidebar (`All notes`, `Unfiled`, each folder + count), a notes list (`<ul class="list">` for `list.js`), a search box + tag filter, and an empty-state block. Model the markup/structure on `public/views/index/body.ejs` (history list + `list.js`) and the Slice-1 admin dashboard for panels. Pass `csrfToken` is not required for the API (session-auth), but the page still needs `serverURL`, `nonce` for any inline script. Forms/buttons call the API via `public/js/dashboard.js` (Task 11).

- [ ] **Step 2: Render it when signed in** — in `lib/homepage/index.js` `showIndex`, change the authenticated branch to render `dashboard` instead of `index.ejs`:

```js
  if (!isLogin) {
    return res.render('index.ejs', data)
  }
  // signed-in: the dashboard is the home surface
  const user = await User.findOne({ where: { id: req.user.id } })
  if (user) data.deleteToken = user.deleteToken
  return res.render('dashboard.ejs', data)
```

- [ ] **Step 3: Manual verify** — sign in, load `/`, confirm the dashboard renders (folders sidebar + notes list + empty state for a fresh user). Screenshot.

- [ ] **Step 4: Commit**

```bash
git add lib/homepage/index.js public/views/dashboard.ejs
git commit -m "feat(dashboard): render notes dashboard as signed-in home"
```

---

## Task 11: Dashboard client JS

**Files:** Create `public/js/dashboard.js`; wire into the webpack `index`/`cover` entry (or include via the view); rebuild bundle.

- [ ] **Step 1: Implement client logic** — on load, `fetch('/api/notes/myNotes')` and `fetch('/api/folders')`; render the notes list and sidebar; wire actions: create/rename/delete folder, move note to folder (`PUT /api/notes/:id/folder`), add/remove tag, pin toggle, and filter-by-folder/tag + search/sort via `list.js`. Each action calls the API then updates the DOM in place. **Model the `list.js`/search/tag wiring on `public/js/cover.js`** (`import List from 'list.js'`, `new List('history', options)` at ~line 27/61) — that is the file that actually drives the cover History list. (`public/js/history.js` is only the localStorage/sync layer, not the list renderer.)

- [ ] **Step 2: Wire + build** — add `public/js/dashboard.js` to the appropriate webpack entry in `webpack.common.js` (or `<script>`-include it from `dashboard.ejs` with a nonce). Run `NODE_OPTIONS=--openssl-legacy-provider npm run build` (or under Node 16). Confirm no build errors.

- [ ] **Step 3: Manual verify (drive the app)** — sign in, create a folder, file a note into it, add a tag, pin a note, search; confirm each persists across reload (server-backed). Screenshot.

- [ ] **Step 4: Commit**

```bash
git add public/js/dashboard.js webpack.common.js
git commit -m "feat(dashboard): client logic for folders, tags, pin, search"
```

---

## Task 12: Docs + full green gate

- [ ] **Step 1: CLAUDE.md** — add a short note under the access/architecture section: signed-in home is the notes dashboard (`lib/dashboard`, `public/views/dashboard.ejs`); folders/tags/pin are owner-guarded `/api` endpoints; organization cleanup is app-level (no DB FKs).

- [ ] **Step 2: Full CI gate**

Run: `NODE_ENV=test npm run test:ci`
Expected: lint + jsonlint + all mocha pass.
Run: `NODE_OPTIONS=--openssl-legacy-provider npm run build`
Expected: webpack completes.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note the personal notes dashboard in CLAUDE.md"
```

---

## Notes & Risk Areas

- **No DB foreign keys** (repo-wide `constraints: false`, sync-from-models tests, SQLite no-enforce). All cleanup is explicit app-level (folder-delete orphan, note-delete tag removal) and is the only kind the tests can actually verify. Do NOT add `onDelete`/`references` to migrations.
- **Migration is not run by CI** (tests sync from models). Keep migration ↔ model definitions in lockstep; verify the migration once by hand (Task 4 Step 2).
- **Mounting** (Slice-1 lesson): the dashboard router only defines `/api/*` routes and is mounted above `/:noteId`; it carries no root-level `router.use(guard)`. Task 9 Step 4 regression-guards this.
- **Pin** is a real `Note.pinned` column — independent of the legacy history-JSON pin (which 404s for never-visited notes). The visited-History UI retires for signed-in users; `User.history` stays but unused by the dashboard.
- **HTTP-layer integration** is not unit-tested (repo has no request harness; user deprioritized building one) — backend logic is covered at the service layer; the UI is verified by driving the running app (Tasks 10–11).
- **Bundle build** needs Node 16 or `--openssl-legacy-provider` on newer Node (webpack-4 + OpenSSL 3).
