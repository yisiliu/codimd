'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('NoteTag model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('normalizes tags to trimmed lowercase', async function () {
    const t = await models.NoteTag.create({ noteId: 'n1', tag: '  Machine Learning  ' })
    assert.strictEqual(t.tag, 'machine learning')
  })

  it('rejects a duplicate (noteId, tag)', async function () {
    await models.NoteTag.create({ noteId: 'n1', tag: 'ml' })
    await assert.rejects(() => models.NoteTag.create({ noteId: 'n1', tag: 'ML' }))
  })

  it('allows the same tag on different notes', async function () {
    await models.NoteTag.create({ noteId: 'n1', tag: 'ml' })
    const t = await models.NoteTag.create({ noteId: 'n2', tag: 'ml' })
    assert.ok(t.id)
  })
})
