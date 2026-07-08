'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Comment model', function () {
  this.timeout(10000)
  let u, n
  beforeEach(async function () {
    await resetDb()
    u = (await models.User.create({})).id
    n = (await models.Note.create({ ownerId: u, content: '# x' })).id
  })
  it('persists a comment; resolved defaults false', async function () {
    const c = await models.Comment.create({ noteId: n, authorId: u, line: 3, anchorText: '# x', content: 'fix this' })
    assert.strictEqual(c.resolved, false)
    assert.strictEqual((await models.Comment.findByPk(c.id)).content, 'fix this')
  })
})
