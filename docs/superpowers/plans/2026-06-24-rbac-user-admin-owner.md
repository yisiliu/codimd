# RBAC user/admin/owner (Slice 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `teacher`/`student` role system with a three-tier `user`/`admin`/`owner` RBAC: admin keeps user-management (today's teacher powers), owner adds owner-only role-granting + (4b) all-spaces oversight.

**Architecture:** `User.role` is already a validated STRING (no enum). This is a coordinated vocabulary rename — changing the role-validation set makes old `teacher`/`student` fixtures invalid, so the **backend + its tests move atomically** (Task 1) to stay green; then frontend/views (Task 2), the data migration (Task 3), and docs/seed/gate (Task 4). A new `requireOwner` middleware gates role changes; `requireTeacher`→`requireAdmin` (admin|owner).

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (sqlite/Postgres/MySQL), EJS + Bootstrap 3 + jQuery, mocha + power-assert + supertest. CommonJS, `standard` (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-24-rbac-user-admin-owner-design.md`

**Critical facts (from spec review):**
- **`User.id` is a UUID** → the migration's owner auto-promote must order by `createdAt` (with an `id` tiebreak), never "smallest id".
- Migration must be portable across sqlite/Postgres/**MySQL** → use `queryInterface.bulkUpdate` + `queryInterface.rawSelect` (they handle dialect quoting), NOT raw `UPDATE ... LIMIT 1` or same-table subqueries (MySQL error 1093).
- The **last-owner guard predicate** must fire on *any* move off owner (`target.role === 'owner' && newRole !== 'owner'`), catching owner→admin too.
- The **role-based socket disconnect** in `setRole` is **removed** (role no longer gates note access; only `active` does).
- `public/js/dashboard.js` `canManageSpace()` and `public/views/invite/invalid.ejs` carry role literals the sweep must catch (review-confirmed misses).
- Do **not** edit the shipped migration `lib/migrations/20260618000001-add-user-role-active.js`.

---

## Task 1: Backend vocabulary + behavior (atomic)

Everything that must change together for the backend + its tests to stay green: role value sets, the validator, the two middleware, the admin service (guard/setRole/invite), the browse authz literal, and **all backend test fixtures**.

**Files — Modify:** `lib/models/user.js`, `lib/models/invite.js`, `lib/user/validateRole.js`, `lib/admin/index.js`, `lib/browse/index.js`, `bin/manage_users`. **Rename:** `lib/web/middleware/requireTeacher.js` → `requireAdmin.js`. **Create:** `lib/web/middleware/requireOwner.js`. **Tests:** rename/update `test/web/requireTeacher.test.js`, `test/admin/userLifecycle.test.js`, `test/user/validateRole.test.js`, `test/models/user.test.js`, `test/models/invite.test.js`, `test/invite/redeem.test.js`, `test/browse/spaces.test.js`, and role fixtures in `test/http/*.test.js`.

- [ ] **Step 1: Role value sets + validator (RED first)**

Update the validator and run its test to see it fail, then the rest.

`lib/user/validateRole.js`:
```js
'use strict'
const ROLES = ['user', 'admin', 'owner']
module.exports = function validateRole (role) {
  if (role === undefined || role === null) return 'user'
  if (!ROLES.includes(role)) {
    throw new Error('invalid role: ' + role + " (must be 'user', 'admin', or 'owner')")
  }
  return role
}
module.exports.ROLES = ROLES
```

`lib/models/user.js` — the `role` attribute:
```js
    role: {
      type: DataTypes.STRING,
      defaultValue: 'user',
      allowNull: false,
      validate: { isIn: [['user', 'admin', 'owner']] }
    },
```

`lib/models/invite.js` — the `role` attribute (invites onboard users only; still validate the column):
```js
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'user',
      validate: { isIn: [['user', 'admin', 'owner']] }
    },
```

- [ ] **Step 2: Middleware — `git mv` + edit + new requireOwner**

```bash
git mv lib/web/middleware/requireTeacher.js lib/web/middleware/requireAdmin.js
```

`lib/web/middleware/requireAdmin.js` (rename the function + role check):
```js
'use strict'
const response = require('../../response')

module.exports = function requireAdmin (req, res, next) {
  if (req.isAuthenticated() && req.user && (req.user.role === 'admin' || req.user.role === 'owner') && req.user.active) {
    return next()
  }
  return response.errorForbidden ? response.errorForbidden(req, res) : res.status(403).render('error')
}
```

`lib/web/middleware/requireOwner.js` (new):
```js
'use strict'
const response = require('../../response')

module.exports = function requireOwner (req, res, next) {
  if (req.isAuthenticated() && req.user && req.user.role === 'owner' && req.user.active) {
    return next()
  }
  return response.errorForbidden ? response.errorForbidden(req, res) : res.status(403).render('error')
}
```

- [ ] **Step 3: `lib/admin/index.js` — guard, setRole, invite, mounts**

Apply these exact edits:
- Requires: replace the requireTeacher line with both middleware:
```js
const requireAdmin = require('../web/middleware/requireAdmin')
const requireOwner = require('../web/middleware/requireOwner')
```
- Rename the guard to owners (function name, where-role, message):
```js
async function assertAnotherActiveOwner (excludeId, t) {
  const others = await models.User.findAll({
    where: { role: 'owner', active: true, id: { [Op.ne]: excludeId } },
    transaction: t,
    lock: rowLock(t)
  })
  if (others.length < 1) throw new Error('cannot remove last owner')
}
```
- `deactivateUser`: guard when the target is an active **owner**:
```js
    if (target.role === 'owner' && target.active) {
      await assertAnotherActiveOwner(userId, t)
    }
```
- `setRole` — new role set, **pinned off-owner predicate**, and the disconnect line **removed**:
```js
async function setRole (userId, role) {
  if (!['user', 'admin', 'owner'].includes(role)) throw new Error('invalid-role')
  await models.sequelize.transaction(async function (t) {
    const target = await models.User.findByPk(userId, { transaction: t })
    if (!target) throw new Error('user-not-found')
    if (target.role === 'owner' && role !== 'owner' && target.active) {
      await assertAnotherActiveOwner(userId, t)
    }
    target.role = role
    await target.save({ transaction: t, fields: ['role'] })
  })
}
```
- `createInvite` — drop the role param/validation; always create a `user` invite:
```js
async function createInvite (createdById, { maxUses, expiresInDays }) {
  const uses = parseInt(maxUses, 10)
  const days = parseInt(expiresInDays, 10) || 7
  if (!(uses >= 1)) throw new Error('invalid-maxUses')
  return models.Invite.create({
    role: 'user',
    maxUses: uses,
    expiresAt: new Date(Date.now() + days * 86400 * 1000),
    createdById
  })
}
```
- Mount: `router.use('/admin', requireAdmin)`.
- Role route gets `requireOwner` (after the global requireAdmin, before body/csrf):
```js
router.post('/admin/users/:id/role', requireOwner, urlencodedParser, csrfProtection, handle(req => setRole(req.params.id, req.body.role)))
```
- (Keep the `disconnectUser`/`realtime` requires — still used by `deactivateUser`.)

- [ ] **Step 4: `lib/browse/index.js` — space authz literal → owner**

In `mutableSpace` (the creator-or-teacher check, line 39 `const isTeacher = user.role === 'teacher'`): change to `user.role === 'owner'` (rename the local to `isOwner` for clarity). (Admins are normal space members; only owner oversees spaces.) Also refresh the two stale comments mentioning "teacher" (~lines 34, 112) → "owner".

- [ ] **Step 5: `bin/manage_users` — roles + promote→admin**

- `--role` is validated by `validateRole` (now user/admin/owner) — no code change beyond the validator, but update the **help text** ("user, admin or owner, defaults to user").
- `--promote <email>`: set role to `'admin'` (was `'teacher'`); update its help text ("Promote the specified user-email to the admin role").
- Owner bootstrap is `--add --role owner <email>` (works via the validator) — note it in the help text.

- [ ] **Step 6: Sweep + update all backend tests, then full suite GREEN**

- `git mv test/web/requireTeacher.test.js test/web/requireRole.test.js`; rewrite it to test `requireAdmin` (admin **and** owner pass; user/inactive/anon → forbidden) and `requireOwner` (owner passes; admin/user/inactive/anon → forbidden).
- In every other test file, replace role fixtures: `role: 'teacher'` → `role: 'admin'` (or `'owner'` where the test needs the top tier), `role: 'student'` → `role: 'user'`. Affected: `test/admin/userLifecycle.test.js`, `test/user/validateRole.test.js`, `test/models/user.test.js`, `test/models/invite.test.js`, `test/invite/redeem.test.js`, `test/browse/spaces.test.js`, `test/http/*.test.js`. Grep to find them: `grep -rln "teacher\|student" test/`.
- In `test/admin/userLifecycle.test.js`: the last-teacher guard tests become **last-owner** (`cannot remove last owner`), seed **owners** for those; assert an **admin cannot setRole** is left to the HTTP test (the service `setRole` itself is role-agnostic — it's the route's `requireOwner` that blocks admins, so test that via the harness). Add a service test: demoting the last active owner (owner→admin) throws `cannot remove last owner`; `createInvite` produces a `role: 'user'` invite.
- In `test/browse/spaces.test.js`: the "teacher can rename/delete any space" case now needs an **owner** fixture (creator-or-owner). Update accordingly.
- Add an HTTP-harness test (in `test/http/`, new `rbac.test.js` or extend `routing.test.js`): `POST /admin/users/:id/role` as an **admin** → forbidden (not owner); as an **owner** → succeeds. (Use `buildApp({ id, role, active:true })`.)

Run: `NODE_ENV=test npm run mocha` → **0 failing**. Then `npx standard` on all changed lib/bin files.

- [ ] **Step 7: Commit**
```bash
git add lib/ bin/manage_users test/
git commit -m "feat(rbac): user/admin/owner roles, requireAdmin/requireOwner, owner-only role changes"
```

---

## Task 2: Frontend & views

**Files — Modify:** `public/js/dashboard.js`, `public/views/admin/dashboard.ejs`, `public/views/invite/invalid.ejs`. Rebuild bundle.

- [ ] **Step 1: `public/js/dashboard.js`** — `canManageSpace()` (~line 298): `dashboardUser.role === 'teacher'` → `=== 'owner'`.
- [ ] **Step 2: `public/views/admin/dashboard.ejs`** — the current member-role control is **binary promote/demote buttons** with hidden `role` inputs (`student`/`teacher`, ~lines 113–125) — that can't express three tiers, so **build a new role control**: a small owner-only form per member that POSTs to `/admin/users/:id/role` with a three-way choice (a `<select>` of `user`/`admin`/`owner` + a "Set role" submit, or three buttons). **Gate it to owners only** — render it **only when `me.role === 'owner'`** (`me` is in scope, passed at `lib/admin/index.js:108`; the route also enforces `requireOwner`). Update the role **label-colour ternaries** (~lines 80, 106: `i.role === 'teacher' ? ...`) to the user/admin/owner palette, and the member-table role labels. Remove the **invite** role `<select>` (~lines 49–52) since invites are always `user`. Keep invites + activate/deactivate visible to admin+owner.
- [ ] **Step 3: `public/views/invite/invalid.ejs`** — "Ask a teacher for a new one." → "Ask an admin for a new one."
- [ ] **Step 4: Build** — `NODE_OPTIONS=--openssl-legacy-provider npm run build` (no errors). Lint `npx standard public/js/dashboard.js`.
- [ ] **Step 5: Commit** (touch only the 3 files; not `public/build`):
```bash
git commit -m "feat(rbac): owner-only role UI, admin/owner/user labels, fix space-manage gate"
```

---

## Task 3: Data migration + test

**Files — Create:** `lib/migrations/20260624000001-roles-user-admin-owner.js`, `test/migrations/roles-user-admin-owner.test.js`.

- [ ] **Step 1: Write the migration**
```js
'use strict'
module.exports = {
  up: async function (queryInterface) {
    // 1 & 2: portable bulk renames
    await queryInterface.bulkUpdate('Users', { role: 'admin' }, { role: 'teacher' })
    await queryInterface.bulkUpdate('Users', { role: 'user' }, { role: 'student' })
    // 3: promote the earliest active former-teacher to owner (UUID PK → order by createdAt).
    // rawSelect handles dialect quoting + returns the first matching attribute (or null).
    const firstAdminId = await queryInterface.rawSelect('Users', {
      where: { role: 'admin', active: true },
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    }, 'id')
    if (firstAdminId) {
      await queryInterface.bulkUpdate('Users', { role: 'owner' }, { id: firstAdminId })
    }
  },
  down: async function (queryInterface) {
    const { Op } = require('sequelize')
    await queryInterface.bulkUpdate('Users', { role: 'teacher' }, { role: { [Op.in]: ['admin', 'owner'] } })
    await queryInterface.bulkUpdate('Users', { role: 'student' }, { role: 'user' })
  }
}
```

- [ ] **Step 2: Write the test** (`test/migrations/roles-user-admin-owner.test.js`) — run `up()` against seeded rows on the sqlite test DB:
```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const migration = require('../../lib/migrations/20260624000001-roles-user-admin-owner')

describe('migration: roles user/admin/owner', function () {
  this.timeout(10000)
  const qi = models.sequelize.getQueryInterface()
  beforeEach(resetDb)

  it('maps teacher→admin/owner and student→user; exactly one owner on a createdAt tie', async function () {
    const ts = new Date('2020-01-01T00:00:00Z')
    // two teachers with IDENTICAL createdAt (the tie case) + a student.
    // NO `fields` array — passing `fields` would exclude `id` and suppress its
    // UUIDV4 default (id→NULL → rawSelect returns null → 0 owners). `validate:false`
    // lets us seed the old vocab; `createdAt` persists without `fields`.
    await models.User.bulkCreate([
      { email: 't1@x.io', role: 'teacher', active: true, createdAt: ts, updatedAt: ts },
      { email: 't2@x.io', role: 'teacher', active: true, createdAt: ts, updatedAt: ts },
      { email: 's1@x.io', role: 'student', active: true }
    ], { validate: false })

    await migration.up(qi)

    const all = await models.User.findAll()
    const byRole = r => all.filter(u => u.role === r).length
    assert.strictEqual(byRole('owner'), 1, 'exactly one owner')
    assert.strictEqual(byRole('admin'), 1, 'the other teacher → admin')
    assert.strictEqual(byRole('user'), 1, 'student → user')
    assert.strictEqual(byRole('teacher') + byRole('student'), 0, 'old vocab gone')
  })

  it('no active teacher → no owner', async function () {
    await models.User.bulkCreate([{ email: 's@x.io', role: 'student', active: true }], { validate: false })
    await migration.up(qi)
    assert.strictEqual((await models.User.findAll({ where: { role: 'owner' } })).length, 0)
  })
})
```
> Note: `bulkCreate` with `{ validate: false }` lets us seed the *old* `teacher`/`student` values that the model no longer allows. Do **not** pass a `fields` array — it would exclude `id` and suppress the UUIDV4 default (the owner-promote then finds a NULL id and sets 0 owners). `createdAt` persists fine without `fields`.

- [ ] **Step 3: Run** — `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/migrations/roles-user-admin-owner.test.js` (2 passing). Then a real migrate on a throwaway sqlite DB: `rm -f /tmp/rbac-mig.sqlite && CMD_DB_URL="sqlite:///tmp/rbac-mig.sqlite" NODE_ENV=production npx sequelize db:migrate --migrations-path lib/migrations 2>&1 | tail -4` (runs clean through the new migration).
- [ ] **Step 4: Lint + commit**
```bash
npx standard lib/migrations/20260624000001-roles-user-admin-owner.js test/migrations/roles-user-admin-owner.test.js
git add lib/migrations/20260624000001-roles-user-admin-owner.js test/migrations/
git commit -m "feat(rbac): migration mapping roles + earliest-teacher→owner (createdAt, tie-safe)"
```

---

## Task 4: Docs, re-seed, green gate + live verify

- [ ] **Step 1: CLAUDE.md** — update the "Access model" section: roles are now `user`/`admin`/`owner` (`User.role`); `requireAdmin` (admin|owner) guards the panel, `requireOwner` (owner) guards role changes; invites onboard `user` only; first owner via `bin/manage_users --add --role owner`; the migration maps old→new + auto-promotes the earliest teacher. Note `lib/browse` space authz is creator-or-**owner**.
- [ ] **Step 2: `docs/manual-test-guide.md`** — replace teacher/student terminology with admin/owner/user; update §1 (owner-only role changes; admin can invite/deactivate but not change roles; last-**owner** guard) and the account list.
- [ ] **Step 3: Re-seed dev accounts** — set roles on the dev DB so the running app matches: make `teacher@example.com` an **owner** (or add an owner), `student@example.com` a **user**, and add an **admin** account for testing the middle tier:
```bash
NODE_ENV=development node -e "const m=require('./lib/models');(async()=>{await m.User.update({role:'owner'},{where:{email:'teacher@example.com'}});await m.User.update({role:'user'},{where:{email:'student@example.com'}});process.exit(0)})()"
NODE_ENV=development node bin/manage_users --add --role admin admin@example.com --pass adminpass123
```
- [ ] **Step 4: Full gate** — `NODE_ENV=test npm run test:ci` (lint + jsonlint + coverage pass) and `NODE_OPTIONS=--openssl-legacy-provider npm run build`.
- [ ] **Step 5: Commit** `git add CLAUDE.md docs/manual-test-guide.md && git commit -m "docs: RBAC user/admin/owner in CLAUDE.md + test guide"`.

**Live verification (controller does this after Task 4):** restart the server, then confirm via the running app — owner can change a user's role; an admin gets 403 on the role endpoint but can still create an invite + deactivate; the last-owner guard blocks demoting the only owner; the Browse "manage space" control shows for owner.

---

## Notes & risk areas

- **Atomicity:** Task 1 is intentionally large — the role-validation change invalidates old fixtures, so backend + tests must land together. Keep the suite green at Task 1's end.
- **Migration portability:** `bulkUpdate`/`rawSelect` handle quoting; never `UPDATE ... LIMIT 1` or same-table subqueries (MySQL 1093). Order by `createdAt` (UUID PK), `id` tiebreak.
- **Guard predicate:** `target.role === 'owner' && newRole !== 'owner'` — catches owner→admin. Don't reduce it to a `student→user` literal swap.
- **Dropped disconnect:** `setRole` no longer disconnects sockets (only `deactivateUser` does, via `active`).
- **requireOwner ordering:** the global `router.use('/admin', requireAdmin)` runs first (admin|owner), then `requireOwner` on the role route blocks admins. The view also hides the control from non-owners.
- **No edit** to the shipped `20260618000001-...` migration.
- Bundle build needs Node 16 or `--openssl-legacy-provider`.
