'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('NoteSpace model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('rejects a duplicate (noteId, spaceId)', async function () {
    await models.NoteSpace.create({ noteId: 'n1', spaceId: 's1' })
    await assert.rejects(() => models.NoteSpace.create({ noteId: 'n1', spaceId: 's1' }))
  })

  it('allows the same note in different spaces', async function () {
    await models.NoteSpace.create({ noteId: 'n1', spaceId: 's1' })
    const ns = await models.NoteSpace.create({ noteId: 'n1', spaceId: 's2' })
    assert.ok(ns.id)
  })
})
