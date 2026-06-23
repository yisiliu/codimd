# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CodiMD is a realtime collaborative markdown editor (the open-source version of HackMD). It's a Node.js monolith: an Express HTTP server + a Socket.io realtime layer backed by Operational Transformation (OT), with a Sequelize ORM persisting to Postgres/MySQL/MariaDB/SQLite/MSSQL. The browser client is a jQuery/CodeMirror app bundled by webpack.

Node version is pinned: `>=14 <17` (see `.nvmrc` → v16.20.2). Code style is `standard` (no semicolons). The repo uses CommonJS, not ES modules.

## Commands

```bash
./bin/setup            # copy config.json.example → config.json and .sequelizerc.example → .sequelizerc, then npm install
npm run dev            # webpack --watch: rebuild the client bundle on change (run alongside the server)
npm start              # sequelize db:migrate && node app.js  (the real entrypoint)
npm run build          # production client bundle → public/build
npm run lint           # standard (JS lint); jsonlint validates all *.json
npm test               # lint + jsonlint + coverage (mocha via nyc) — the full CI gate
npm run mocha          # tests only, no lint/coverage
```

Run a single test file or pattern:

```bash
npx mocha --require intelli-espower-loader --exit ./test/realtime --recursive   # one dir
npx mocha --require intelli-espower-loader --exit ./test/csp.js                  # one file
npx mocha --require intelli-espower-loader --exit ./test --recursive -g "pattern"
```

Tests use `mocha` + `power-assert` (via `intelli-espower-loader`, so plain `assert` gives rich diffs) + `sinon` + `mock-require`. `lib/` is the coverage target.

Database operations go through `sequelize-cli` (configured by `.sequelizerc`, which points at `config.js` for connection info and `lib/migrations` for migrations):

```bash
npx sequelize db:migrate
npx sequelize migration:create --name my-change   # then edit the generated file in lib/migrations
```

## Configuration

Config is layered and merged in this order (`lib/config/index.js`), then deep-frozen:

`default.js` → `defaultSSL.js` → package version → **`config.json`** (per-`NODE_ENV` section) → **environment variables** (`lib/config/environment.js`, the `CMD_*` vars) → Docker secrets.

So every setting has three sources: `config.json`, a `CMD_`-prefixed env var, and a built-in default. `config.js` at the repo root just re-exports `config.db` for sequelize-cli. The frozen `config` object is required everywhere as `require('./lib/config')`.

## Architecture

### Request lifecycle
`app.js` is the server bootstrap: it wires Express middleware (helmet/CSP, i18n, session backed by `connect-session-sequelize`, passport, `tooBusy`), mounts `lib/routes.js`, attaches Socket.io with passport auth, then `models.sequelize.sync()` → `startListen()`. All routes live in `lib/routes.js`, which delegates to controller modules under `lib/`:

- `lib/note/` — the core note controller (show/publish/export/actions). Note **actions** (download, slide, pandoc export, gist/dropbox/gitlab publish, revisions, info) are dispatched in `lib/note/noteActions.js`.
- `lib/homepage`, `lib/history`, `lib/user`, `lib/status`, `lib/imageRouter` (image upload to filesystem/S3/minio/azure/imgur/lutim), `lib/errorPage`.
- `lib/auth/` — one subdirectory per passport strategy (github, gitlab, google, ldap, saml, oauth2, openid, email, …). `lib/auth/index.js` mounts only the enabled ones based on config. Adding an auth provider = new subdir + config flags + a view toggle in `app.locals.authProviders`.
- `lib/response.js` — shared rendering/redirect helpers (new note, publish views).

### Models (`lib/models/`)
Sequelize models auto-loaded by `index.js`: **Note**, **User**, **Revision**, **Author**. A Note belongs to an owner/lastchangeuser User and has many Revisions and Authors.

Note IDs are polymorphic. `Note.parseNoteId` resolves an incoming URL segment by trying, in order: **alias** → **LZString-compressed** → **base64url UUID** → **shortid**. When touching note lookup or URL handling, preserve this chain.

`Revision` stores patch-based history (diff-match-patch); `Revision.checkAllNotesRevision` runs at startup/shutdown to flush pending revisions before exit.

### Realtime collaboration (`lib/realtime/` + `lib/ot/`)
This is the heart of the app and the trickiest part to change safely.

- `lib/realtime/realtime.js` holds **in-memory note state** (`notes`, `users`) keyed by note id. Socket connections authorize via the session cookie (`secure`), then connect/disconnect through serialized `ProcessQueue`s to avoid races.
- `lib/ot/` is the Operational Transformation engine. `editor-socketio-server.js` is the server-side OT document; `text-operation.js` / `selection.js` / `wrapped-operation.js` implement transform/compose. The matching client lives in `public/js/lib/editor`. **This directory is excluded from `standard` lint** (see `package.json` `standard.ignore`) — it's vendored/derived code; match its existing style rather than reformatting.
- Background jobs run on intervals against the in-memory state: `realtimeUpdateDirtyNoteJob` (persist edited notes), `realtimeSaveRevisionJob` (snapshot revisions), `realtimeCleanDanglingUserJob` (GC disconnected users).

