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

  it('a reply nests under its parent and inherits the parent line/anchor', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    const parent = await comment.addComment({ id: owner, role: 'user' }, n.id, { line: 5, anchorText: 'the line', content: 'clarify?' })
    const res = await request(as(other)).post(`/api/notes/${enc(n.id)}/comments`).send({ parentId: parent.id, content: 'fixed' })
    assert.strictEqual(res.status, 200)
    const list = (await request(as(owner)).get(`/api/notes/${enc(n.id)}/comments`)).body.comments
    assert.strictEqual(list.length, 2)
    const reply = list.find(c => c.parentId)
    assert.strictEqual(String(reply.parentId), String(parent.id))
    assert.strictEqual(reply.line, 5) // inherited
    assert.strictEqual(reply.content, 'fixed')
  })

  it('a reply cannot be nested under another reply (one level only)', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    const parent = await comment.addComment({ id: owner, role: 'user' }, n.id, { line: 0, content: 'a' })
    const reply = await comment.addComment({ id: other, role: 'user' }, n.id, { parentId: parent.id, content: 'b' })
    const res = await request(as(owner)).post(`/api/notes/${enc(n.id)}/comments`).send({ parentId: reply.id, content: 'c' })
    assert.strictEqual(res.status, 400)
  })

  it('deleting a top-level comment also deletes its replies', async function () {
    const n = await models.Note.create({ ownerId: owner, content: '# d', permission: 'editable' })
    const parent = await comment.addComment({ id: owner, role: 'user' }, n.id, { line: 0, content: 'a' })
    await comment.addComment({ id: other, role: 'user' }, n.id, { parentId: parent.id, content: 'b' })
    await comment.addComment({ id: owner, role: 'user' }, n.id, { parentId: parent.id, content: 'c' })
    assert.strictEqual(await models.Comment.count({ where: { noteId: n.id } }), 3)
    await request(as(owner)).delete(`/api/comments/${parent.id}`)
    assert.strictEqual(await models.Comment.count({ where: { noteId: n.id } }), 0)
  })
})
