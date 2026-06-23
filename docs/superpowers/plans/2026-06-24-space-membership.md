# Per-space Membership (Slice 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate shared spaces by membership — you only see a space + its notes if you're a member; each space has a **steward** (`Space.createdById`) with asymmetric authz (any member invites; only the steward removes others / transfers / can't leave); institute `owner` oversees all.

**Architecture:** A new `SpaceMember` join model + membership filters layered onto the existing `lib/browse` services and the note-permission filter. Member-management is a small set of service functions enforcing the authz matrix, exposed as `/api/spaces/:id/members`, `/api/spaces/:id/steward`, and `/api/users`. Frontend adds a Members modal in Browse.

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (sqlite/Postgres/MySQL), EJS + Bootstrap 3 + jQuery, mocha + power-assert + supertest. CommonJS, `standard` (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-24-space-membership-design.md`

**Critical facts:**
- **`SpaceMember` mirrors `NoteSpace`** exactly: UUID `id` PK (`defaultValue UUIDV4`), UUID `spaceId`/`userId`, timestamps, unique index `['spaceId','userId']`, `belongsTo(Space)+belongsTo(User)` with `constraints:false`, NO reverse hasMany.
- **Migration backfill must be portable** (review): read Spaces via `require('../models').Space.findAll()`, write via `queryInterface.bulkInsert('SpaceMembers', rows)` with an explicit `id: uuidv4()` + `createdAt`/`updatedAt` per row (the model's UUIDV4 default is a marker, not an insert value). Do NOT hand-quote a raw SELECT (dialect quoting trap).
- **ID compares use `String(a) === String(b)`** (repo convention) — the self-leave check especially (`req.params.userId` is a string).
- **`setNoteSpaces` reconciles only within the owner's member-spaces** (scope the `destroy` to `spaceId IN memberSpaceIds`) so legacy links to non-member spaces survive.
- The browse router is `/api/*`-only, mounted above `/:noteId`, per-route `requireAuth`; the new routes inherit this.
- `listSpaces()` → `listSpaces(user)` and `listBrowse(userId,{space})` → `listBrowse(user,{space})` — update the router calls (line 136, 141) and `test/browse/spaces.test.js:29`.
- Seed real `User`s for any `Note`/membership FK in tests.

---

## Task 1: SpaceMember model + migration

**Files — Create:** `lib/models/spacemember.js`, `lib/migrations/20260624000002-add-space-members.js`, `test/models/spacemember.test.js`, `test/migrations/space-members.test.js`.

- [ ] **Step 1: Model test (RED)** — `test/models/spacemember.test.js`:
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('SpaceMember model', function () {
  this.timeout(10000)
  let u, s
  beforeEach(async function () {
    await resetDb()
    u = (await models.User.create({})).id
    s = (await models.Space.create({ name: 'S', createdById: u })).id
  })
  it('persists a membership and enforces uniqueness', async function () {
    await models.SpaceMember.create({ spaceId: s, userId: u })
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: s, userId: u } }), 1)
    await assert.rejects(() => models.SpaceMember.create({ spaceId: s, userId: u }))
  })
})
```

- [ ] **Step 2: Run → FAIL** (`SpaceMember` undefined). `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/spacemember.test.js`

- [ ] **Step 3: Model** — `lib/models/spacemember.js` (mirror `notespace.js`):
```js
'use strict'

module.exports = function (sequelize, DataTypes) {
  const SpaceMember = sequelize.define('SpaceMember', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    spaceId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    indexes: [{ unique: true, fields: ['spaceId', 'userId'] }]
  })

  SpaceMember.associate = function (models) {
    SpaceMember.belongsTo(models.Space, { foreignKey: 'spaceId', constraints: false })
    SpaceMember.belongsTo(models.User, { foreignKey: 'userId', constraints: false })
  }

  return SpaceMember
}
```

- [ ] **Step 4: Run → PASS** (the model is auto-loaded by `lib/models/index.js`).

- [ ] **Step 5: Migration** — `lib/migrations/20260624000002-add-space-members.js`:
```js
'use strict'
const { v4: uuidv4 } = require('uuid')

module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('SpaceMembers', {
      id: { type: Sequelize.UUID, primaryKey: true },
      spaceId: { type: Sequelize.UUID, allowNull: false },
      userId: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('SpaceMembers', ['spaceId', 'userId'], { unique: true, name: 'spacemembers_space_user_unique' })
    // Backfill: each existing space's steward (createdById) becomes a member.
    // Read via the model (portable, no dialect quoting trap); write via bulkInsert with explicit uuid ids.
    const models = require('../models')
    const spaces = await models.Space.findAll()
    const now = new Date()
    const rows = spaces.filter(s => s.createdById).map(s => ({ id: uuidv4(), spaceId: s.id, userId: s.createdById, createdAt: now, updatedAt: now }))
    if (rows.length) await queryInterface.bulkInsert('SpaceMembers', rows)
  },
  down: async function (queryInterface) {
    await queryInterface.dropTable('SpaceMembers')
  }
}
```

- [ ] **Step 6: Migration test** — `test/migrations/space-members.test.js`. **CRITICAL (fact-check):** the migration's `up()` does a *deferred* `require('../models')` inside its body. If this test uses `helpers/db` (which captures a `lib/models` instance at load time), then in the FULL suite the `test/http/*` files evict the lib require-cache via `removeLibModuleCache`, so `up()`'s deferred require resolves to a **fresh empty `lib/models` instance** → reads 0 spaces → backfill 0 → test fails (passes in isolation, fails in `npm run mocha`/`test:ci`). So this test must **self-manage the cache** like `test/http/routing.test.js` — then `up()`'s deferred require resolves to the same cached instance the test seeds. (Do NOT change the migration file; in production sequelize-cli the deferred require opens a second connection to the same physical DB and backfill works.)
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { removeLibModuleCache } = require('../realtime/utils')

describe('migration: add space members', function () {
  this.timeout(10000)
  let models, migration
  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    migration = require('../../lib/migrations/20260624000002-add-space-members')
  })
  after(removeLibModuleCache)
  beforeEach(async function () { await models.sequelize.sync({ force: true }) })

  it('creates the table and backfills one member (the steward) per space', async function () {
    const qi = models.sequelize.getQueryInterface()
    const u1 = (await models.User.create({})).id
    const u2 = (await models.User.create({})).id
    await models.Space.create({ name: 'A', createdById: u1 })
    await models.Space.create({ name: 'B', createdById: u2 })
    await qi.dropTable('SpaceMembers') // remove the model-synced table so up() recreates it
    await migration.up(qi, models.Sequelize) // models.Sequelize is the constructor (lib/models/index.js)
    const all = await models.SpaceMember.findAll()
    assert.strictEqual(all.length, 2)
    const a = await models.Space.findOne({ where: { name: 'A' } })
    assert.strictEqual((await models.SpaceMember.findAll({ where: { spaceId: a.id } }))[0].userId, u1)
  })
})
```

- [ ] **Step 7: Run both tests → PASS; real migrate on a throwaway DB:**
`NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/spacemember.test.js ./test/migrations/space-members.test.js` (expect passing). Then `cp -n .sequelizerc.example .sequelizerc 2>/dev/null; rm -f /tmp/sm-mig.sqlite && CMD_DB_URL="sqlite:///tmp/sm-mig.sqlite" NODE_ENV=production npx sequelize db:migrate --migrations-path lib/migrations 2>&1 | tail -4` (runs clean). Don't commit `.sequelizerc`/sqlite.

- [ ] **Step 8: Lint + commit**
```bash
npx standard lib/models/spacemember.js lib/migrations/20260624000002-add-space-members.js test/models/spacemember.test.js test/migrations/space-members.test.js
git add lib/models/spacemember.js lib/migrations/20260624000002-add-space-members.js test/models/spacemember.test.js test/migrations/space-members.test.js
git commit -m "feat(space): SpaceMember model + migration with steward backfill"
```

---

## Task 2: Membership services (visibility + the authz matrix)

**Files — Modify:** `lib/browse/index.js` (services + the two existing caller signatures), `test/browse/spaces.test.js:29` (signature fix). **Test:** `test/browse/membership.test.js`.

All code below goes in `lib/browse/index.js`. Add helpers near the top (after `nonPrivateWhere`); modify `createSpace`, `listSpaces`, `deleteSpace`, `setNoteSpaces`, `listBrowse`; add `listMembers`, `addMember`, `removeMember`, `transferSteward`, `listUsers`; export them.

- [ ] **Step 1: Write `test/browse/membership.test.js`** — the visibility + full matrix (RED):
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const browse = require('../../lib/browse')

const U = id => ({ id, role: 'user' })
const OWNER = id => ({ id, role: 'owner' })

describe('space membership', function () {
  this.timeout(10000)
  let steward, m2, outsider, ownerUser, space
  beforeEach(async function () {
    await resetDb()
    steward = (await models.User.create({})).id
    m2 = (await models.User.create({})).id
    outsider = (await models.User.create({})).id
    ownerUser = (await models.User.create({ role: 'owner' })).id
    space = await browse.createSpace(steward, 'Lab') // steward auto-added
  })

  it('createSpace makes the creator a member + steward', async function () {
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: steward } }), 1)
    const seen = await browse.listSpaces(U(steward))
    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].isSteward, true)
  })

  it('non-members do not see the space; owner sees all', async function () {
    assert.strictEqual((await browse.listSpaces(U(outsider))).length, 0)
    assert.strictEqual((await browse.listSpaces(OWNER(ownerUser))).length, 1)
  })

  it('any member can invite; only steward can remove another; cannot remove the steward', async function () {
    await browse.addMember(U(steward), space.id, m2)
    // m2 (plain member) cannot remove outsider-added user or anyone
    await browse.addMember(U(m2), space.id, outsider) // member invites — allowed
    await assert.rejects(() => browse.removeMember(U(m2), space.id, outsider), /forbidden/)
    // steward removes outsider — allowed
    await browse.removeMember(U(steward), space.id, outsider)
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: outsider } }), 0)
    // nobody can remove the steward
    await assert.rejects(() => browse.removeMember(OWNER(ownerUser), space.id, steward), /forbidden/)
  })

  it('a member can leave; the steward cannot (must transfer first)', async function () {
    await browse.addMember(U(steward), space.id, m2)
    await browse.removeMember(U(m2), space.id, m2) // leave
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: m2 } }), 0)
    await assert.rejects(() => browse.removeMember(U(steward), space.id, steward), /forbidden/)
  })

  it('steward transfers to a member; cannot transfer to a non-member', async function () {
    await browse.addMember(U(steward), space.id, m2)
    await assert.rejects(() => browse.transferSteward(U(steward), space.id, outsider), /forbidden/)
    await browse.transferSteward(U(steward), space.id, m2)
    const reloaded = await models.Space.findByPk(space.id)
    assert.strictEqual(String(reloaded.createdById), String(m2))
    // old steward is now a plain member and CAN leave
    await browse.removeMember(U(steward), space.id, steward)
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: steward } }), 0)
  })

  it('setNoteSpaces only files into member-spaces; listBrowse hides non-member spaces', async function () {
    const note = await models.Note.create({ ownerId: m2, content: '# n', permission: 'editable' })
    await browse.addMember(U(steward), space.id, m2)
    await browse.setNoteSpaces(m2, note.id, [space.id]) // m2 is a member → allowed
    assert.strictEqual((await browse.spacesForNote(note.id)).length, 1)
    // outsider (non-member) sees nothing in browse for this space
    assert.strictEqual((await browse.listBrowse(U(outsider), { space: space.id })).length, 0)
    // a member sees it
    assert.strictEqual((await browse.listBrowse(U(m2), { space: space.id })).length, 1)
  })
})
```

- [ ] **Step 2: Run → FAIL.** `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/browse/membership.test.js`

- [ ] **Step 3: Implement services in `lib/browse/index.js`.**

Add helpers after `nonPrivateWhere` (line 12):
```js
function isOwnerRole (user) { return !!user && user.role === 'owner' }

async function isMember (userId, spaceId) {
  return !!(await models.SpaceMember.findOne({ where: { spaceId, userId } }))
}

async function memberSpaceIds (userId) {
  const ms = await models.SpaceMember.findAll({ where: { userId } })
  return ms.map(m => String(m.spaceId))
}

async function loadSpace (spaceId) {
  const space = await models.Space.findByPk(spaceId)
  if (!space) throw new Error('space-not-found')
  return space
}

async function assertMemberOrOwner (user, spaceId) {
  await loadSpace(spaceId)
  if (isOwnerRole(user)) return
  if (!(await isMember(user.id, spaceId))) throw new Error('forbidden')
}
```

Replace `createSpace` to add the creator as a member:
```js
async function createSpace (userId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('space name required')
  const existing = await models.Space.findOne({ where: { nameLower: trimmed.toLowerCase() } })
  if (existing) throw new Error('a space with that name already exists')
  const space = await models.Space.create({ name: trimmed, createdById: userId })
  await models.SpaceMember.findOrCreate({ where: { spaceId: space.id, userId }, defaults: { spaceId: space.id, userId } })
  return space
}
```

Replace `listSpaces` (now takes `user`):
```js
async function listSpaces (user) {
  let where = {}
  if (!isOwnerRole(user)) {
    const ids = await memberSpaceIds(user.id)
    if (!ids.length) return []
    where = { id: ids }
  }
  const spaces = await models.Space.findAll({ where, order: [['name', 'ASC']] })
  return Promise.all(spaces.map(async space => {
    const links = await models.NoteSpace.findAll({ where: { spaceId: space.id } })
    const noteIds = links.map(l => l.noteId)
    const count = noteIds.length ? await models.Note.count({ where: { id: noteIds, ...nonPrivateWhere } }) : 0
    const memberCount = await models.SpaceMember.count({ where: { spaceId: space.id } })
    return { id: space.id, name: space.name, createdById: space.createdById, count, memberCount, isSteward: String(space.createdById) === String(user.id) }
  }))
}
```

Replace `deleteSpace` to clean up members too:
```js
async function deleteSpace (user, spaceId) {
  await mutableSpace(user, spaceId)
  await models.NoteSpace.destroy({ where: { spaceId } })
  await models.SpaceMember.destroy({ where: { spaceId } })
  await models.Space.destroy({ where: { id: spaceId } })
}
```

Replace `setNoteSpaces` (member-scoped reconcile):
```js
async function setNoteSpaces (ownerId, noteId, spaceIds) {
  await ownedNote(ownerId, noteId)
  const ids = Array.isArray(spaceIds) ? spaceIds : []
  const mySpaces = await memberSpaceIds(ownerId)
  const mySet = new Set(mySpaces)
  const valid = ids.length
    ? (await models.Space.findAll({ where: { id: ids } })).map(s => String(s.id)).filter(id => mySet.has(id))
    : []
  // reconcile ONLY within the owner's member-spaces; legacy links to other spaces are left intact
  if (mySpaces.length) {
    await models.NoteSpace.destroy({ where: { noteId, spaceId: { [Op.in]: mySpaces } } })
  }
  for (const spaceId of valid) {
    await models.NoteSpace.findOrCreate({ where: { noteId, spaceId }, defaults: { noteId, spaceId } })
  }
}
```

Replace `listBrowse` (now takes `user`, member-gated):
```js
async function listBrowse (user, { space } = {}) {
  const userId = user.id
  let visibleIds = null // null = all (owner)
  if (!isOwnerRole(user)) {
    visibleIds = await memberSpaceIds(userId)
    if (!visibleIds.length) return []
  }
  const linkWhere = {}
  if (space) {
    if (visibleIds && !visibleIds.includes(String(space))) return []
    linkWhere.spaceId = space
  } else if (visibleIds) {
    linkWhere.spaceId = visibleIds
  }
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
```

Add the member-management + users services (after `listBrowse`):
```js
async function listMembers (user, spaceId) {
  const space = await loadSpace(spaceId)
  await assertMemberOrOwner(user, spaceId)
  const ms = await models.SpaceMember.findAll({ where: { spaceId } })
  return Promise.all(ms.map(async m => {
    const u = await models.User.findByPk(m.userId)
    const profile = u ? models.User.getProfile(u) : null
    return { id: m.userId, name: (profile && profile.name) || (u && u.email) || 'Unknown', isSteward: String(space.createdById) === String(m.userId) }
  }))
}

async function addMember (user, spaceId, targetUserId) {
  await assertMemberOrOwner(user, spaceId)
  const target = await models.User.findByPk(targetUserId)
  if (!target) throw new Error('user-not-found')
  await models.SpaceMember.findOrCreate({ where: { spaceId, userId: targetUserId }, defaults: { spaceId, userId: targetUserId } })
}

async function removeMember (user, spaceId, targetUserId) {
  const space = await loadSpace(spaceId)
  const targetIsSteward = String(space.createdById) === String(targetUserId)
  if (String(targetUserId) === String(user.id)) {
    // leaving
    if (!(await isMember(user.id, spaceId))) throw new Error('forbidden')
    if (targetIsSteward) throw new Error('forbidden') // steward must transfer first
  } else {
    // removing another
    if (!(String(space.createdById) === String(user.id) || isOwnerRole(user))) throw new Error('forbidden')
    if (targetIsSteward) throw new Error('forbidden') // protects exactly-one-steward
  }
  const n = await models.SpaceMember.destroy({ where: { spaceId, userId: targetUserId } })
  if (n < 1) throw new Error('not-found')
}

async function transferSteward (user, spaceId, targetUserId) {
  const space = await loadSpace(spaceId)
  if (!(String(space.createdById) === String(user.id) || isOwnerRole(user))) throw new Error('forbidden')
  if (!(await isMember(targetUserId, spaceId))) throw new Error('forbidden') // target must already be a member
  space.createdById = targetUserId
  await space.save({ fields: ['createdById'] })
  return space
}

async function listUsers () {
  const users = await models.User.findAll({ where: { active: true }, order: [['createdAt', 'ASC']] })
  return users.map(u => ({ id: u.id, name: (models.User.getProfile(u) || {}).name || u.email || 'Unknown' }))
}
```

Update the exports line (line 110 `Object.assign`):
```js
Object.assign(module.exports, { setNoteSpaces, spacesForNote, listBrowse, ownedNote, listMembers, addMember, removeMember, transferSteward, listUsers })
```

- [ ] **Step 4: Update the two existing router callers** (so the server stays consistent — full routes in Task 3): line 136 `listSpaces()` → `listSpaces(req.user)`; line 141 `listBrowse(req.user.id, ...)` → `listBrowse(req.user, ...)`.

- [ ] **Step 5: Fix the one other caller** — `test/browse/spaces.test.js:29` `browse.listSpaces()` → **`browse.listSpaces({ id: owner, role: 'owner' })`** (`owner` is already seeded in that test's `beforeEach` ~line 14; owner bypasses the member filter so the existing "sees the space, count===1" assertions still hold). Fact-check confirmed this is the exact fix.

- [ ] **Step 6: Run membership test → PASS, then full suite green.**
`NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/browse/membership.test.js` (6 passing), then `NODE_ENV=test npm run mocha` (0 failing).

- [ ] **Step 7: Lint + commit**
```bash
npx standard lib/browse/index.js test/browse/membership.test.js test/browse/spaces.test.js
git add lib/browse/index.js test/browse/membership.test.js test/browse/spaces.test.js
git commit -m "feat(browse): membership-gated spaces + steward authz matrix (invite/remove/leave/transfer)"
```

---

## Task 3: Member/steward/users routes + HTTP tests

**Files — Modify:** `lib/browse/index.js` (router). **Test:** `test/http/space-members.test.js`.

- [ ] **Step 1: Add routes** after the existing `/api/browse` route (line 141), before `module.exports.router = router`:
```js
router.get('/api/users', requireAuth, handle(async req => ({ users: await listUsers() })))
router.get('/api/spaces/:id/members', requireAuth, handle(async req => ({ members: await listMembers(req.user, req.params.id) })))
router.post('/api/spaces/:id/members', requireAuth, jsonParser, handle(async req => { await addMember(req.user, req.params.id, req.body.userId) }))
router.delete('/api/spaces/:id/members/:userId', requireAuth, handle(async req => { await removeMember(req.user, req.params.id, req.params.userId) }))
router.put('/api/spaces/:id/steward', requireAuth, jsonParser, handle(async req => ({ space: await transferSteward(req.user, req.params.id, req.body.userId) })))
```

- [ ] **Step 2: HTTP test** — `test/http/space-members.test.js` (the `removeLibModuleCache` + shared-`models` pattern from `test/http/routing.test.js`):
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: space members', function () {
  this.timeout(15000)
  let models, buildApp, browse, steward, m2, outsider

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    browse = require('../../lib/browse')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    steward = (await models.User.create({})).id
    m2 = (await models.User.create({})).id
    outsider = (await models.User.create({})).id
  })

  const as = id => buildApp({ id, role: 'user', active: true })

  it('401 anon on members list', async function () {
    const s = await browse.createSpace(steward, 'X')
    assert.strictEqual((await request(buildApp(null)).get(`/api/spaces/${s.id}/members`)).status, 401)
  })

  it('any member invites; plain member cannot remove another (403)', async function () {
    const s = await browse.createSpace(steward, 'X')
    await browse.addMember({ id: steward, role: 'user' }, s.id, m2)
    // m2 invites outsider — 200
    assert.strictEqual((await request(as(m2)).post(`/api/spaces/${s.id}/members`).send({ userId: outsider })).status, 200)
    // m2 removes outsider — 403
    assert.strictEqual((await request(as(m2)).delete(`/api/spaces/${s.id}/members/${outsider}`)).status, 403)
    // steward removes outsider — 200
    assert.strictEqual((await request(as(steward)).delete(`/api/spaces/${s.id}/members/${outsider}`)).status, 200)
  })

  it('steward cannot leave (403); transfer then leave works', async function () {
    const s = await browse.createSpace(steward, 'X')
    await browse.addMember({ id: steward, role: 'user' }, s.id, m2)
    assert.strictEqual((await request(as(steward)).delete(`/api/spaces/${s.id}/members/${steward}`)).status, 403)
    assert.strictEqual((await request(as(steward)).put(`/api/spaces/${s.id}/steward`).send({ userId: m2 })).status, 200)
    assert.strictEqual((await request(as(steward)).delete(`/api/spaces/${s.id}/members/${steward}`)).status, 200)
  })

  it('GET /api/users lists active users', async function () {
    const res = await request(as(steward)).get('/api/users')
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.users.length >= 3)
  })
})
```

- [ ] **Step 3: Run + full suite + lint + commit**
`NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/http/space-members.test.js` (4 passing), then `NODE_ENV=test npm run mocha` (0 failing).
```bash
npx standard lib/browse/index.js test/http/space-members.test.js
git add lib/browse/index.js test/http/space-members.test.js
git commit -m "feat(browse): /api space member + steward + users routes"
```

---

## Task 4: Frontend — Members modal + filtered +space picker

**Files — Modify:** `public/js/dashboard.js`, `public/views/dashboard.ejs`. Rebuild.

- [ ] **Step 1: Implement** (read both files first; match existing Browse-sidebar + modal idioms):
  - **Browse sidebar:** spaces already come from `GET /api/spaces` (now member-filtered server-side — no client change needed for filtering). Add a **"Members"** (people/`fa-users`) button per space row.
  - **Members modal** (reuse the Bootstrap-3 modal pattern, e.g. the template-modal): on open, `GET /api/spaces/:id/members` and `GET /api/users`. Render each member with a **steward badge** (`isSteward`); show a **remove ×** next to other members **only if** the viewer is the space's steward or an institute owner (`space.isSteward` from the spaces payload, or `dashboardUser.role === 'owner'`); show a **"Leave"** button for the viewer's own row **unless** they're the steward; a **"Make steward"** action per other member **only** for the steward/owner (→ `PUT /api/spaces/:id/steward {userId}`); and an **add-member `<select>`** of `GET /api/users` minus current members, with an "Add" button (→ `POST /api/spaces/:id/members {userId}`). Re-fetch the member list after each mutation. Use the existing `apiGet`/`apiSend`.
  - **My-Notes `+ space` picker:** already populated from `spaces` (now member-only). Confirm it reads the filtered list; no extra work beyond verifying.
- [ ] **Step 2: Build** — `NODE_OPTIONS=--openssl-legacy-provider npm run build` (no errors). Lint `npx standard public/js/dashboard.js`.
- [ ] **Step 3: Full suite still green** — `NODE_ENV=test npm run mocha` (unchanged; view/client only).
- [ ] **Step 4: Commit** (only `public/js/dashboard.js`, `public/views/dashboard.ejs`; not `public/build`):
```bash
git commit -m "feat(dashboard): space Members modal — invite/remove/leave/transfer steward"
```

---

## Task 5: Docs + gate + live verify

- [ ] **Step 1: CLAUDE.md** — under "Shared spaces & Browse", add: spaces are **membership-gated** (`SpaceMember`); a space **steward** (`Space.createdById`) — any member invites, only the steward removes others / transfers / can't leave; institute `owner` oversees all; `GET /api/users` feeds the member picker; migration backfills each space's steward as a member.
- [ ] **Step 2: `docs/manual-test-guide.md`** — extend §3: membership (a user only sees spaces they're a member of); the Members modal (invite a user as a member; steward removes/transfers; a member leaves; steward can't leave until transfer). Note the in-app `/test-guide` note will be refreshed by the controller.
- [ ] **Step 3: Full gate** — `NODE_ENV=test npm run test:ci` (pass) + `NODE_OPTIONS=--openssl-legacy-provider npm run build`.
- [ ] **Step 4: Commit** `git add CLAUDE.md docs/manual-test-guide.md && git commit -m "docs: per-space membership in CLAUDE.md + test guide"`.

**Live verification (controller):** migrate the dev DB (or recreate the `SpaceMembers` table + backfill), restart, then confirm: a user sees only their member-spaces in Browse; inviting a user adds them; a plain member can't remove others; the steward transfers stewardship and then can leave; the institute owner sees/manages all spaces.

---

## Notes & risk areas
- **Authz matrix is the core** — the `removeMember` self-vs-other branch + the "never the steward" guard protect the exactly-one-steward invariant. All id compares use `String()`.
- **`setNoteSpaces`** reconciles only within member-spaces (keep legacy links).
- **Migration**: model `findAll` read + `bulkInsert` with explicit uuid ids + timestamps; the test drops the synced table before `up()`.
- **Signature changes** (`listSpaces(user)`, `listBrowse(user,…)`) — update the two router calls + the one test caller; grep confirms no others.
- HTTP tests use `removeLibModuleCache` to avoid polluting the realtime suite.
- Bundle build needs Node 16 or `--openssl-legacy-provider`.
