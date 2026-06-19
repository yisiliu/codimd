# Slice 1 — Closed Institute Instance: Roles, Invite Onboarding, Teacher Admin Panel

**Date:** 2026-06-17
**Status:** Approved (design) — revised after adversarial review (architecture / security / scope)
**Context:** Make CodiMD team-friendly for a research institute of 3 teachers + ~20 graduate students. First of three planned slices. Slice 2 (note organization: tags + browse/search dashboard) and Slice 3 (teaching workflow: handouts, templates, comments) are out of scope here and get their own specs.

## Goal

Turn a stock CodiMD instance into a closed, invite-only instance with two roles (teacher, student) and a teacher-facing web admin panel for onboarding and account lifecycle — replacing the current CLI-only, role-less, openly-registerable model.

## Non-goals (YAGNI)

- No org/team/workspace tables. One closed instance *is* the team.
- No SMTP / email sending; no self-service "forgot password". Teacher-initiated reset in the panel covers it.
- No hard-delete UI. Offboarding is deactivation (preserve notes/authorship). `bin/manage_users --del` remains a CLI escape hatch.
- No note organization, tags, handouts, comments (later slices).
- No account-enumeration hardening on the login page — for a closed 23-person lab where everyone knows everyone it's theater. Use a clear "Account is deactivated." message.

## Current state (verified against code)

- `lib/models/user.js:37-46`: `User.email` is `TEXT` with only `isEmail` validation — **NO `unique` constraint** (only `profileid` is unique, `user.js:18-20`; confirmed no unique email index in migrations). `password` hashed via `beforeCreate`/`beforeUpdate` hooks. No `role`, no `active`.
- **Case-sensitivity mismatch:** login matches `LOWER(email)` (`lib/auth/email/index.js:25-28`) but `/register`'s `findOrCreate` matches raw `req.body.email` (`:46-49`). So `Foo@x.com` and `foo@x.com` can both exist; duplicate-prevention is race-prone `findOrCreate`, not a DB constraint.
- `/register` gated only by `config.allowEmailRegister` (`email/index.js:41`); when on, any email self-registers. Email strategy itself mounted only `if (config.isEmailEnable)` (`lib/auth/index.js:50`, default true).
- **Other providers auto-create users:** `lib/auth/utils.js:33-44` `passportGeneralCallback` does `User.findOrCreate` keyed on `profile.id` with no gate (github/google/gitlab/oauth2/facebook/twitter/dropbox/mattermost/bitbucket); `lib/auth/ldap/index.js:53`, `saml/index.js:49`, `openid/index.js:20` do likewise. Each mounted purely on its `config.is<Provider>Enable` flag.
- **Session freshness:** `deserializeUser` (`lib/auth/index.js:18-35`) reloads the user from DB **every request** but only checks `user == null` — never `active`. Socket auth (`app.js:240-247`, `passport.socketio`) snapshots `socket.request.user` **at handshake only**; never re-checked for the connection's life (`realtime.js` reads the snapshot).
- `bin/manage_users:87-108`: treats every key in its `options` map as a **mutually-exclusive action** (`opts.length > 1` → error); latent bug at `:107` (`action.join` on a string).
- `lib/auth/email/index.js:82`: `/login` hardcodes `failureFlash: 'Invalid email or password.'`, which **overrides** any per-attempt message from the strategy.
- `lib/routes.js:20-24`: `csurfMiddleware = csurf({ cookie: true })` applied **per-route** (e.g. `:24`, `:58`), NOT globally. Auth routes (`:37`) have none.
- `Model.update(...)` returns `[affectedCount]` in Sequelize 5 — precedent for atomic guards at `lib/realtime/realtimeClientConnection.js:98,105`.
- Models auto-load (`lib/models/index.js`); `(sequelize, DataTypes) => Model` + optional `associate`. Views: `app.set('views', config.viewPath)`, EJS in `public/views/`, Bootstrap 3. Signin view already hides register when `authProviders.allowEmailRegister` is false (to confirm in planning).
- `lib/config/default.js`: `allowAnonymous: false`, `allowAnonymousEdits: true`, `allowEmailRegister: true`.

## Decisions (locked during brainstorming)

