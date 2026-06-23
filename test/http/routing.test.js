'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

// End-to-end HTTP tests through the real lib/routes middleware chain. These cover
// the routing/guard behaviour that service-level unit tests structurally cannot —
// e.g. the Slice-1 bug where the admin router's guard leaked onto /me and every
// later route for non-admins.
//
// Cache management: the harness loads the real lib/* tree (incl. lib/models) via
// lib/routes. Other suites (admin, realtime) evict the lib require-cache, which
// would otherwise leave the harness with a different, unsynced models instance
// than this test seeds. So we clear the cache once up front, require ONE fresh
// models instance that both this test and the harness (via lib/routes) share, and
// clear again afterwards so the mock-based realtime suite re-requires cleanly.
describe('HTTP routing & guards', function () {
  this.timeout(15000)
  let models, buildApp, user, other, admin, owner

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    user = await models.User.create({ email: 's@x.io', role: 'user' })
    other = await models.User.create({ email: 'o@x.io', role: 'user' })
    admin = await models.User.create({ email: 'a@x.io', role: 'admin' })
    owner = await models.User.create({ email: 'ow@x.io', role: 'owner' })
  })

  it('a logged-in user can reach /me (admin guard must NOT leak onto later routes)', async function () {
    const res = await request(buildApp({ id: user.id, role: 'user', active: true })).get('/me')
    assert.notStrictEqual(res.status, 403, '/me must not be blocked by the admin router')
    assert.strictEqual(res.status, 200)
  })

  it('a logged-in user can reach /api/folders (route after the admin mount)', async function () {
    const res = await request(buildApp({ id: user.id, role: 'user', active: true })).get('/api/folders')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.status, 'ok')
  })

  it('anonymous /api/folders is 401', async function () {
    const res = await request(buildApp(null)).get('/api/folders')
    assert.strictEqual(res.status, 401)
  })

  it('anonymous /me is 401', async function () {
    const res = await request(buildApp(null)).get('/me')
    assert.strictEqual(res.status, 401)
  })

  it('owner guard: a user cannot tag another user\'s note (403)', async function () {
    const note = await models.Note.create({ ownerId: other.id })
    const encoded = models.Note.encodeNoteId(note.id)
    const res = await request(buildApp({ id: user.id, role: 'user', active: true }))
      .post(`/api/notes/${encoded}/tags`).send({ tag: 'sneaky' })
    assert.strictEqual(res.status, 403)
    assert.strictEqual(await models.NoteTag.count(), 0)
  })

  it('owner can tag their own note via the encoded id (200, server-side parse)', async function () {
    const note = await models.Note.create({ ownerId: user.id })
    const encoded = models.Note.encodeNoteId(note.id)
    const res = await request(buildApp({ id: user.id, role: 'user', active: true }))
      .post(`/api/notes/${encoded}/tags`).send({ tag: 'mine' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(await models.NoteTag.count({ where: { noteId: note.id } }), 1)
  })

  // RBAC: POST /admin/users/:id/role is owner-only (global requireAdmin admits
  // admin+owner; requireOwner on this route blocks admins). requireOwner runs
  // BEFORE csurf, so the admin-forbidden case needs no token. The owner-success
  // case must clear csurf: GET a csurf route on the same agent to seed the _csrf
  // secret cookie + obtain a token, then POST it. handle() always redirects (302).
  function csrfToken (html) {
    const m = /name="_csrf"\s+value="([^"]+)"/.exec(html)
    assert.ok(m, 'csrf token present in the GET response')
    return m[1]
  }

  it('POST /admin/users/:id/role: an admin is forbidden (not owner)', async function () {
    // Give the admin a VALID csrf token (admin passes requireAdmin, so GET /admin
    // renders 200 + a token). Without a valid token, csurf would block too —
    // masking whether requireOwner did anything. With it, the ONLY thing standing
    // between the admin and a 302 success is requireOwner: if requireOwner were
    // removed, setRole would run and the role would flip to 'admin'.
    const agent = request.agent(buildApp({ id: admin.id, role: 'admin', active: true }))
    const get = await agent.get('/admin')
    assert.strictEqual(get.status, 200)
    const token = csrfToken(get.text)
    const res = await agent.post(`/admin/users/${user.id}/role`).type('form').send({ role: 'admin', _csrf: token })
    // 500 here = the harness can't render error.ejs's editor chrome; requireOwner
    // set 403 first (production returns 403). What we assert is that setRole never
    // ran: status is not the success redirect and the role is unchanged.
    assert.notStrictEqual(res.status, 302)
    assert.strictEqual((await models.User.findByPk(user.id)).role, 'user')
  })

  it('POST /admin/users/:id/role: an owner succeeds (302 redirect, role changed)', async function () {
    const agent = request.agent(buildApp({ id: owner.id, role: 'owner', active: true }))
    const get = await agent.get('/admin')
    assert.strictEqual(get.status, 200)
    const token = csrfToken(get.text)
    const res = await agent.post(`/admin/users/${user.id}/role`).type('form').send({ role: 'admin', _csrf: token })
    assert.strictEqual(res.status, 302)
    assert.strictEqual((await models.User.findByPk(user.id)).role, 'admin')
  })
})
