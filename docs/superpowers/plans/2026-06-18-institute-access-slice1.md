# Closed Institute Access (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn stock CodiMD into a closed, invite-only instance with teacher/student roles and a teacher admin panel.

**Architecture:** Add `role` + `active` to the `User` model and a new `Invite` model (Sequelize 5). Gate all entry through invite redemption; disable open + provider auto-registration. A `requireTeacher` middleware guards a new `lib/admin/` controller (panel) and a `lib/invite/` controller (redemption). Deactivation de-auths existing HTTP sessions (via `deserializeUser`) and force-disconnects live sockets. All concurrency-sensitive writes (invite over-redemption, last-teacher lockout) use atomic conditional `UPDATE ... WHERE` guards checked via Sequelize's `[affectedCount]` return.

**Tech Stack:** Node 16, Express 4, Sequelize 5.21 (SQLite for tests/`:memory:`, Postgres for production), passport (local), EJS + Bootstrap 3, mocha + power-assert. CommonJS, `standard` lint (no semicolons).

**Spec:** `docs/superpowers/specs/2026-06-17-institute-access-slice1-design.md`

**Prerequisite (do this FIRST, before any task):** install deps and create `config.json`, or every test command fails at require-time — `lib/config/default.js` has `db: {}` (empty), so without `config.json` Sequelize throws "Dialect needs to be explicitly supplied". The `test` env in `config.json.example` is already SQLite `:memory:`.

```bash
npm ci
cp config.json.example config.json   # test env = sqlite :memory:
```

Run all tests with `NODE_ENV=test`.

---

## File Structure

**Create:**
- `lib/migrations/20260618000001-add-user-role-active.js` — add `role`, `active` to Users; backfill via DDL default; unique index on `email`.
- `lib/migrations/20260618000002-create-invite.js` — create `Invites` table.
- `lib/models/invite.js` — `Invite` model + `isRedeemable()` + `associate`.
- `lib/web/middleware/requireTeacher.js` — 403 unless active teacher.
- `lib/web/middleware/rateLimit.js` — minimal in-memory fixed-window limiter (no new dependency).
- `lib/invite/index.js` — `GET/POST /invite/:token` redemption router.
- `lib/admin/index.js` — teacher admin panel router + the lockout helper.
- `lib/realtime/disconnectUser.js` — helper to disconnect all of a user's live sockets.
- `lib/user/validateRole.js` — pure role validator shared by the CLI and tests.
- `public/views/admin/dashboard.ejs`, `public/views/invite/redeem.ejs`, `public/views/invite/invalid.ejs` — views.
- `test/models/invite.test.js`, `test/models/user.test.js`, `test/web/requireTeacher.test.js`, `test/invite/redeem.test.js`, `test/admin/userLifecycle.test.js` — tests.
- `test/helpers/db.js` — shared in-memory DB sync helper.

**Modify:**
- `lib/models/user.js` — add `role`, `active`, validators, lowercase-email-on-write.
- `lib/auth/index.js` — `deserializeUser` rejects inactive users.
- `lib/auth/email/index.js` — `LocalStrategy` rejects inactive; `/login` `failureFlash: true`.
- `lib/auth/utils.js` — `passportGeneralCallback` refuses new accounts when provider auto-register is off (+ same guard noted for ldap/saml/openid callbacks).
- `lib/config/default.js` — add `allowProviderAutoRegister: false`.
- `lib/config/environment.js` — map `CMD_ALLOW_PROVIDER_AUTO_REGISTER`.
- `lib/routes.js` — mount invite + admin routers.
- `bin/manage_users` — `--role` modifier + `--promote`; fix `action.join` bug.
- `CLAUDE.md` — document roles/invites/admin concepts + locked preset + first-run runbook.

---

## Task 1: Shared in-memory DB test helper

**Files:**
- Create: `test/helpers/db.js`

- [ ] **Step 1: Write the helper**

```js
'use strict'
/* helper: real in-memory sqlite models for integration tests */
process.env.NODE_ENV = process.env.NODE_ENV || 'test'

const models = require('../../lib/models')

async function resetDb () {
  await models.sequelize.sync({ force: true })
}

module.exports = { models, resetDb }
```

- [ ] **Step 2: Smoke-run it**