- Sign-in: email + password inside CodiMD.
- Onboarding: invite links only; both single-use and reusable (class-wide). Open self-registration disabled.
- Roles: two — `teacher` and `student`; all teachers equal admins.
- Offboarding: deactivate (keep notes); no hard-delete UI.
- First teacher bootstrap: CLI. DB is the single source of truth for roles.

## Design

### 1. Data model — one migration set

**Extend `User`:**
- `role`: `STRING`, default `'student'`, validate `isIn(['teacher','student'])`. String (not DB `ENUM`) for clean cross-dialect migration.
- `active`: `BOOLEAN`, default `true`. `false` ⇒ login refused **and** existing sessions/sockets killed (see §4).
- **Add a unique index on `email`** (the missing constraint). Normalize email to lowercase on every write path (redemption, admin create, and ideally the existing register path). A `LOWER(email)` functional index is ideal on PG but dialect-specific; minimum bar is a plain unique index on a lowercased-on-write column. This is a prerequisite for the "don't consume an invite use on duplicate email" logic — today the DB would NOT reject duplicates.

Migration sets `role`/`active` defaults **in the `addColumn` DDL** (`{ type, defaultValue, allowNull: false }`) so existing rows are backfilled by the database (works PG/MySQL/SQLite); a model-level default alone does NOT backfill. Follow the repo's idempotency pattern. **Sequencing:** the migration (adding+backfilling `active`) must land *before or atomically with* the login `active` gate, or every existing user is locked out on deploy.

**New `Invite` model (`lib/models/invite.js`):**

| field | type | notes |
|---|---|---|
| `id` | UUID, pk | |
| `token` | STRING, unique | crypto-random URL-safe, ≥128 bits (`crypto.randomBytes(32).toString('base64url')`); **not** shortid |
| `role` | STRING | granted on redemption; `isIn(['teacher','student'])` |
| `maxUses` | INTEGER, **NOT NULL** | `1` = single-use, `N` = class link. **No unlimited/null branch** — removed as footgun and SQL hazard |
| `usedCount` | INTEGER, default 0 | |
| `expiresAt` | DATE, **NOT NULL** | every invite expires; UI offers "expires in N days" (default 7), not an open-ended picker |
| `revoked` | BOOLEAN, default false | |
| `createdById` | UUID, FK → User | `constraints: false` (matches repo FK style) |

Association: `Invite.belongsTo(User, { foreignKey: 'createdById', constraints: false })`.

`Invite.prototype.isRedeemable()` = `!revoked && expiresAt > now && usedCount < maxUses`. Single source of truth for both the redemption route and the panel's status display. (With `maxUses`/`expiresAt` non-null, the predicate has no NULL edge cases.)

### 2. Onboarding flow

**Locked-instance config preset (documented runbook, operator-set):**
`allowEmailRegister: false`, `allowAnonymous: false`, `allowAnonymousEdits: false`, **and all non-email auth providers disabled** (`isFacebookEnable … isOAuth2Enable`, `isLDAPEnable`, `isSAMLEnable`, `isOpenIDEnable`, `isGitHubEnable`, etc. — every social/enterprise strategy off). Leaving any enabled is an invite-gate bypass (anyone with e.g. a GitHub account self-registers as `student`).

**Defense-in-depth (config is too easy to misconfigure for a P0 boundary):** add a guard in `passportGeneralCallback` (`lib/auth/utils.js`) and the ldap/saml/openid callbacks that refuses a *newly created* account (`created === true`) unless the instance explicitly allows provider auto-provisioning. For this slice, gate creation behind a single config flag (e.g. `allowProviderAutoRegister`, default `false` once locked) and `return done(null, false)` with a flash when a new external identity would be created and auto-register is disabled. Existing matched accounts still log in.

