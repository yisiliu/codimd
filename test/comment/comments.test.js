'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const comment = require('../../lib/comment')

const U = id => ({ id, role: 'user' })
const OWNER = id => ({ id, role: 'owner' })

describe('comment services', function () {
  this.timeout(10000)
  let owner, other, ownerRole, note
  beforeEach(async function () {
    await resetDb()
    owner = (await models.User.create({})).id
    other = (await models.User.create({})).id
    ownerRole = (await models.User.create({ role: 'owner' })).id
    note = await models.Note.create({ ownerId: owner, content: '# Doc', permission: 'editable' })
  })

  it('a viewer can add + list; private note non-owner is refused', async function () {
    await comment.addComment(U(other), note.id, { line: 0, anchorText: '# Doc', content: 'nice' })
    const list = await comment.listComments(U(owner), note.id)
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].author.id, other)
    const priv = await models.Note.create({ ownerId: owner, content: '# p', permission: 'private' })
    await assert.rejects(() => comment.addComment(U(other), priv.id, { line: 0, content: 'x' }), /forbidden/)
    await assert.rejects(() => comment.listComments(U(other), priv.id), /forbidden/)
  })

  it('moderate: author/owner/institute-owner can resolve+delete; a bystander cannot', async function () {
    const c = await comment.addComment(U(other), note.id, { line: 1, content: 'q' })
    const bystander = (await models.User.create({})).id
    await assert.rejects(() => comment.setResolved(U(bystander), c.id, true), /forbidden/)
    await comment.setResolved(U(other), c.id, true) // author
    assert.strictEqual((await models.Comment.findByPk(c.id)).resolved, true)
    await comment.deleteComment(U(owner), c.id) // note owner
    assert.strictEqual(await models.Comment.count(), 0)
    const c2 = await comment.addComment(U(other), note.id, { line: 2, content: 'q2' })
    await comment.deleteComment(OWNER(ownerRole), c2.id) // institute owner
    assert.strictEqual(await models.Comment.count(), 0)
  })

  it('rejects empty + oversized content', async function () {
    await assert.rejects(() => comment.addComment(U(owner), note.id, { line: 0, content: '   ' }), /required/)
    await assert.rejects(() => comment.addComment(U(owner), note.id, { line: 0, content: 'x'.repeat(2001) }), /too long/)
  })
})
