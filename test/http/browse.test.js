'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: spaces & browse', function () {
  this.timeout(15000)
  let models, buildApp, browse, u1, u2

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    browse = require('../../lib/browse/index')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('anonymous /api/spaces is 401', async function () {
    assert.strictEqual((await request(buildApp(null)).get('/api/spaces')).status, 401)
  })

  it('a member can create + list spaces', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const created = await request(app).post('/api/spaces').send({ name: 'ML' })
    assert.strictEqual(created.status, 200)
    const list = await request(app).get('/api/spaces')
    assert.strictEqual(list.body.spaces.length, 1)
  })

  it('non-creator non-owner cannot delete a space (403)', async function () {
    const space = await browse.createSpace(u1, 'Owned')
    const res = await request(buildApp({ id: u2, role: 'user', active: true })).delete(`/api/spaces/${space.id}`)
    assert.strictEqual(res.status, 403)
  })

  it('owner cannot put spaces on another user\'s note (403)', async function () {
    const space = await browse.createSpace(u2, 'X')
    const note = await models.Note.create({ ownerId: u2, content: 'x' })
    const encoded = models.Note.encodeNoteId(note.id)
    const res = await request(buildApp({ id: u1, role: 'user', active: true }))
      .put(`/api/notes/${encoded}/spaces`).send({ spaceIds: [space.id] })
    assert.strictEqual(res.status, 403)
  })

  it('browse hides another owner\'s private note', async function () {
    const space = await browse.createSpace(u1, 'S')
    const priv = await models.Note.create({ ownerId: u2, content: '# secret', permission: 'private' })
    await models.NoteSpace.create({ noteId: priv.id, spaceId: space.id })
    const res = await request(buildApp({ id: u1, role: 'user', active: true })).get(`/api/browse?space=${space.id}`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.notes.length, 0)
  })
})
