'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Note organization columns', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('defaults to unfiled + unpinned', async function () {
    const n = await models.Note.create({ ownerId: u1 })
    assert.strictEqual(n.folderId, null)
    assert.strictEqual(n.pinned, false)
  })

  it('stores folderId and pinned', async function () {
    const f = await models.Folder.create({ ownerId: u1, name: 'F' })
    const n = await models.Note.create({ ownerId: u1, folderId: f.id, pinned: true })
    assert.strictEqual(n.folderId, f.id)
    assert.strictEqual(n.pinned, true)
  })
})
