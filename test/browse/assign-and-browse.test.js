'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const browse = require('../../lib/browse/index')

describe('note↔space assignment + browse', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('owner sets their note\'s spaces; bogus ids ignored; empty clears', async function () {
    const s1 = await browse.createSpace(u1, 'A')
    const s2 = await browse.createSpace(u1, 'B')
    const n = await models.Note.create({ ownerId: u1, content: 'x' })
    await browse.setNoteSpaces(u1, n.id, [s1.id, s2.id, 'bogus-id'])
    assert.strictEqual(await models.NoteSpace.count({ where: { noteId: n.id } }), 2)
    await browse.setNoteSpaces(u1, n.id, [])
    assert.strictEqual(await models.NoteSpace.count({ where: { noteId: n.id } }), 0)
  })

  it('refuses to set spaces on a note I do not own', async function () {
    const s = await browse.createSpace(u2, 'C')
    const n = await models.Note.create({ ownerId: u2, content: 'y' })
    await assert.rejects(() => browse.setNoteSpaces(u1, n.id, [s.id]), /note-not-found/i)
  })

  it('browse lists viewable categorized notes; hides others\' private; shows my own private', async function () {
    const s = await browse.createSpace(u1, 'S')
    const mine = await models.Note.create({ ownerId: u1, title: 'Mine', content: '# Mine', permission: 'editable' })
    const otherPub = await models.Note.create({ ownerId: u2, title: 'Pub', content: '# Pub', permission: 'editable' })
    const otherPriv = await models.Note.create({ ownerId: u2, title: 'Secret', content: '# Secret', permission: 'private' })
    const myPriv = await models.Note.create({ ownerId: u1, title: 'MyPriv', content: '# MyPriv', permission: 'private' })
    for (const note of [mine, otherPub, otherPriv, myPriv]) await models.NoteSpace.create({ noteId: note.id, spaceId: s.id })

    const list = await browse.listBrowse({ id: u1, role: 'user' }, { space: s.id })
    const titles = list.map(r => r.text).sort()
    assert.deepStrictEqual(titles, ['Mine', 'MyPriv', 'Pub']) // Secret (other's private) excluded
    assert.ok(list.every(r => typeof r.owner === 'string'))
  })
})
