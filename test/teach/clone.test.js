'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const teach = require('../../lib/teach/index')

describe('cloneNote', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('clones a viewable note into a new note I own, with a derived title', async function () {
    const src = await models.Note.create({ ownerId: u2, content: '# Handout\n\nbody', permission: 'editable' })
    const copy = await teach.cloneNote(u1, src.id)
    assert.strictEqual(copy.ownerId, u1)
    assert.strictEqual(copy.content, '# Handout\n\nbody')
    assert.strictEqual(copy.title, 'Handout') // derived, not blank
    assert.notStrictEqual(copy.id, src.id)
  })

  it('refuses to clone another owner\'s private note', async function () {
    const src = await models.Note.create({ ownerId: u2, content: '# secret', permission: 'private' })
    await assert.rejects(() => teach.cloneNote(u1, src.id), /forbidden|not-found/i)
  })

  it('clones my own private note', async function () {
    const src = await models.Note.create({ ownerId: u1, content: '# mine', permission: 'private' })
    const copy = await teach.cloneNote(u1, src.id)
    assert.strictEqual(copy.ownerId, u1)
  })
})
