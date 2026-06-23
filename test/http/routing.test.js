'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

// End-to-end HTTP tests through the real lib/routes middleware chain. These cover
// the routing/guard behaviour that service-level unit tests structurally cannot —
// e.g. the Slice-1 bug where the admin router's guard leaked onto /me and every
// later route for non-teachers.
//
// Cache management: the harness loads the real lib/* tree (incl. lib/models) via
// lib/routes. Other suites (admin, realtime) evict the lib require-cache, which
// would otherwise leave the harness with a different, unsynced models instance
// than this test seeds. So we clear the cache once up front, require ONE fresh
// models instance that both this test and the harness (via lib/routes) share, and
// clear again afterwards so the mock-based realtime suite re-requires cleanly.
describe('HTTP routing & guards', function () {
  this.timeout(15000)
  let models, buildApp, student, other

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    student = await models.User.create({ email: 's@x.io', role: 'student' })
    other = await models.User.create({ email: 'o@x.io', role: 'student' })
  })

  it('a logged-in student can reach /me (admin guard must NOT leak onto later routes)', async function () {
    const res = await request(buildApp({ id: student.id, role: 'student', active: true })).get('/me')
    assert.notStrictEqual(res.status, 403, '/me must not be blocked by the admin router')
    assert.strictEqual(res.status, 200)
  })

  it('a logged-in student can reach /api/folders (route after the admin mount)', async function () {
    const res = await request(buildApp({ id: student.id, role: 'student', active: true })).get('/api/folders')
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

  it('owner guard: a student cannot tag another user\'s note (403)', async function () {
    const note = await models.Note.create({ ownerId: other.id })
    const encoded = models.Note.encodeNoteId(note.id)
    const res = await request(buildApp({ id: student.id, role: 'student', active: true }))
      .post(`/api/notes/${encoded}/tags`).send({ tag: 'sneaky' })
    assert.strictEqual(res.status, 403)
    assert.strictEqual(await models.NoteTag.count(), 0)
  })

  it('owner can tag their own note via the encoded id (200, server-side parse)', async function () {
    const note = await models.Note.create({ ownerId: student.id })
    const encoded = models.Note.encodeNoteId(note.id)
    const res = await request(buildApp({ id: student.id, role: 'student', active: true }))
      .post(`/api/notes/${encoded}/tags`).send({ tag: 'mine' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(await models.NoteTag.count({ where: { noteId: note.id } }), 1)
  })
})
