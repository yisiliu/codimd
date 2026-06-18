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

- **Roles & state:** `User.role` is `'teacher'` | `'student'`; `User.active` gates access. `requireTeacher` (`lib/web/middleware/requireTeacher.js`) admits only authenticated, **active** teachers.
- **Invite-only entry:** sign-up flows through `lib/invite` (`/invite/:token`, GET form + POST redemption). Redemption is transactional with an atomic compare-and-set on `usedCount`, so an invite can't be over-redeemed past `maxUses`; the new user is created with the invite's role.
- **Teacher admin panel:** `lib/admin` (`/admin`, guarded by `requireTeacher`) creates/revokes invites and activates/deactivates/sets-role on users. A **last-active-teacher guard** (atomic, row-locking) blocks removing or demoting the final teacher.
- **Deactivation is immediate:** flipping `active = false` de-auths existing **web sessions** (`deserializeUser` in `lib/auth/index.js` rejects inactive users) **and** live **editor sockets** (`disconnectUser` in `lib/realtime/`). `setRole` to `student` also disconnects sockets.
- **Provider auto-register gate:** SSO logins only auto-create accounts when `config.allowProviderAutoRegister` is true (default false) — see `lib/auth`’s provider strategies.
- **Bootstrap:** the first teacher is created on the CLI via `bin/manage_users --add --role teacher <email>` (or `--promote <email>`) — the only path that survives a locked config.
- **Locked-instance preset & full procedure:** set `allowEmailRegister`/`allowAnonymous`/`allowAnonymousEdits`/`allowProviderAutoRegister` to false and leave non-email provider credentials unset (providers are enabled by credential presence, see `isXxxEnable` in `lib/config/index.js`). Full first-run runbook: `docs/institute-runbook.md`.
