'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const noteCtl = require('../../lib/note/index')

describe('note delete cleans up NoteSpace links', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('removes a note\'s space links on cleanup', async function () {
    const n = await models.Note.create({ ownerId: u1, content: 'x' })
    await models.NoteSpace.create({ noteId: n.id, spaceId: 's1' })
    await noteCtl.cleanupNoteOrganization(n.id)
    assert.strictEqual(await models.NoteSpace.count({ where: { noteId: n.id } }), 0)
  })
})
