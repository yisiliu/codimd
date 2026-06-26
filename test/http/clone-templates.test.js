'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: clone & templates', function () {
  this.timeout(15000)
  let models, buildApp, u1, u2

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  function enc (id) { return models.Note.encodeNoteId(id) }

  it('anon clone is 401', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# h', permission: 'editable' })
    assert.strictEqual((await request(buildApp(null)).post(`/api/notes/${enc(n.id)}/clone`)).status, 401)
  })

  it('clones a viewable note → 200 + new id', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# Handout', permission: 'editable' })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).post(`/api/notes/${enc(n.id)}/clone`)
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.id)
    assert.strictEqual(await models.Note.count({ where: { ownerId: u1 } }), 1)
  })

  it('refuses to clone another owner\'s private note → 403', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# s', permission: 'private' })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).post(`/api/notes/${enc(n.id)}/clone`)
    assert.strictEqual(res.status, 403)
  })

  it('template toggle is owner-only → 403 cross-owner', async function () {
    const n = await models.Note.create({ ownerId: u2, content: '# t' })
    const res = await request(buildApp({ id: u1, role: 'student', active: true }))
      .put(`/api/notes/${enc(n.id)}/template`).send({ template: true })
    assert.strictEqual(res.status, 403)
  })

  it('templates list hides another owner\'s private template', async function () {
    await models.Note.create({ ownerId: u2, content: '# p', title: 'P', permission: 'private', template: true })
    const res = await request(buildApp({ id: u1, role: 'student', active: true })).get('/api/templates')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.templates.length, 0)
  })
})
