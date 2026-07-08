'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: comments', function () {
  this.timeout(15000)
  let models, buildApp, comment, owner, other

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    comment = require('../../lib/comment')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    owner = (await models.User.create({})).id
    other = (await models.User.create({})).id
  })
  const as = id => buildApp({ id, role: 'user', active: true })
  const enc = id => models.Note.encodeNoteId(id)

  it('401 anon; add+list works for a viewer', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    assert.strictEqual((await request(buildApp(null)).get(`/api/notes/${enc(n.id)}/comments`)).status, 401)
    assert.strictEqual((await request(as(other)).post(`/api/notes/${enc(n.id)}/comments`).send({ line: 0, content: 'hi' })).status, 200)
    const res = await request(as(owner)).get(`/api/notes/${enc(n.id)}/comments`)
    assert.strictEqual(res.body.comments.length, 1)
  })

  it('403 on a private note you do not own', async function () {
    const p = await models.Note.create({ ownerId: owner, content: '# p', permission: 'private' })
    assert.strictEqual((await request(as(other)).post(`/api/notes/${enc(p.id)}/comments`).send({ line: 0, content: 'x' })).status, 403)
  })

  it('a bystander cannot delete; the author can', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    const c = await comment.addComment({ id: other, role: 'user' }, n.id, { line: 0, content: 'q' })
    const bystander = (await models.User.create({})).id
    assert.strictEqual((await request(as(bystander)).delete(`/api/comments/${c.id}`)).status, 403)
    assert.strictEqual((await request(as(other)).delete(`/api/comments/${c.id}`)).status, 200)
  })
})
