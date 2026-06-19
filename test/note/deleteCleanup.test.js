'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const noteCtl = require('../../lib/note/index')

describe('note delete cleans up NoteTags', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('removes a note\'s tags when the note is deleted', async function () {
    const n = await models.Note.create({ ownerId: u1 })
    await models.NoteTag.create({ noteId: n.id, tag: 'ml' })
    await noteCtl.cleanupNoteOrganization(n.id)
    assert.strictEqual(await models.NoteTag.count({ where: { noteId: n.id } }), 0)
  })
})
