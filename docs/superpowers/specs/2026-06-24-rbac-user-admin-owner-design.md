# Slice 4a — Roles: user / admin / owner

**Date:** 2026-06-24
**Status:** Approved (design)
**Context:** Restructures the two-role system (`teacher`/`student`, Slice 1) into a three-tier RBAC. Prerequisite for **Slice 4b — per-space membership** (which needs the `owner` role for all-spaces oversight). Base branch `feature/institute-copy-templates` (current tip). Closed institute: 1 owner (lab head), ~3 admins (teachers), ~20 users (students).

## Goal

Three roles with a clear power hierarchy:

| role | user management (invites, activate/deactivate) | change roles | spaces (4b) |
|---|---|---|---|
| **user** | — | — | normal member |
| **admin** | ✅ (today's teacher powers, renamed) | — | normal member |
| **owner** | ✅ | ✅ **(owner only)** | sees/manages **all** |

owner ⊃ admin ⊃ user in capability. This slice ships the role system only; the spaces oversight column is wired in 4b.

## Decisions (locked during brainstorming)

- **Invites onboard `user` accounts only** — no role picker in invites. Role elevation is a separate **owner-only** action. (An admin minting an "admin invite" would be a backdoor around owner-only role-granting.)
- **Data migration auto-maps** `teacher→admin`, `student→user`, **and promotes the single earliest active former-teacher to `owner`** — so an upgraded instance always has exactly one owner (adjust later via CLI). If no active teacher exists, no owner is set and the CLI must bootstrap one.
- **Existing seeded accounts + the manual test guide** adopt the new terminology.

## What already exists (reuse)

- `User.role` is already a **STRING with `validate: { isIn: [['teacher','student']]] }`, default `'student'`** (`lib/models/user.js:47`) — NOT a Postgres ENUM. So the model change is just the value set + default; **no enum ALTER needed**, only a data migration.
- `lib/user/validateRole.js` — the central role validator (used by `manage_users`). One place to update the allowed set.
- `requireTeacher` middleware (`lib/web/middleware/requireTeacher.js`), used once: `router.use('/admin', requireTeacher)` (`lib/admin/index.js:103`).
- The atomic **last-teacher guard** (`lib/admin/index.js:23-34`, row-locking) — becomes the last-**owner** guard.
- Invites carry a `role` (`lib/models/invite.js:17`, applied in `redeemInvite`).
- HTTP test harness (`test/helpers/httpApp.js`, `buildApp(user)` injects `req.user`).

## Data model & migration

- **`User.role`**: `validate: { isIn: [['user','admin','owner']]] }`, `defaultValue: 'user'` (`lib/models/user.js`). (Stays a STRING.)
- **`Invite.role`**: default `'user'`; redemption always creates a `user` (see Invites below).
- **New migration** `lib/migrations/<ts>-roles-user-admin-owner.js` (append-only; do NOT edit the shipped `20260618000001-add-user-role-active.js`):
  - `UPDATE Users SET role='admin' WHERE role='teacher'`
  - `UPDATE Users SET role='user' WHERE role='student'`
  - **Owner auto-promote — two-step in JS (the `id` PK is a UUID, so "smallest id" is meaningless; order by `createdAt`):**
    1. `SELECT id FROM Users WHERE role='admin' AND active=true ORDER BY createdAt ASC, id ASC LIMIT 1` (the `id ASC` tiebreak makes it deterministic when several rows share an exact `createdAt` — common for seeded/migrated rows). No-op when the set is empty.
    2. `UPDATE Users SET role='owner' WHERE id = '<that id>'` with the literal id.
    This deliberately avoids `UPDATE ... ORDER BY ... LIMIT 1` (not portable) and a same-table subquery in UPDATE (MySQL error 1093) — both foot-guns for our sqlite/Postgres/**MySQL** targets. `down`: reverse (`admin→teacher`, `user→student`, `owner→teacher`).
  - **Migration test must seed two active admins with an identical `createdAt`** and assert **exactly one** owner (the tie case).

## Authorization

- **`requireAdmin`** (`lib/web/middleware/requireAdmin.js`): passes for `admin` **or** `owner` (active, authenticated — same active/auth checks as today's `requireTeacher`). Replaces `requireTeacher` (rename the file via `git mv`; update the single `lib/admin` require — called out, not a silent deletion).
- **`requireOwner`** (`lib/web/middleware/requireOwner.js`): passes for `owner` only. Guards role-change endpoints (and, in 4b, all-spaces access).
- **Admin panel mounts** `router.use('/admin', requireAdmin)` (invites + activate/deactivate available to admin+owner). **Role-change routes additionally apply `requireOwner`** (so an admin hitting a role-change endpoint gets 403). Role controls in `public/views/admin/dashboard.ejs` render **only when the viewer is owner**.

## Admin panel (`lib/admin`)

- **Invites, activate/deactivate:** unchanged behaviour, now gated by `requireAdmin`.
- **Set role / promote / demote:** gated by `requireOwner`. The view hides the role `<select>`/buttons from non-owners; the server enforces it regardless.
- **Last-owner guard:** the existing atomic guard (lock the *other* active rows, abort if none) now counts **owners** — block demoting or deactivating the last active owner (`cannot remove last owner`). (A lab can still have just one owner safely.) **Demotion predicate (pin explicitly):** the guard must fire on *any* move off owner — `target.role === 'owner' && newRole !== 'owner'` — so it catches **owner→admin** as well as owner→user. (A literal `'student'→'user'` swap of the old predicate would let owner→admin slip past and demote the last owner. `lib/admin/index.js:60`.)
- **Socket disconnect on demotion — drop it.** The old code disconnects live editor sockets when a user is set to `'student'` (`lib/admin/index.js:66`). In the new model **role no longer gates note access — only `active` does** (deactivation still disconnects sockets, unchanged). So the role-based socket disconnect becomes dead and is **removed**, not relabelled. (Demoting owner→admin→user changes admin/owner privileges, not note access, so there's nothing to disconnect.)

## Invites (`lib/invite`, `lib/admin`)

- Invite creation no longer takes a role — invites always onboard `role: 'user'`. Drop the role picker from the create-invite form; the create endpoint forces `'user'`. `redeemInvite` already creates with an explicit field list, so it simply uses the invite's (now always `user`) role.

## CLI (`bin/manage_users`)

- `--role` accepts `user|admin|owner` (via `validateRole`); help text updated. `--promote <email>` now promotes to **`admin`** (the "make a manager" shortcut). Bootstrap the first owner with `--add --role owner <email>` or `--role owner` on an existing user (a new `--set-role` path or reuse `--promote` semantics — finalize in planning; the spec requires *a* CLI path to create an owner).

## The `lib/browse` exception (not a mechanical rename)

`lib/browse` uses `'teacher'` for space rename/delete authz (`mutableSpace`, `lib/browse/index.js:39` = creator-or-teacher). Per the new model, **admins are normal space members; only owner has space oversight.** So change this check to **creator-or-`owner`**, not creator-or-admin. **Its client-side twin must move too:** `public/js/dashboard.js:298` `canManageSpace()` checks `dashboardUser.role === 'teacher'` — post-migration no row is `teacher`, so the Browse "manage space" control would vanish for everyone while owners can still manage via the API. Change it to `'owner'` (and **rebuild the bundle** — `NODE_OPTIONS=--openssl-legacy-provider npm run build`). (4b extends space authz further; 4a just corrects the literal to the right tier.)

## Terminology sweep

Update `teacher→admin` / `student→user` literals and labels across (grep-verified set): `lib/models/user.js` (validation set + default `'user'`), `lib/models/invite.js` (its **`isIn` validator** must accept `'user'`, not just the default), `lib/user/validateRole.js` (allowed set + default + error message), `lib/admin/index.js`, `bin/manage_users` (`--promote` hardcodes `'teacher'` + help text), `public/views/admin/dashboard.ejs` (role `<select>`, label-color ternaries, promote/demote forms — plus the owner-only render gate), `public/js/dashboard.js` (`canManageSpace` → owner, see above), `public/views/invite/invalid.ejs` ("Ask a teacher" → "Ask an admin"), `lib/browse/index.js` (→ owner). Do **not** edit the shipped migration `20260618000001-...`. Also refresh `docs/manual-test-guide.md` and re-seed the dev accounts' roles.

**Tests the sweep breaks** (update, not optional): `test/web/requireTeacher.test.js` (→ requireAdmin/requireOwner), `test/admin/userLifecycle.test.js`, `test/user/validateRole.test.js`, `test/models/user.test.js`, `test/models/invite.test.js`, `test/invite/redeem.test.js`, `test/browse/spaces.test.js`, and `role: 'student'`/`'teacher'` fixtures in `test/http/*.test.js`.

## Testing (mocha + power-assert + sqlite `:memory:`; service + HTTP harness)

- **Model:** `role` accepts `user`/`admin`/`owner`, rejects `teacher`/`student`/garbage; default is `user`.
- **Middleware:** `requireAdmin` passes admin+owner, 403s a user; `requireOwner` passes owner only, 403s admin+user (+ inactive/anon → as today).
- **Admin HTTP (harness):** an **admin** can create an invite + deactivate a user (200) but **cannot change a role** (403); an **owner** can change a role (200); the **last-owner guard** blocks demoting/deactivating the final owner (error). A `user` hitting `/admin` → blocked.
- **Invite:** redeeming an invite creates a `user` (role forced), regardless of any role in the request.
- **Migration:** former `teacher` rows become `admin`, `student`→`user`, and exactly one earliest active former-teacher becomes `owner` (and none → no owner). Test at the data level (run the up() against seeded rows).
- Seed real `User`s; the harness injects `req.user` with the role under test.

## Files (approximate)

- `lib/models/user.js`, `lib/models/invite.js`, `lib/user/validateRole.js`.
- `lib/web/middleware/requireAdmin.js` (renamed from requireTeacher), `lib/web/middleware/requireOwner.js` (new).
- `lib/admin/index.js` (guards, last-owner, owner-only role routes), `public/views/admin/dashboard.ejs` (owner-only role UI, labels).
- `lib/invite/index.js` (role forced to user), invite-create form, `public/views/invite/invalid.ejs`.
- `lib/browse/index.js` (teacher→owner for space authz) + `public/js/dashboard.js` (`canManageSpace`→owner; rebuild bundle).
- `bin/manage_users` (roles + bootstrap owner).
- `lib/migrations/<ts>-roles-user-admin-owner.js`.
- Tests under `test/models`, `test/web/middleware` (or `test/admin`), `test/http`, `test/migrations` (or a data-level migration test).
- `docs/manual-test-guide.md`, CLAUDE.md.

## Out of scope (→ Slice 4b)

`SpaceMember` model; space visibility gated by membership; member add/remove ("any member"); owner all-spaces oversight in Browse; the dashboard member-management UI. 4a only makes `owner` *exist* and corrects the space-authz literal to `owner`.

## Open questions for planning

- Exact CLI surface to mint an owner (extend `--role` on an existing user vs a dedicated flag) — pick the smallest change in the plan.
- Whether to keep a thin `requireTeacher.js` re-export for safety vs a clean `git mv` (lean: clean rename — only one caller).
- Portable "earliest active former-teacher" SQL for the owner auto-promote (sqlite + Postgres) — verify during planning.
