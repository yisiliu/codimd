'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const browse = require('../../lib/browse/index')

describe('space services', function () {
  this.timeout(10000)
  let u1, u2, owner
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
    owner = (await models.User.create({ role: 'owner' })).id
  })

  it('any member creates a space; dedup is case-insensitive', async function () {
    const s = await browse.createSpace(u1, 'ML-Course')
    assert.strictEqual(s.name, 'ML-Course')
    await assert.rejects(() => browse.createSpace(u2, 'ml-course'), /exists/i)
  })

  it('lists spaces with a non-private note count', async function () {
    const s = await browse.createSpace(u1, 'S')
    const pub = await models.Note.create({ ownerId: u1, content: 'x', permission: 'editable' })
    const priv = await models.Note.create({ ownerId: u1, content: 'y', permission: 'private' })
    await models.NoteSpace.create({ noteId: pub.id, spaceId: s.id })
    await models.NoteSpace.create({ noteId: priv.id, spaceId: s.id })
    const list = await browse.listSpaces()
    const row = list.find(x => x.id === s.id)
    assert.strictEqual(row.count, 1) // private excluded from the count
  })

  it('rename/delete allowed for the creator', async function () {
    const s = await browse.createSpace(u1, 'Old')
    await browse.renameSpace({ id: u1, role: 'user' }, s.id, 'New')
    assert.strictEqual((await models.Space.findByPk(s.id)).name, 'New')
    await browse.deleteSpace({ id: u1, role: 'user' }, s.id)
    assert.strictEqual(await models.Space.count(), 0)
  })

  it('rename/delete allowed for an owner, refused for an unrelated member', async function () {
    const s = await browse.createSpace(u1, 'Shared')
    await assert.rejects(() => browse.deleteSpace({ id: u2, role: 'user' }, s.id), /forbidden/i)
    await browse.renameSpace({ id: owner, role: 'owner' }, s.id, 'Renamed')
    assert.strictEqual((await models.Space.findByPk(s.id)).name, 'Renamed')
  })

  it('delete removes the space\'s NoteSpace links (notes survive)', async function () {
    const s = await browse.createSpace(u1, 'X')
    const n = await models.Note.create({ ownerId: u1, content: 'z' })
    await models.NoteSpace.create({ noteId: n.id, spaceId: s.id })
    await browse.deleteSpace({ id: u1, role: 'user' }, s.id)
    assert.strictEqual(await models.NoteSpace.count(), 0)
    assert.ok(await models.Note.findByPk(n.id))
  })
})