**Invite redemption** — dedicated module `lib/invite/` (cleaner than overloading `lib/auth/email`):
- `GET /invite/:token` → `isRedeemable()` ? render set-email-and-password form (with CSRF token) : render "invalid/expired invite" page.
- `POST /invite/:token` (CSRF-protected, rate-limited) → run inside a **transaction**:
  1. Re-validate `isRedeemable()`.
  2. Validate + lowercase email, validate password; **construct the user with explicit fields only** — `User.create({ email, password, role: invite.role, active: true })`. **Never** spread `req.body` (a student redeeming a student invite must not be able to POST `role=teacher`).
  3. On unique-email collision → friendly "email already registered", roll back, **do not consume a use**.
  4. On success → guarded conditional increment: `Invite.update({ usedCount: literal('usedCount + 1') }, { where: { id, revoked: false, usedCount: { [lt]: col('maxUses') }, expiresAt: { [gt]: now } } })`; require `affectedCount === 1`. If it's 0 (lost a concurrent race for a `maxUses`-limited link), roll back the user create. This reconciles "exactly one account under concurrency" with "no use burned on failure."
- Flash success → redirect to sign-in.

**Front door:** with registration locked, a not-yet-invited visitor at `/` sees the signin form with no register affordance. Confirm the signin view hides register on `allowEmailRegister === false` and that no other "Sign up" link dangles.

### 3. Teacher admin panel

- New controller `lib/admin/index.js`, mounted in `lib/routes.js`.
- New middleware `lib/web/middleware/requireTeacher.js`: 403 unless `req.isAuthenticated() && req.user.role === 'teacher' && req.user.active`. Applied to **every** `/admin` route and **every** mutation endpoint (never trust the UI to hide a capability — CodiMD renders user markdown/HTML, so a missing guard is a one-request escalation).
- Views under `public/views/admin/` (EJS, Bootstrap 3). **Every** mutating form is POST with an explicitly-attached `csurfMiddleware` + rendered CSRF token (csurf is per-route here, not inherited).

Routes:
| method + path | purpose |
|---|---|
| `GET /admin` | dashboard: users (email, role, active, joined) + invites (role, used/max, expiry, status) |
| `POST /admin/invites` | create invite (role, maxUses, expires-in-days) |
| `POST /admin/invites/:id/revoke` | revoke |
| `POST /admin/users/:id/deactivate` | `active=false` (+ kill sessions/sockets, §4) |
| `POST /admin/users/:id/activate` | `active=true` |
| `POST /admin/users/:id/role` | promote/demote (`teacher`⇄`student`) |
| `POST /admin/users/:id/reset-password` | teacher sets a temp password (explicit `fields: ['password']` on update — no body passthrough) |

**Lockout guard — atomic, shared helper.** One helper `assertWouldLeaveActiveTeacher(targetUserId, intendedChange)` used by deactivate AND demote. Enforce it as an atomic conditional write inside a transaction, e.g. `UPDATE users SET active=false WHERE id=:id AND (SELECT count(*) FROM users WHERE role='teacher' AND active=true) > 1`, then check affected rows — closing the TOCTOU race where two concurrent teacher actions each read count=2 and both proceed to 0. **Self-action confirmation:** a teacher demoting/deactivating *themselves* (while others exist) must hit an explicit confirmation, to avoid accidental self-lockout mid-session.

### 4. Deactivation must terminate live access (not just block re-login)

- **HTTP:** add `if (!user.active) return done(null, false)` to `deserializeUser` (`lib/auth/index.js`). Since it reloads from DB every request, a deactivated user de-auths on their next request — not only at next login.
- **Sockets:** on deactivate, actively disconnect — iterate `realtime.io.sockets.sockets`, `socket.disconnect(true)` where `socket.request.user.id === targetId`. Otherwise an open editor socket keeps editing indefinitely.
- **Login:** in the `LocalStrategy`, reject inactive users. To surface a specific message, change `/login`'s `failureFlash` from the hardcoded string to `true` and emit `done(null, false, { message: 'Account is deactivated.' })` from the strategy (the current hardcoded `failureFlash` would otherwise mask it).

### 5. First-teacher bootstrap (CLI) + first-run runbook

- Extend `bin/manage_users`: `--role teacher|student` as a **modifier** read inside `createUser` / a promote path — NOT registered as an `options` action (that map is parsed as mutually-exclusive actions; adding `role` there trips the "can't do X and Y" guard). Also fix the latent `action.join` bug at `:107` if the promote path exposes it. Add a way to change an existing user's role (e.g. `--promote <email>`).
- **Documented first-run order (prevents self-stranding):** on the still-default (unlocked) config, run `bin/manage_users --add --role teacher <email>` to create the first teacher in one shot; *then* flip `config.json` to the locked preset (§2); *then* invite everyone else via the panel. Never lock the instance before a teacher exists — there'd be no route in. DB stays the single source of truth (no config email-allowlist auto-promotion).

