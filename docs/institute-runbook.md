# Institute first-run runbook

How to stand up a **closed (invite-only) CodiMD instance** for an institute: install,
bootstrap the first teacher, lock the instance down, then run it invite-only with a
teacher admin panel.

The access model in one line: users have a **role** (`teacher` | `student`) and an
**active** flag; sign-up is **invite-only** via `/invite/<token>`; teachers manage
everything from the admin panel at `/admin`.

> [!WARNING]
> **Never lock the config before the first teacher exists — you will lock yourself
> out.** Once `allowEmailRegister: false` is set and providers are disabled, the only
> way to create or recover a teacher account is the CLI (`bin/manage_users`). Always
> follow the order below: install → create teacher → lock → restart.

---

## 1. Install & set up

Use the helper, or do it by hand:

```bash
./bin/setup
# equivalent to:
#   npm ci
#   cp config.json.example config.json
#   cp .sequelizerc.example .sequelizerc
```

Edit `config.json` for your database and `serverURL`, then start the server.
`npm start` runs the migrations (`sequelize db:migrate`) and then boots the app:

```bash
npm start          # runs migrations, then node app.js
```

At this point the instance is still on the **default config**, so the email login
provider is enabled and you can create the first account from the CLI.

## 2. Create the FIRST teacher (on the still-default config)

Do this **before** locking anything. `bin/manage_users` talks to the database
directly and is the only account-creation path that survives a locked instance.

```bash
# create a brand-new teacher account
bin/manage_users --add --role teacher you@institute.edu --pass 'choose-a-strong-password'

# omit --pass to be prompted (input is hidden):
bin/manage_users --add --role teacher you@institute.edu

# OR promote an existing account to teacher:
bin/manage_users --promote existing-user@institute.edu
```

`--role` accepts `teacher` or `student` and defaults to `student` for `--add`.
`--promote` always promotes to `teacher`. Other useful actions: `--reset <email>`
(reset a password) and `--del <email>` (delete).

Verify you can sign in at `/login` with this teacher account before continuing.

## 3. Lock the instance

Edit `config.json` (the active `NODE_ENV` section) to close registration and
anonymous access. Every key below also has a `CMD_*` environment-variable
equivalent (see `lib/config/environment.js`) — env vars override `config.json`.

```jsonc
{
  "production": {
    // close all self-service registration and anonymous use
    "allowEmailRegister": false,        // no email sign-up; existing accounts still log in
    "allowAnonymous": false,            // no anonymous access at all
    "allowAnonymousEdits": false,       // (default is true) belt-and-suspenders with allowAnonymous
    "allowProviderAutoRegister": false  // SSO logins won't silently create accounts

    // KEEP email login on so your teacher account can still sign in:
    //   "email": true
  }
}
```

### Disable every non-email auth provider

Providers are **not** toggled by an `enable` flag — they are considered enabled
**only when their credentials are present** (see the derived `isXxxEnable` flags in
`lib/config/index.js`). To disable a provider, simply **leave its credentials unset**
(remove the block from `config.json`, or set the credential keys to empty/unset).
Defaults already ship these unset, so the main job is to make sure you did not enable
any of them:

| Provider   | What makes it "enabled" — leave these unset to disable |
|------------|--------------------------------------------------------|
| github     | `github.clientID` + `github.clientSecret`              |
| google     | `google.clientID` + `google.clientSecret`              |
| gitlab     | `gitlab.clientID` + `gitlab.clientSecret`              |
| facebook   | `facebook.clientID` + `facebook.clientSecret`          |
| twitter    | `twitter.consumerKey` + `twitter.consumerSecret`       |
| dropbox    | `dropbox.clientID` + `dropbox.clientSecret`            |
| mattermost | `mattermost.clientID` + `mattermost.clientSecret`      |
| bitbucket  | `bitbucket.clientID` + `bitbucket.clientSecret`        |
| ldap       | `ldap.url`                                             |
| saml       | `saml.idpSsoUrl`                                        |
| oauth2     | `oauth2.clientID` + `oauth2.clientSecret`              |
| openid     | `openID` (top-level boolean — set `false`)             |

