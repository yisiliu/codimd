'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const dash = require('../../lib/dashboard/index')

describe('note organize services', function () {
  this.timeout(10000)
  let u1, u2
  async function myNote (ownerId) { return models.Note.create({ ownerId }) }
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('files a note into my folder and can unfile it', async function () {
    const f = await dash.createFolder(u1, 'F')
    const n = await myNote(u1)
    await dash.setFolder(u1, n.id, f.id)
    assert.strictEqual((await models.Note.findByPk(n.id)).folderId, f.id)
    await dash.setFolder(u1, n.id, null)
    assert.strictEqual((await models.Note.findByPk(n.id)).folderId, null)
  })

  it('refuses to file my note into someone else\'s folder', async function () {
    const other = await dash.createFolder(u2, 'Other')
    const n = await myNote(u1)
    await assert.rejects(() => dash.setFolder(u1, n.id, other.id), /folder-not-found/i)
  })

  it('refuses to organize a note I do not own', async function () {
    const n = await myNote(u2)
    await assert.rejects(() => dash.setPin(u1, n.id, true), /note-not-found/i)
    await assert.rejects(() => dash.addTag(u1, n.id, 'x'), /note-not-found/i)
  })

  it('adds and removes user-tags (dedup, normalized)', async function () {
    const n = await myNote(u1)
    await dash.addTag(u1, n.id, 'Machine Learning')
    await dash.addTag(u1, n.id, 'machine learning') // dedup, no-op
    let tags = await dash.tagsFor(n.id)
    assert.deepStrictEqual(tags, ['machine learning'])
    await dash.removeTag(u1, n.id, 'machine learning')
    tags = await dash.tagsFor(n.id)
    assert.deepStrictEqual(tags, [])
  })

  it('sets the pin flag', async function () {
    const n = await myNote(u1)
    await dash.setPin(u1, n.id, true)
    assert.strictEqual((await models.Note.findByPk(n.id)).pinned, true)
  })
})