## Security summary (post-review)

| sev | issue | mitigation |
|---|---|---|
| P0 | OAuth/LDAP/SAML auto-create bypasses invites | disable all non-email providers in preset **+** `created===true` guard in provider callbacks |
| P0 | deactivation doesn't kill live HTTP sessions / sockets | `active` check in `deserializeUser`; force `socket.disconnect` on deactivate |
| P0 | email not unique + case mismatch | unique email index + lowercase-on-write |
| P1 | mass-assignment of `role` on redeem/update | explicit field construction; `fields:` allowlist on updates |
| P1 | last-teacher lockout TOCTOU | atomic conditional UPDATE in a transaction; shared helper |
| P1 | invite use burned on redeem failure | transaction: create-then-guarded-increment, rollback on race loss |
| P2 | CSRF available but not auto-applied to new routers | explicit `csurfMiddleware` per new route + tests |
| P2 | invite token in access logs / validity oracle | rate-limit `/invite/*`; keep tokens out of logs where feasible |
| P2 | self-demotion/self-deactivation | confirmation step |

## Testing (mocha + power-assert, mirroring `test/`)

- `Invite.isRedeemable()`: fresh / expired / revoked / at `maxUses`.
- Redemption: creates user with invite's role + `active=true`, increments `usedCount`; rejects when not redeemable; **duplicate-email path neither creates a user nor increments `usedCount`**; **`role` in the POST body is ignored** (no self-promotion).
- Over-redemption: concurrent redemptions of `maxUses=1` create exactly one account; the loser's user-create rolls back.
- `requireTeacher`: 403 for anonymous / students / deactivated teachers; passes for active teachers.
- Deactivation: fails `LocalStrategy`; **`deserializeUser` de-auths an existing session**; **open socket is disconnected**.
- Lockout guard: deactivating/demoting the last active teacher is refused (incl. a concurrent-action test); succeeds when another active teacher exists.
- Provider auto-register guard: a new external identity is refused when auto-register is off.
- CSRF: `POST /admin/users/:id/role` and invite POST reject requests without a valid token.
- `bin/manage_users --role`: creates a teacher; promotes an existing user; `--add … --role …` does not trip the action-exclusivity guard.

## Files touched (approximate)

- `lib/migrations/<ts>-add-user-role-active.js` (+ unique email index), `lib/migrations/<ts>-create-invite.js`
- `lib/models/user.js` (role, active, unique email, validators), `lib/models/invite.js` (new)
- `lib/auth/index.js` (`deserializeUser` active check), `lib/auth/email/index.js` (login active reject + `failureFlash`), `lib/auth/utils.js` + ldap/saml/openid callbacks (auto-register guard)
- `lib/invite/index.js` (new redemption module), `lib/admin/index.js` (new), `lib/web/middleware/requireTeacher.js` (new)
- `lib/routes.js` (mount admin + invite routers, per-route csurf), `lib/realtime/realtime.js` (helper to disconnect a user's sockets)
- `public/views/admin/*.ejs`, invite redemption + invalid-invite views; confirm signin view register-hiding
- `bin/manage_users` (`--role` modifier / `--promote`; fix `action.join`)
- `lib/config/default.js` (+`allowProviderAutoRegister: false` flag if adopted)
- `test/admin/`, `test/invite/`, `test/models/` (new tests)
- Docs: locked-down "institute" config preset + first-run runbook; CLAUDE.md mention of admin/role/invite concepts.

## Open questions for planning

- Rate-limiter choice for `/invite/*` and `/login` (no limiter in deps today — pick a minimal one or a small in-memory guard; avoid a heavy dependency).
- Exact `bin/manage_users` flag surface for role change, consistent with `--add/--del/--reset`.
- Whether the provider auto-register guard ships as a new config flag or is purely documentation-driven (lean: small flag, defense-in-depth).
- Password min-length policy on redemption/reset — adopt the existing email-auth implication; no new policy subsystem.