Run: `NODE_ENV=test node -e "require('./test/helpers/db.js').resetDb().then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `ok` (confirms models sync against `:memory:`). Requires `config.json` from the prerequisite step.

- [ ] **Step 3: Commit**

```bash
git add test/helpers/db.js
git commit -m "test: add in-memory sqlite model helper"
```

---

## Task 2: User model — `role`, `active`, lowercase email

**Files:**
- Modify: `lib/models/user.js`
- Test: `test/models/user.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('User model: role/active/email', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('defaults new users to active student', async function () {
    const u = await models.User.create({ email: 'a@x.io', password: 'secret12' })
    assert.strictEqual(u.role, 'student')
    assert.strictEqual(u.active, true)
  })

  it('lowercases email on write', async function () {
    const u = await models.User.create({ email: 'MixedCase@X.io', password: 'secret12' })
    assert.strictEqual(u.email, 'mixedcase@x.io')
  })

  it('rejects a second user with the same (case-insensitive) email', async function () {
    await models.User.create({ email: 'dup@x.io', password: 'secret12' })
    await assert.rejects(() => models.User.create({ email: 'DUP@x.io', password: 'secret12' }))
  })

  it('rejects an invalid role', async function () {
    await assert.rejects(() => models.User.create({ email: 'r@x.io', password: 'secret12', role: 'admin' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/user.test.js`
Expected: FAIL (no `role`/`active`, email not unique/lowercased).

- [ ] **Step 3: Implement in `lib/models/user.js`**

Add to the `sequelize.define('User', { ... })` attribute map (alongside `email`):

```js
    role: {
      type: DataTypes.STRING,
      defaultValue: 'student',
      allowNull: false,
      validate: { isIn: [['teacher', 'student']] }
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
```

Add a lowercase-email hook next to the existing password hooks:

```js
  function normalizeEmail (user) {
    if (user.email) user.email = user.email.toLowerCase()
  }
  User.addHook('beforeCreate', normalizeEmail)
  User.addHook('beforeUpdate', function (user) {
    if (user.changed('email')) normalizeEmail(user)
  })
```

(Uniqueness is enforced by the DB index added in Task 3; the model test above passes once that migration runs during `sync`. Since `sync({force:true})` builds from model definitions, also add `unique: true` to the `email` attribute so `sync`-based tests get the constraint:)

```js
    email: {
      type: Sequelize.TEXT,
      unique: true,
      validate: { isEmail: true }
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/user.test.js`
Expected: PASS (4 passing).

- [ ] **Step 5: Lint + commit**

```bash
npx standard lib/models/user.js
git add lib/models/user.js test/models/user.test.js
git commit -m "feat(user): add role, active, unique lowercase email"
```

---

## Task 3: Migration — add role/active + unique email index

**Files:**
- Create: `lib/migrations/20260618000001-add-user-role-active.js`

> Mirrors the repo's idempotent migration style (catch-and-log on already-applied). DDL-level `defaultValue` backfills existing rows across PG/MySQL/SQLite.

- [ ] **Step 1: Write the migration**

```js
'use strict'
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'role', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'student'
    })
    await queryInterface.addColumn('Users', 'active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    })
    // Normalize existing emails so the unique index is case-consistent.
    await queryInterface.sequelize.query('UPDATE "Users" SET email = LOWER(email)').catch(function () {
      // MySQL/SQLite identifier quoting differs; fall back to unquoted.
      return queryInterface.sequelize.query('UPDATE Users SET email = LOWER(email)')
    })
    await queryInterface.addIndex('Users', ['email'], { unique: true, name: 'users_email_unique' })
  },
  down: async function (queryInterface, Sequelize) {
    await queryInterface.removeIndex('Users', 'users_email_unique')
    await queryInterface.removeColumn('Users', 'active')
    await queryInterface.removeColumn('Users', 'role')
  }
}
```

- [ ] **Step 2: Verify it applies on a scratch DB**

Run: `cp config.json.example /tmp/none 2>/dev/null; NODE_ENV=development npx sequelize db:migrate --config config.js --migrations-path lib/migrations 2>&1 | tail -5`
Expected: migration name appears as "migrated" with no error (uses the dev SQLite file from `.sequelizerc`/config). If existing local DB already has columns, the run errors clearly — acceptable; the authoritative check is fresh-DB.

- [ ] **Step 3: Commit**

```bash
git add lib/migrations/20260618000001-add-user-role-active.js
git commit -m "feat(db): migrate Users with role, active, unique email index"
```

---

## Task 4: Invite model + migration

**Files:**
- Create: `lib/models/invite.js`, `lib/migrations/20260618000002-create-invite.js`
- Test: `test/models/invite.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

function future () { return new Date(Date.now() + 3600 * 1000) }
function past () { return new Date(Date.now() - 1000) }

describe('Invite.isRedeemable', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('true when fresh, unexpired, under maxUses', function () {
    const i = models.Invite.build({ role: 'student', maxUses: 5, usedCount: 0, expiresAt: future(), revoked: false })
    assert.strictEqual(i.isRedeemable(), true)
  })
  it('false when revoked', function () {
    const i = models.Invite.build({ role: 'student', maxUses: 5, usedCount: 0, expiresAt: future(), revoked: true })
    assert.strictEqual(i.isRedeemable(), false)
  })
  it('false when expired', function () {
    const i = models.Invite.build({ role: 'student', maxUses: 5, usedCount: 0, expiresAt: past(), revoked: false })
    assert.strictEqual(i.isRedeemable(), false)
  })
  it('false when used up', function () {
    const i = models.Invite.build({ role: 'student', maxUses: 1, usedCount: 1, expiresAt: future(), revoked: false })
    assert.strictEqual(i.isRedeemable(), false)
  })
  it('generates a unique high-entropy token on create', async function () {
    const i = await models.Invite.create({ role: 'student', maxUses: 1, expiresAt: future() })
    assert.ok(i.token && i.token.length >= 32)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/invite.test.js`
Expected: FAIL ("Invite is undefined").

- [ ] **Step 3: Write the model**

`lib/models/invite.js`:

```js
'use strict'
const crypto = require('crypto')

module.exports = function (sequelize, DataTypes) {
  const Invite = sequelize.define('Invite', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    token: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      defaultValue: function () { return crypto.randomBytes(32).toString('base64url') }
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [['teacher', 'student']] }
    },
    maxUses: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 }
    },
    usedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    revoked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  })

  Invite.prototype.isRedeemable = function () {
    return !this.revoked &&
      this.expiresAt > new Date() &&
      this.usedCount < this.maxUses
  }

  Invite.associate = function (models) {
    Invite.belongsTo(models.User, { foreignKey: 'createdById', constraints: false })
  }

  return Invite
}
```

- [ ] **Step 4: Write the migration** `lib/migrations/20260618000002-create-invite.js`

```js
'use strict'
module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.createTable('Invites', {
      id: { type: Sequelize.UUID, primaryKey: true },
      token: { type: Sequelize.STRING, allowNull: false, unique: true },
      role: { type: Sequelize.STRING, allowNull: false },
      maxUses: { type: Sequelize.INTEGER, allowNull: false },
      usedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      revoked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdById: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
  },
  down: function (queryInterface) {
    return queryInterface.dropTable('Invites')
  }
}
```

- [ ] **Step 5: Run to verify pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/models/invite.test.js`
Expected: PASS (5 passing).

```bash
npx standard lib/models/invite.js lib/migrations/20260618000002-create-invite.js
git add lib/models/invite.js lib/migrations/20260618000002-create-invite.js test/models/invite.test.js
git commit -m "feat(invite): add Invite model with isRedeemable + migration"
```

---

## Task 5: `requireTeacher` middleware

**Files:**
- Create: `lib/web/middleware/requireTeacher.js`
- Test: `test/web/requireTeacher.test.js`

- [ ] **Step 1: Write the failing test**

> The middleware delegates rejection to `lib/response.errorForbidden`. The real `errorForbidden` builds a URL from `config.serverURL` (which is empty under `NODE_ENV=test`) and so throws "Invalid URL" on the anonymous branch. The unit test only cares about requireTeacher's branching (next vs. reject), so **mock `lib/response`** rather than exercise the real one.

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

// Stub lib/response so the test exercises requireTeacher's branching only,
// not the real errorForbidden (which needs config.serverURL + a real res).
let rejected
mock('../../lib/response', { errorForbidden: () => { rejected = true } })
const requireTeacher = mock.reRequire('../../lib/web/middleware/requireTeacher')

function run (reqOverrides) {
  rejected = false
  let next = false
  requireTeacher(Object.assign({ flash: () => {} }, reqOverrides), {}, () => { next = true })
  return { next, rejected }
}

describe('requireTeacher', function () {
  after(() => mock.stopAll())

  it('calls next for an active teacher', function () {
    const s = run({ isAuthenticated: () => true, user: { role: 'teacher', active: true } })
    assert.strictEqual(s.next, true)
    assert.strictEqual(s.rejected, false)
  })
  it('rejects a student', function () {
    const s = run({ isAuthenticated: () => true, user: { role: 'student', active: true } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an inactive teacher', function () {
    const s = run({ isAuthenticated: () => true, user: { role: 'teacher', active: false } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an anonymous request', function () {
    const s = run({ isAuthenticated: () => false })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/web/requireTeacher.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
'use strict'
const response = require('../../response')

module.exports = function requireTeacher (req, res, next) {
  if (req.isAuthenticated() && req.user && req.user.role === 'teacher' && req.user.active) {
    return next()
  }
  return response.errorForbidden ? response.errorForbidden(req, res) : res.status(403).render('error')
}
```

> Check `lib/response.js` for the exact forbidden helper name (`errorForbidden` — confirmed present). The test mocks `lib/response`, so it asserts only requireTeacher's branching, independent of the real helper's URL/redirect behavior.

- [ ] **Step 4: Run to verify pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/web/requireTeacher.test.js`
Expected: PASS (4 passing).

```bash
npx standard lib/web/middleware/requireTeacher.js
git add lib/web/middleware/requireTeacher.js test/web/requireTeacher.test.js
git commit -m "feat(admin): add requireTeacher middleware"
```

---

## Task 6: Deactivation gate in auth (sessions + login)

**Files:**
- Modify: `lib/auth/index.js` (`deserializeUser`), `lib/auth/email/index.js` (`LocalStrategy` + `/login`)
- Test: `test/auth/activeGate.test.js`

- [ ] **Step 1: Write the failing test** (unit-level, mock models)

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

describe('deserializeUser active gate', function () {
  afterEach(() => mock.stopAll())

  it('de-auths an inactive user', function (done) {
    // Arrange a fake passport whose deserializeUser callback we can capture.
    let deserializeFn
    mock('passport', { deserializeUser: (fn) => { deserializeFn = fn }, serializeUser: () => {}, use: () => {} })
    mock('../../lib/models', { User: { findOne: async () => ({ id: '1', active: false }) } })
    // Requiring the auth index registers deserializeUser.
    mock.reRequire('../../lib/auth/index')
    deserializeFn('1', (err, user) => {
      assert.ifError(err)
      assert.strictEqual(user, false)
      done()
    })
  })
})
```

> The exact mock wiring depends on how `lib/auth/index.js` is structured (it calls `passport.deserializeUser(...)` at module load). Adjust the capture to match. If module-load capture proves brittle, instead export the deserialize callback from `lib/auth/index.js` and unit-test it directly — prefer the refactor that makes it testable.

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/auth/activeGate.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/auth/index.js` `deserializeUser`, after the user is fetched, before returning it:

```js
    if (!user || !user.active) {
      return done(null, false)
    }
    return done(null, user)
```

In `lib/auth/email/index.js` `LocalStrategy`, after `verifyPassword` succeeds:

```js
    if (!user.active) return done(null, false, { message: 'Account is deactivated.' })
    return done(null, user)
```

And change the `/login` handler's options from `failureFlash: 'Invalid email or password.'` to:

```js
    failureFlash: true
```

(so the strategy's `{ message }` surfaces; keep a default message for the wrong-password path by passing `{ message: 'Invalid email or password.' }` on those `done(null, false, ...)` returns).

- [ ] **Step 4: Run to verify pass + full auth suite + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/auth --recursive`
Expected: PASS (new test + existing auth tests green).

```bash
npx standard lib/auth/index.js lib/auth/email/index.js
git add lib/auth/index.js lib/auth/email/index.js test/auth/activeGate.test.js
git commit -m "feat(auth): reject inactive users at session + login"
```

---

## Task 7: Provider auto-register guard

**Files:**
- Modify: `lib/config/default.js`, `lib/config/environment.js`, `lib/auth/utils.js`
- Test: `test/auth/autoRegisterGuard.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

describe('passportGeneralCallback auto-register guard', function () {
  afterEach(() => mock.stopAll())

  it('refuses a newly-created external account when auto-register is off', function (done) {
    mock('../../lib/config', { allowProviderAutoRegister: false })
    mock('../../lib/models', {
      User: { findOrCreate: async () => [{ id: 'new', destroy: async () => {} }, true] }
    })
    const { passportGeneralCallback } = mock.reRequire('../../lib/auth/utils')
    passportGeneralCallback('at', 'rt', { id: 'p1', provider: 'github' }, (err, user) => {
      assert.ifError(err)
      assert.strictEqual(user, false)
      done()
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/auth/autoRegisterGuard.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/config/default.js`: add `allowProviderAutoRegister: false,` near the other `allow*` flags.
`lib/config/environment.js`: add `allowProviderAutoRegister: toBooleanConfig(process.env.CMD_ALLOW_PROVIDER_AUTO_REGISTER)` following the existing pattern in that file. (`config` is already required in `lib/auth/utils.js:4`.)

**The current `passportGeneralCallback` (`lib/auth/utils.js:33-73`) uses the Bluebird `.spread()` API, not `async`/destructuring.** A guard with `await user.destroy()` cannot be dropped into a `.spread` callback, and the Task 7 test mocks `findOrCreate` with a native promise (no `.spread`). So **refactor the whole function to `async`/`await`** (preserving its existing save-on-change behavior) and add the guard:

```js
exports.passportGeneralCallback = async function callback (accessToken, refreshToken, profile, done) {
  const stringifiedProfile = JSON.stringify(profile)
  try {
    const [user, created] = await models.User.findOrCreate({
      where: { profileid: profile.id.toString() },
      defaults: {
        profile: stringifiedProfile,
        accessToken: accessToken,
        refreshToken: refreshToken
      }
    })
    if (created && !config.allowProviderAutoRegister) {
      logger.info('Refused provider auto-registration for ' + profile.provider)
      if (user) await user.destroy()
      return done(null, false)
    }
    if (!user) return done(null, false)
    let needSave = false
    if (user.profile !== stringifiedProfile) {
      user.profile = stringifiedProfile
      needSave = true
    }
    if (user.accessToken !== accessToken) {
      user.accessToken = accessToken
      needSave = true
    }
    if (user.refreshToken !== refreshToken) {
      user.refreshToken = refreshToken
      needSave = true
    }
    if (needSave) await user.save()
    if (config.debug) { logger.info('user login: ' + user.id) }
    return done(null, user)
  } catch (err) {
    logger.error('auth callback failed: ' + err)
    return done(err, null)
  }
}
```

Add the same `created`-guard to the `lib/auth/ldap/index.js`, `saml/index.js`, `openid/index.js` callbacks (each does its own `findOrCreate`); implement there too if those providers may be used. (Confirm those callbacks' promise style and refactor to `async`/`await` likewise before adding the guard.)

- [ ] **Step 4: Run to verify pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/auth/autoRegisterGuard.test.js`
Expected: PASS.

```bash
npx standard lib/auth/utils.js lib/config/default.js lib/config/environment.js
git add lib/auth/utils.js lib/config/default.js lib/config/environment.js test/auth/autoRegisterGuard.test.js
git commit -m "feat(auth): guard provider auto-registration behind config flag"
```

---

## Task 8: In-memory rate limiter middleware

**Files:**
- Create: `lib/web/middleware/rateLimit.js`
- Test: `test/web/rateLimit.test.js`

> Avoids a new dependency. Fixed-window per-IP counter; sufficient for `/invite/*` and `/login` on a 23-user instance.

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const rateLimit = require('../../lib/web/middleware/rateLimit')

function mkRes () {
  return {
    code: null,
    status (c) {
      this.code = c
      return this
    },
    send () {},
    json () {}
  }
}

describe('rateLimit', function () {
  it('allows up to the limit then 429s', function () {
    const mw = rateLimit({ windowMs: 10000, max: 2 })
    const req = { ip: '1.1.1.1' }
    let nexts = 0
    mw(req, mkRes(), () => nexts++)
    mw(req, mkRes(), () => nexts++)
    const r = mkRes()
    mw(req, r, () => nexts++)
    assert.strictEqual(nexts, 2)
    assert.strictEqual(r.code, 429)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/web/rateLimit.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
'use strict'
// Minimal fixed-window in-memory rate limiter. Per-process; fine for a single-instance deployment.
module.exports = function rateLimit ({ windowMs = 60000, max = 10 } = {}) {
  const hits = new Map()
  return function (req, res, next) {
    const now = Date.now()
    const key = req.ip
    const rec = hits.get(key)
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 })
      return next()
    }
    rec.count++
    if (rec.count > max) {
      return res.status(429).send('Too many requests, please try again later.')
    }
    return next()
  }
}
```

- [ ] **Step 4: Wire it into `/login`** (the spec requires rate-limiting `/login` as well as `/invite/*`)

In `lib/auth/email/index.js`, import the limiter and add it to the `/login` route's middleware chain (before `urlencodedParser`):

```js
const rateLimit = require('../../web/middleware/rateLimit')
// ...
emailAuth.post('/login', rateLimit({ windowMs: 60000, max: 20 }), urlencodedParser, function (req, res, next) {
```

(The `/invite/*` limiter is wired in Task 9.)

- [ ] **Step 5: Run to verify pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/web/rateLimit.test.js ./test/auth --recursive`
Expected: PASS (rate-limit unit test + auth suite still green).

```bash
npx standard lib/web/middleware/rateLimit.js lib/auth/email/index.js
git add lib/web/middleware/rateLimit.js lib/auth/email/index.js test/web/rateLimit.test.js
git commit -m "feat(web): add in-memory rate limiter; apply to /login"
```

---

## Task 9: Invite redemption controller (transactional)

**Files:**
- Create: `lib/invite/index.js`, `public/views/invite/redeem.ejs`, `public/views/invite/invalid.ejs`
- Modify: `lib/routes.js`
- Test: `test/invite/redeem.test.js`

> Core correctness task. The redemption transaction: create the user with **explicit fields** (never `req.body` spread), then a **guarded conditional increment**; roll back if the increment loses the race or the user create fails.

- [ ] **Step 1: Write the failing test** (real DB)

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const { redeemInvite } = require('../../lib/invite/index')

function future () { return new Date(Date.now() + 3600 * 1000) }

describe('redeemInvite', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('creates a user with the invite role and increments usedCount', async function () {
    const inv = await models.Invite.create({ role: 'teacher', maxUses: 5, expiresAt: future() })
    const user = await redeemInvite(inv.token, { email: 'New@x.io', password: 'secret12' })
    assert.strictEqual(user.role, 'teacher')
    assert.strictEqual(user.email, 'new@x.io')
    const reloaded = await models.Invite.findByPk(inv.id)
    assert.strictEqual(reloaded.usedCount, 1)
  })

  it('ignores a role supplied in the form body (no self-promotion)', async function () {
    const inv = await models.Invite.create({ role: 'student', maxUses: 1, expiresAt: future() })
    const user = await redeemInvite(inv.token, { email: 'h@x.io', password: 'secret12', role: 'teacher' })
    assert.strictEqual(user.role, 'student')
  })

  it('does not consume a use when the email already exists', async function () {
    await models.User.create({ email: 'taken@x.io', password: 'secret12' })
    const inv = await models.Invite.create({ role: 'student', maxUses: 1, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'taken@x.io', password: 'secret12' }))
    const reloaded = await models.Invite.findByPk(inv.id)
    assert.strictEqual(reloaded.usedCount, 0)
  })

  it('refuses to over-redeem a fully-used invite (guard)', async function () {
    const inv = await models.Invite.create({ role: 'student', maxUses: 1, usedCount: 1, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'late@x.io', password: 'secret12' }))
    assert.strictEqual(await models.User.count({ where: { email: 'late@x.io' } }), 0)
  })

  it('rejects an expired or revoked invite', async function () {
    const inv = await models.Invite.create({ role: 'student', maxUses: 1, revoked: true, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'no@x.io', password: 'secret12' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/invite/redeem.test.js`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Implement `lib/invite/index.js`**

```js
'use strict'
const { Router } = require('express')
const csurf = require('csurf')
const { Op } = require('sequelize')
const validator = require('validator')
const models = require('../models')
const config = require('../config')
const logger = require('../logger')
const rateLimit = require('../web/middleware/rateLimit')
const { urlencodedParser } = require('../utils')

// csurf is per-route in this app (see lib/routes.js) — NOT global. Both the GET
// (which calls req.csrfToken()) and the POST (which validates) must attach it,
// or the GET throws and every valid invite renders the error page.
const csrfProtection = csurf({ cookie: true })

// Pure redemption logic, unit-testable without Express.
async function redeemInvite (token, { email, password, role: _ignored } = {}) {
  if (!email || !validator.isEmail(email) || !password) {
    throw new Error('invalid-credentials')
  }
  const normalized = email.toLowerCase()
  return models.sequelize.transaction(async function (t) {
    const invite = await models.Invite.findOne({ where: { token }, transaction: t })
    if (!invite || !invite.isRedeemable()) throw new Error('invite-not-redeemable')

    // Create the user with EXPLICIT fields only — never trust the form's role.
    const user = await models.User.create({
      email: normalized,
      password: password,
      role: invite.role,
      active: true
    }, { transaction: t, fields: ['email', 'password', 'role', 'active'] })

    // Guarded conditional increment: succeeds for exactly one concurrent redeemer.
    const [affected] = await models.Invite.update(
      { usedCount: models.sequelize.literal('"usedCount" + 1') },
      {
        where: {
          id: invite.id,
          revoked: false,
          expiresAt: { [Op.gt]: new Date() },
          usedCount: { [Op.lt]: models.sequelize.col('maxUses') }
        },
        transaction: t
      }
    )
    if (affected !== 1) throw new Error('invite-not-redeemable')
    return user
  })
}

const router = Router()

router.get('/invite/:token', csrfProtection, async function (req, res) {
  try {
    const invite = await models.Invite.findOne({ where: { token: req.params.token } })
    if (!invite || !invite.isRedeemable()) return res.status(410).render('invite/invalid')
    return res.render('invite/redeem', { token: req.params.token, csrfToken: req.csrfToken() })
  } catch (err) {
    logger.error(err)
    return res.status(500).render('invite/invalid')
  }
})

router.post('/invite/:token', rateLimit({ windowMs: 60000, max: 10 }), csrfProtection, urlencodedParser, async function (req, res) {
  try {
    await redeemInvite(req.params.token, req.body)
    req.flash('info', "You've registered — please sign in.")
    return res.redirect(config.serverURL + '/')
  } catch (err) {
    logger.info('invite redemption failed: ' + err.message)
    req.flash('error', 'Could not complete registration. The invite may be invalid, expired, or the email already in use.')
    return res.redirect(config.serverURL + '/invite/' + req.params.token)
  }
})

module.exports = router
module.exports.redeemInvite = redeemInvite
```

> Note: `"usedCount" + 1` / `sequelize.col('maxUses')` quoting works on PG and SQLite (Sequelize quotes identifiers). On MySQL, verify the generated SQL; if needed, use `sequelize.literal('usedCount + 1')` unquoted. Test on SQLite first (CI), document the MySQL caveat.

- [ ] **Step 4: Create views**

`public/views/invite/invalid.ejs` — minimal Bootstrap-3 page: "This invite link is invalid or has expired. Ask a teacher for a new one." (Follow the structure of an existing simple view like `public/views/error.ejs`.)

`public/views/invite/redeem.ejs` — a form `POST`ing to `/invite/<token>` with `email`, `password`, and a hidden `_csrf` = `<%= csrfToken %>`. Model the markup on the existing signin form partial.

- [ ] **Step 5: Mount the router**

In `lib/routes.js`, after the auth module mount:

```js
appRouter.use(require('./invite'))
```

Note: `/invite/:token` must be registered **before** the catch-all `/:noteId` route at the bottom of `routes.js`, or it'll be swallowed. Place the mount above the note-id routes.

- [ ] **Step 6: Run to verify pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/invite/redeem.test.js`
Expected: PASS (5 passing).

```bash
npx standard lib/invite/index.js
git add lib/invite lib/routes.js public/views/invite test/invite/redeem.test.js
git commit -m "feat(invite): transactional invite redemption + routes/views"
```

---

## Task 10: Socket-disconnect-on-deactivate helper

**Files:**
- Create: `lib/realtime/disconnectUser.js`
- Test: `test/realtime/disconnectUser.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const disconnectUser = require('../../lib/realtime/disconnectUser')

it('disconnects only the target user\'s sockets', function () {
  const disconnected = []
  const sockets = {
    a: { request: { user: { id: 'u1' } }, disconnect () { disconnected.push('a') } },
    b: { request: { user: { id: 'u2' } }, disconnect () { disconnected.push('b') } },
    c: { request: { user: { id: 'u1' } }, disconnect () { disconnected.push('c') } }
  }
  const realtime = { io: { sockets: { sockets } } }
  disconnectUser(realtime, 'u1')
  assert.deepStrictEqual(disconnected.sort(), ['a', 'c'])
})
```

- [ ] **Step 2: Run to verify it fails / Step 3: implement**

```js
'use strict'
module.exports = function disconnectUser (realtime, userId) {
  if (!realtime || !realtime.io) return
  const sockets = realtime.io.sockets.sockets
  Object.keys(sockets).forEach(function (key) {
    const socket = sockets[key]
    const u = socket.request && socket.request.user
    if (u && String(u.id) === String(userId)) {
      socket.disconnect(true)
    }
  })
}
```

- [ ] **Step 4: Run pass + lint + commit**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/realtime/disconnectUser.test.js`
Expected: PASS.

```bash
npx standard lib/realtime/disconnectUser.js
git add lib/realtime/disconnectUser.js test/realtime/disconnectUser.test.js
git commit -m "feat(realtime): disconnect a user's live sockets"
```

---

## Task 11: Admin user lifecycle + atomic lockout guard

**Files:**
- Create: `lib/admin/index.js`, `public/views/admin/dashboard.ejs`
- Modify: `lib/routes.js`
- Test: `test/admin/userLifecycle.test.js`

> The lockout guard is the second concurrency-critical piece. Deactivating/demoting must be refused if it would leave zero active teachers; implement as an atomic conditional `UPDATE` and check `affectedCount`.

- [ ] **Step 1: Write the failing test** (real DB; exercise the exported service functions, not the HTTP layer)

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

// Stub disconnectUser BEFORE requiring admin, so we can assert the deactivation
// wiring calls it with the right user id (the helper itself is tested in Task 10).
const disconnected = []
mock('../../lib/realtime/disconnectUser', (realtime, id) => disconnected.push(id))

const { models, resetDb } = require('../helpers/db')
const admin = require('../../lib/admin/index')

async function mkTeacher (email) { return models.User.create({ email, password: 'secret12', role: 'teacher' }) }

describe('admin user lifecycle', function () {
  this.timeout(10000)
  beforeEach(async function () {
    disconnected.length = 0
    await resetDb()
  })
  after(() => mock.stopAll())

  it('refuses to deactivate the last active teacher', async function () {
    const t = await mkTeacher('only@x.io')
    await assert.rejects(() => admin.deactivateUser(t.id), /last.teacher/i)
    assert.strictEqual((await models.User.findByPk(t.id)).active, true)
  })

  it('disconnects the deactivated user\'s live sockets', async function () {
    const t1 = await mkTeacher('w1@x.io')
    await mkTeacher('w2@x.io')
    await admin.deactivateUser(t1.id)
    assert.ok(disconnected.includes(t1.id))
  })

  it('allows deactivating a teacher when another active teacher exists', async function () {
    const t1 = await mkTeacher('t1@x.io')
    await mkTeacher('t2@x.io')
    await admin.deactivateUser(t1.id)
    assert.strictEqual((await models.User.findByPk(t1.id)).active, false)
  })

  it('refuses to demote the last active teacher', async function () {
    const t = await mkTeacher('solo@x.io')
    await assert.rejects(() => admin.setRole(t.id, 'student'), /last.teacher/i)
  })

  it('promotes a student to teacher', async function () {
    const s = await models.User.create({ email: 's@x.io', password: 'secret12', role: 'student' })
    await admin.setRole(s.id, 'teacher')
    assert.strictEqual((await models.User.findByPk(s.id)).role, 'teacher')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/admin/userLifecycle.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement service functions in `lib/admin/index.js`**

```js
'use strict'
const { Router } = require('express')
const csurf = require('csurf')
const { Op } = require('sequelize')
const models = require('../models')
const logger = require('../logger')
const requireTeacher = require('../web/middleware/requireTeacher')
const disconnectUser = require('../realtime/disconnectUser')
const realtime = require('../realtime/realtime')
const { urlencodedParser } = require('../utils')

const csrfProtection = csurf({ cookie: true })

// --- service layer (unit-testable) ---

// Reusable WHERE-OR fragment. The target row is safe to deactivate/demote UNLESS
// it is the last active teacher. The count INCLUDES the target, so the threshold
// is "> 1". Because it lives inside the single UPDATE's WHERE, the check and the
// write are one atomic statement — closing the read-then-write (TOCTOU) race that
// two concurrent teacher actions would otherwise exploit to reach zero teachers.
function lastTeacherSafeOr () {
  return [
    { role: { [Op.ne]: 'teacher' } },
    { active: false },
    models.sequelize.literal("(SELECT COUNT(*) FROM \"Users\" WHERE role = 'teacher' AND active = true) > 1")
  ]
}

async function assertExists (userId) {
  if (!await models.User.findByPk(userId)) throw new Error('user-not-found')
}

async function deactivateUser (userId) {
  const [affected] = await models.User.update(
    { active: false },
    { where: { id: userId, [Op.or]: lastTeacherSafeOr() }, fields: ['active'] }
  )
  if (affected !== 1) {
    await assertExists(userId) // distinguishes not-found from last-teacher
    throw new Error('cannot remove last teacher')
  }
  disconnectUser(realtime, userId)
}

async function activateUser (userId) {
  const [n] = await models.User.update({ active: true }, { where: { id: userId }, fields: ['active'] })
  if (n !== 1) throw new Error('user-not-found')
}

async function setRole (userId, role) {
  if (role !== 'teacher' && role !== 'student') throw new Error('invalid-role')
  if (role === 'teacher') {
    const [n] = await models.User.update({ role }, { where: { id: userId }, fields: ['role'] })
    if (n !== 1) throw new Error('user-not-found')
    return
  }
  // Demotion to student: same atomic last-teacher guard.
  const [affected] = await models.User.update(
    { role: 'student' },
    { where: { id: userId, [Op.or]: lastTeacherSafeOr() }, fields: ['role'] }
  )
  if (affected !== 1) {
    await assertExists(userId)
    throw new Error('cannot remove last teacher')
  }
  disconnectUser(realtime, userId)
}

async function resetPassword (userId, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('weak-password')
  const user = await models.User.findByPk(userId)
  if (!user) throw new Error('user-not-found')
  user.password = newPassword // hashed by beforeUpdate hook
  await user.save({ fields: ['password'] })
}

async function createInvite (createdById, { role, maxUses, expiresInDays }) {
  if (role !== 'teacher' && role !== 'student') throw new Error('invalid-role')
  const uses = parseInt(maxUses, 10)
  const days = parseInt(expiresInDays, 10) || 7
  if (!(uses >= 1)) throw new Error('invalid-maxUses')
  return models.Invite.create({
    role,
    maxUses: uses,
    expiresAt: new Date(Date.now() + days * 86400 * 1000),
    createdById
  })
}

async function revokeInvite (inviteId) {
  const [n] = await models.Invite.update({ revoked: true }, { where: { id: inviteId }, fields: ['revoked'] })
  if (n !== 1) throw new Error('invite-not-found')
}

// --- HTTP layer ---

const router = Router()
router.use(requireTeacher)

router.get('/admin', csrfProtection, async function (req, res) {
  const users = await models.User.findAll({ order: [['createdAt', 'ASC']] })
  const invites = await models.Invite.findAll({ where: { revoked: false }, order: [['createdAt', 'DESC']] })
  res.render('admin/dashboard', { users, invites, me: req.user, csrfToken: req.csrfToken() })
})

function handle (fn) {
  return async function (req, res) {
    try {
      await fn(req)
      req.flash('info', 'Done.')
    } catch (err) {
      logger.info(err.message)
      req.flash('error', err.message)
    }
    res.redirect('/admin')
  }
}

router.post('/admin/invites', csrfProtection, urlencodedParser, handle(req => createInvite(req.user.id, req.body)))
router.post('/admin/invites/:id/revoke', csrfProtection, urlencodedParser, handle(req => revokeInvite(req.params.id)))
router.post('/admin/users/:id/deactivate', csrfProtection, urlencodedParser, handle(req => deactivateUser(req.params.id)))
router.post('/admin/users/:id/activate', csrfProtection, urlencodedParser, handle(req => activateUser(req.params.id)))
router.post('/admin/users/:id/role', csrfProtection, urlencodedParser, handle(req => setRole(req.params.id, req.body.role)))
router.post('/admin/users/:id/reset-password', csrfProtection, urlencodedParser, handle(req => resetPassword(req.params.id, req.body.password)))

module.exports = router
Object.assign(module.exports, { deactivateUser, activateUser, setRole, resetPassword, createInvite, revokeInvite })
```

- [ ] **Step 4: Build the dashboard view** `public/views/admin/dashboard.ejs`

Bootstrap-3 page with two tables: **Users** (email, role, active, joined; per-row forms for activate/deactivate, promote/demote, reset-password — each with a hidden `_csrf`) and **Invites** (role, used/max, expiry, a generated link `/invite/<token>`, revoke button) plus a "create invite" form (role select, maxUses number, expires-in-days). For self-row demote/deactivate add an `onsubmit="return confirm(...)"` to satisfy the self-action confirmation requirement. Model markup on existing authenticated views.

- [ ] **Step 5: Mount + verify pass + lint + commit**

In `lib/routes.js` (above the `/:noteId` catch-all): `appRouter.use(require('./admin'))`.

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/admin/userLifecycle.test.js`
Expected: PASS (4 passing).

```bash
npx standard lib/admin/index.js
git add lib/admin lib/routes.js public/views/admin test/admin/userLifecycle.test.js
git commit -m "feat(admin): teacher panel with atomic last-teacher lockout guard"
```

---

## Task 12: `bin/manage_users` role support

**Files:**
- Create: `lib/user/validateRole.js`
- Modify: `bin/manage_users`
- Test: `test/user/validateRole.test.js`

> The spec calls for the invalid-role branch to be tested. `bin/manage_users` is a CLI script (not a module), so extract the role check into a tiny pure helper that both the CLI and a unit test use — this pins the latent bug class without a child-process harness.

- [ ] **Step 1: Write the failing test**

```js
'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const validateRole = require('../../lib/user/validateRole')

it('accepts teacher and student', function () {
  assert.strictEqual(validateRole('teacher'), 'teacher')
  assert.strictEqual(validateRole(undefined), 'student') // default
})
it('throws on an unknown role', function () {
  assert.throws(() => validateRole('admin'), /invalid role/i)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/user/validateRole.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helper + wire the CLI**

`lib/user/validateRole.js`:

```js
'use strict'
module.exports = function validateRole (role) {
  if (role === undefined || role === null) return 'student'
  if (role !== 'teacher' && role !== 'student') {
    throw new Error('invalid role: ' + role + " (must be 'teacher' or 'student')")
  }
  return role
}
```

In `bin/manage_users`: in `createUser`, `const role = validateRole(argv['role'])` and pass it to `User.create({ email, password, role })`. Add a `--promote <email>` action that sets `role='teacher'`. **Keep `--role` out of the mutually-exclusive action map** (it's a modifier, not an action). Fix the `action.join` bug at the existing line (`action` is a string — use it directly, don't call `.join`). Document `--role`/`--promote` in the usage text.

- [ ] **Step 4: Run unit test + manual smoke**

Run: `NODE_ENV=test npx mocha --require intelli-espower-loader --exit ./test/user/validateRole.test.js`
Expected: PASS.

Manual: `NODE_ENV=development node bin/manage_users --add --role teacher demo@x.io --pass secret12` → "Created user…"; `--role bogus` → clear "invalid role" error, no user created; `--add foo@x.io --role teacher` does NOT trip the "cannot do X and Y" action guard.

- [ ] **Step 5: Lint + commit**

```bash
npx standard bin/manage_users lib/user/validateRole.js
git add bin/manage_users lib/user/validateRole.js test/user/validateRole.test.js
git commit -m "feat(cli): manage_users --role/--promote for teacher bootstrap"
```

---

## Task 13: Docs — locked preset, first-run runbook, CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/superpowers/specs/institute-runbook.md` (or append to README per CONTRIBUTING)

- [ ] **Step 1: Write the runbook**

Document, in order: (1) install/setup; (2) `bin/manage_users --add --role teacher <you>` on the default config; (3) edit `config.json` to the locked preset — `allowEmailRegister: false`, `allowAnonymous: false`, `allowAnonymousEdits: false`, `allowProviderAutoRegister: false`, and disable every non-email provider; (4) restart; (5) sign in, open `/admin`, create a class invite, share the link. Include the warning: **never lock the config before the first teacher exists.**

- [ ] **Step 2: Update CLAUDE.md**

Add a short "Access model (institute)" subsection under conventions: roles live on `User.role`; entry is invite-only via `lib/invite`; the teacher panel is `lib/admin` guarded by `requireTeacher`; deactivation de-auths sessions (`deserializeUser`) and sockets (`disconnectUser`).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs
git commit -m "docs: institute first-run runbook + access model notes"
```

---

## Task 14: Full-suite green gate

- [ ] **Step 1: Run the complete CI gate**

Run: `npm run test:ci`
Expected: lint (`standard`) clean, `jsonlint` clean, all mocha tests pass.

- [ ] **Step 2: Build sanity**

Run: `npm run build`
Expected: webpack completes with errors-only output empty (client bundle unaffected by these server-side changes).

- [ ] **Step 3: Final commit if anything was fixed**

```bash
git add -A && git commit -m "chore: lint/test fixes for institute access slice 1"
```

---

## Notes & Risk Areas

- **SQL portability:** the guarded-increment uses identifier quoting that's correct on PG/SQLite; verify generated SQL on MySQL before deploying there. Tests run on SQLite (CI), matching production-on-Postgres closely enough for the guard logic.
- **SQLite concurrency:** the over-redemption test exercises the guard deterministically (pre-set `usedCount`), not true parallelism (SQLite serializes). The guard's correctness rests on the atomic conditional `UPDATE`, which is what's tested.
- **`response.errorForbidden`:** confirm the exact helper name in `lib/response.js` during Task 5; adjust `requireTeacher` accordingly.
- **`deserializeUser` testability:** if module-load mocking is brittle (Task 6), refactor `lib/auth/index.js` to export the callback and test it directly — prefer the refactor.
- **View markup:** the three new EJS views should be copied/adapted from the closest existing views to inherit layout, i18n, and CSP nonce handling rather than authored from scratch.
- **CSRF testing scope:** rejection of tokenless POSTs is enforced by the `csurf` middleware (a vendored, well-tested library) attached to every admin + invite mutation route. The repo has **no HTTP request-test harness** (no `supertest`), and adding one is a new dependency we're avoiding. So CSRF coverage is: (a) the per-route `csrfProtection` attachment, verified by code review, and (b) every form rendering its `_csrf` token. If you want an automated rejection test, build a throwaway `express()` app, mount the router, and drive it with Node's built-in `http` module (zero new deps) — optional hardening, not a green-gate requirement.
- **Self-demotion confirmation** lives only in the dashboard view's `onsubmit="return confirm(...)"` (client-side) and is not automatically tested — acceptable for this slice; the server-side last-teacher guard is the real protection and *is* tested.
```
