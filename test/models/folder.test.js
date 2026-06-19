'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Folder model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('creates a folder for an owner', async function () {
    const f = await models.Folder.create({ ownerId: 'u1', name: 'Thesis' })
    assert.strictEqual(f.name, 'Thesis')
    assert.strictEqual(f.ownerId, 'u1')
  })

  it('rejects two folders with the same name for the same owner', async function () {
    await models.Folder.create({ ownerId: 'u1', name: 'Course' })
    await assert.rejects(() => models.Folder.create({ ownerId: 'u1', name: 'Course' }))
  })

  it('allows the same folder name for different owners', async function () {
    await models.Folder.create({ ownerId: 'u1', name: 'Course' })
    const f = await models.Folder.create({ ownerId: 'u2', name: 'Course' })
    assert.ok(f.id)
  })
})
