'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { buildApp } = require('../helpers/httpApp')
const { models, resetDb } = require('../helpers/db')

// End-to-end HTTP tests through the real lib/routes middleware chain. These cover
// the routing/guard behaviour that service-level unit tests structurally cannot —
// e.g. the Slice-1 bug where the admin router's guard leaked onto /me and every
// later route for non-teachers.
describe('HTTP routing & guards', function () {
  this.timeout(15000)
  let student, other

  beforeEach(async function () {
    await resetDb()
    student = await models.User.create({ email: 's@x.io', role: 'student' })
    other = await models.User.create({ email: 'o@x.io', role: 'student' })
  })

  it('a logged-in student can reach /me (admin guard must NOT leak onto later routes)', async function () {
    const app = buildApp({ id: student.id, role: 'student', active: true })
    const res = await request(app).get('/me')
    assert.notStrictEqual(res.status, 403, '/me must not be blocked by the admin router')
    assert.strictEqual(res.status, 200)
  })

  it('a logged-in student can reach /api/folders (route after the admin mount)', async function () {
    const app = buildApp({ id: student.id, role: 'student', active: true })
    const res = await request(app).get('/api/folders')
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
    const app = buildApp({ id: student.id, role: 'student', active: true })
    const res = await request(app)
      .post(`/api/notes/${encoded}/tags`)
      .send({ tag: 'sneaky' })
    assert.strictEqual(res.status, 403)
    assert.strictEqual(await models.NoteTag.count(), 0)
  })

  it('owner can tag their own note via the encoded id (200, server-side parse)', async function () {
    const note = await models.Note.create({ ownerId: student.id })
    const encoded = models.Note.encodeNoteId(note.id)
    const app = buildApp({ id: student.id, role: 'student', active: true })
    const res = await request(app)
      .post(`/api/notes/${encoded}/tags`)
      .send({ tag: 'mine' })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(await models.NoteTag.count({ where: { noteId: note.id } }), 1)
  })
})