Note content edited live is only flushed to the DB by these jobs — it is not written synchronously on each keystroke. Graceful shutdown (`SIGINT/SIGTERM/SIGQUIT` in `app.js`) sets `realtime.maintenance`, notifies clients, and waits for revisions to flush before exiting.

### Frontend
The client is **not** part of the Node module graph. Source in `public/js/` (webpack entries `index`, `pretty`, `slide`, `cover`, plus a shared `common` chunk) is bundled to `public/build/`; HTML export uses the separate `webpack.htmlexport.js` config. Server-rendered pages are **EJS** views in `public/views/` (`set('views', config.viewPath)`), with some Handlebars (`html.hbs`) for export. The editor itself is CodiMD's fork of CodeMirror plus a large markdown-it pipeline (math via MathJax, diagrams via mermaid/flowchart/plantuml/vega, slides via reveal.js).

Webpack configs: `webpack.common.js` (shared, ~20 entry/vendor chunks), `webpack.dev.js`, `webpack.prod.js`, `webpack.htmlexport.js`. After changing `public/js` or `public/css`, rebuild the bundle (`npm run dev` keeps it live).

## Conventions & gotchas

- **`standard` lint, no semicolons.** Ignored paths: `public/build`, `public/vendor`, `lib/ot`, `webpack.*`. Run `npm run lint` before claiming done.
- **Two processes in dev:** `npm run dev` (client bundle watcher) and `npm start` (server). Editing `lib/` requires restarting the server; editing `public/js` is picked up by the watcher but needs a browser reload.
- Server code is CommonJS with mixed `var`/`const`; the realtime/OT code predates modern syntax. Match the surrounding file.
- i18n strings live in `locales/`; user-facing text goes through `i18n` / `req.__()`.
- Migrations are append-only and run automatically on `npm start` — never edit a migration that has shipped; add a new one.

## Access model (institute)

For closed (invite-only) deployments:

- **Roles & state:** `User.role` is `'user'` | `'admin'` | `'owner'`; `User.active` gates access. `requireAdmin` (`lib/web/middleware/requireAdmin.js`) admits authenticated, **active** admins **or** owners; `requireOwner` (`lib/web/middleware/requireOwner.js`) admits only active **owners** and guards role changes.
- **Invite-only entry:** sign-up flows through `lib/invite` (`/invite/:token`, GET form + POST redemption). Redemption is transactional with an atomic compare-and-set on `usedCount`, so an invite can't be over-redeemed past `maxUses`; invites onboard **`user`** only (no role picker) and the new user is created as a `user`.
- **Admin panel:** `lib/admin` (`/admin`, guarded by `requireAdmin`) lets admins+owners create/revoke invites and activate/deactivate users; **role changes** (`setRole`) are **owner-only** (the role route is additionally gated by `requireOwner`). A **last-active-owner guard** (atomic, row-locking) blocks removing or demoting the final owner.
- **Deactivation is immediate:** flipping `active = false` de-auths existing **web sessions** (`deserializeUser` in `lib/auth/index.js` rejects inactive users) **and** live **editor sockets** (`disconnectUser` in `lib/realtime/`). Role no longer gates note access (only `active` does), so `setRole` does **not** disconnect sockets.
- **Provider auto-register gate:** SSO logins only auto-create accounts when `config.allowProviderAutoRegister` is true (default false) — see `lib/auth`’s provider strategies.
- **Migration to user/admin/owner:** `lib/migrations/20260624000001-roles-user-admin-owner.js` maps `teacher`→`admin` / `student`→`user` and auto-promotes the **earliest active former-teacher** (by `createdAt`, `id` tiebreak) to `owner`.
- **Bootstrap:** the first owner is created on the CLI via `bin/manage_users --add --role owner <email>` (`--add --role admin <email>` for an admin; `--promote <email>` promotes to `admin`) — the only path that survives a locked config.
- **Locked-instance preset & full procedure:** set `allowEmailRegister`/`allowAnonymous`/`allowAnonymousEdits`/`allowProviderAutoRegister` to false and leave non-email provider credentials unset (providers are enabled by credential presence, see `isXxxEnable` in `lib/config/index.js`). Full first-run runbook: `docs/institute-runbook.md`.

## Notes dashboard (signed-in home)

For signed-in users, the home page (`/`) renders a personal **Notes Dashboard** (`public/views/dashboard.ejs`, chosen in `lib/homepage` `showIndex`) instead of the cover landing:

- **Organization model:** flat `Folder`s (`lib/models/folder.js`, per-owner unique name) and user-applied `NoteTag`s (`lib/models/notetag.js`, normalized lowercase), plus two owner-personal columns on `Note` — `folderId` (one folder per note) and `pinned`. Pin is a real column, **not** the legacy history JSON.
- **API:** owner-guarded `/api/*` endpoints in `lib/dashboard` (folders CRUD, `PUT /api/notes/:id/folder|pin`, `POST/DELETE .../tags`). Session-auth only (no csurf, matching `/api/notes/*`). The router defines **only** `/api/*` routes and is mounted above the `/:noteId` catch-all — it carries no root-level `router.use(guard)` (see the Slice-1 admin-router leak lesson).
- **No DB foreign keys:** this repo emits no enforced FKs except a legacy `Notes.ownerId`. Organization cleanup is **explicit app-level** code — deleting a folder nulls its notes' `folderId`; deleting a note removes its `NoteTag` rows (`cleanupNoteOrganization` in `lib/note`).
- **Note IDs:** `getMyNoteList` returns base64url-**encoded** ids; the client sends them as-is and the router parses them server-side via `Note.parseNoteIdAsync` (the canonical id chain — the client must not reimplement decoding).

### Shared spaces & Browse

The dashboard has a **My Notes ⇄ Browse** toggle:
- **Spaces** (`lib/models/space.js`, case-insensitive-unique via a `nameLower` column) are institute-wide shared collections any member creates; `NoteSpace` (`lib/models/notespace.js`) is the owner's opt-in many-to-many link. Cleanup is app-level (space delete → its `NoteSpace` rows; note delete → `cleanupNoteOrganization` also clears `NoteSpace`).
- **Membership-gated** (`SpaceMember`, `lib/models/spacemember.js` — mirrors `NoteSpace`): you only see a space + its notes if you're a member; `listSpaces`/`listBrowse` filter by member-spaces, and `setNoteSpaces` only files a note into spaces you're a member of. The institute **`owner` role** bypasses the filter and sees/manages all spaces. The Slice-4b migration backfills each existing space's steward as its first member; space/note delete also cleans up `SpaceMember` rows.
- **Steward** = `Space.createdById` (creator until transferred): **any member invites** (`addMember`), but **only the steward** (or `owner`) removes another member / transfers stewardship; the steward **can't leave** until they transfer first (protects the exactly-one-steward invariant). A plain member may leave (self-remove). All id compares use `String()`.
- **API** in `lib/browse` (same `/api/*`-only, per-route-auth, mounted-above-`/:noteId` discipline): `GET/POST /api/spaces` (any member), `PUT/DELETE /api/spaces/:id` (**steward or owner**), `PUT /api/notes/:id/spaces` (**owner**), `GET /api/browse?space=`, plus membership routes `GET/POST /api/spaces/:id/members` (list / invite), `DELETE /api/spaces/:id/members/:userId` (remove or leave), `PUT /api/spaces/:id/steward` (transfer), and `GET /api/users` (feeds the invite picker).
- **Browse visibility** lists a categorized note for a viewer iff `(permission IS NULL OR permission != 'private') OR ownerId = me` — i.e. it never exposes a note the viewer couldn't already open. Search is client-side (`list.js`). A **Members modal** in the Browse sidebar drives invite/remove/leave/transfer.

### Copy & templates (teaching workflow)

`lib/teach` adds the handout→copy loop on one clone mechanism (same `/api/*`-only, parse-encoded-id, mounted-above-`/:noteId` discipline):
- `cloneNote(userId, sourceId)` copies a **viewable** note's content into a fresh note you own — content-only (no permission/folder/tags/spaces/pin/template carried), with the title derived via `Note.parseNoteTitle(content)` (**required** — `getMyNoteList` returns the raw `title` column, which `beforeCreate` only fills for empty content). Endpoint `POST /api/notes/:id/clone` → `{ id }`.
- **Templates:** a `Note.template` boolean (owner-toggled via `PUT /api/notes/:id/template`); `GET /api/templates` lists viewable, flagged notes; the dashboard has a copy button per row (My Notes + Browse), a template star/badge, and a "New from template" picker. Copy buttons also live in the editor menu (`codimd/header.ejs` `.ui-make-copy` + `public/js/index.js`) and the published view (`pretty.ejs`).
- **Read-only handouts** are just CodiMD's existing `protected`/`locked` permission — no new code; the copy button is the new affordance.

### Testing notes (org/dashboard/browse)

- `test/helpers/db.js` (`{ models, resetDb }`) syncs models to sqlite `:memory:`. **`Notes.ownerId` is an enforced FK on sqlite** (its association carries `onDelete:'CASCADE'`), so any test creating a `Note` must seed a real `User` (`User.create({})` — no password, no scrypt). Notes whose title is asserted need non-empty `content` (the `beforeCreate` hook overwrites empty-content titles from `public/default.md`).
- **HTTP route tests** use `test/helpers/httpApp.js` (`buildApp(user)` → mounts real `lib/routes` with injectable fake-auth, via `supertest`). The test file must manage the lib require-cache (`removeLibModuleCache` before/after + one shared `models` instance) or it pollutes the mock-based realtime suite — see `test/http/routing.test.js` for the pattern.