Keep `email: true` so your existing teacher account can log in. Only
`allowEmailRegister` is turned off — that stops *new* email sign-ups while preserving
login for accounts you create via the panel or CLI.

> If you genuinely want SSO logins (e.g. institutional Google/SAML) but only for
> people you've pre-provisioned, keep the provider's credentials **and** keep
> `allowProviderAutoRegister: false`: known accounts log in, unknown ones are rejected
> instead of auto-created.

## 4. Restart and sign in

```bash
npm start
```

Sign in at `/login` as the teacher, then open the admin panel:

```
/admin
```

`/admin` is guarded by `requireTeacher` — only authenticated, active teachers can
reach it; everyone else gets a 403.

## 5. Create invites and onboard people

From `/admin`, create invites. Each invite carries:

- **role** — `teacher` or `student`; redeemers are created with exactly this role.
- **maxUses** — how many accounts it can create.
- **expiry** — `expiresInDays` (defaults to 7 days).

Patterns:

- **Class / cohort invite:** a **reusable** invite — set `maxUses` to the cohort size
  and an expiry that matches enrolment. Share the link `/invite/<token>` with the
  class. Redemption is transactional with an atomic compare-and-set on `usedCount`,
  so the invite can never be over-redeemed past `maxUses`.
- **Individual collaborator:** a **single-use** invite — set `maxUses: 1`. The link
  works exactly once.

People open `/invite/<token>`, set email + password, and get an account with the
invite's role. You can **revoke** an invite from the panel at any time.

## 6. Offboarding

Deactivate users from the admin panel:

- **Deactivate** flips `active = false`. It **keeps the user's notes** (nothing is
  deleted), immediately de-authorises their existing web sessions, and disconnects
  any live editor sockets they have open.
- **Reactivate** flips them back to `active = true`.
- The **last active teacher cannot be deactivated or demoted** — the panel enforces
  this atomically so you can't accidentally orphan the instance. To remove the last
  teacher, promote another teacher first.

---

## 7. Private diagram rendering (PlantUML)

CodiMD renders `mermaid` and `plantuml` code blocks as diagrams. They differ in
where the rendering happens — and that matters for a closed institute:

- **Mermaid** renders **entirely in the browser** (client-side). No diagram
  content ever leaves your network. Nothing to configure; it's themed to match
  the app in both light and night mode.
- **PlantUML** renders by sending the diagram source to a **PlantUML server** and
  embedding the returned image. Upstream defaults to the **public**
  `https://www.plantuml.com/plantuml` — meaning every PlantUML diagram's source
  would leave your network. **For a private institute, self-host it.**

Run your own PlantUML server (one small container):

```bash
docker compose -f docker-compose.plantuml.yml up -d
# verify it renders (should return an SVG):
#   curl -o /dev/null -w "%{http_code}\n" \
#     "http://localhost:8888/svg/SoWkIImgAStDuNBCoKnELT2rKt3AJx9Iy4ZDoSddSaZDIodDpG40"
```

Then point CodiMD at it — in `config.json` (under your `NODE_ENV` section) or via
env var — and restart:

```json
"plantuml": { "server": "http://localhost:8888" }
```
```bash
CMD_PLANTUML_SERVER=http://localhost:8888
```

Note the URL is **host:port with no path** for the self-hosted `jetty` image (it
serves at the root context; the `/plantuml` suffix is only the public
plantuml.com path). After this, no PlantUML content leaves your network and
diagrams work offline. To confirm, open a note with a `plantuml` block and check
the diagram image's `src` points at your own server, not plantuml.com.

---

## Quick reference

| What | Where |
|------|-------|
| Bootstrap first teacher | `bin/manage_users --add --role teacher <email>` |
| Promote existing account | `bin/manage_users --promote <email>` |
| Login | `/login` |
| Admin panel (teachers only) | `/admin` |
| Redeem an invite | `/invite/<token>` |
| Locked-config keys | `allowEmailRegister`, `allowAnonymous`, `allowAnonymousEdits`, `allowProviderAutoRegister` (+ `CMD_*` env equivalents) |
| Provider enable detection | `lib/config/index.js` (`isXxxEnable` derived from credentials) |
