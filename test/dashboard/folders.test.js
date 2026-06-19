'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const dash = require('../../lib/dashboard/index')

describe('folder services', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('creates, lists, renames folders for the owner', async function () {
    const f = await dash.createFolder(u1, 'Thesis')
    await dash.renameFolder(u1, f.id, 'Dissertation')
    const list = await dash.listFolders(u1)
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].name, 'Dissertation')
  })

  it('rejects blank folder names', async function () {
    await assert.rejects(() => dash.createFolder(u1, '   '), /name/i)
  })

  it('refuses to rename/delete a folder owned by someone else', async function () {
    const f = await dash.createFolder(u1, 'Mine')
    await assert.rejects(() => dash.renameFolder(u2, f.id, 'Hacked'), /not-found|forbidden/i)
    await assert.rejects(() => dash.deleteFolder(u2, f.id), /not-found|forbidden/i)
  })

  it('orphans member notes to Unfiled on folder delete (notes survive)', async function () {
    const f = await dash.createFolder(u1, 'Course')
    const n = await models.Note.create({ ownerId: u1, folderId: f.id })
    await dash.deleteFolder(u1, f.id)
    const reloaded = await models.Note.findByPk(n.id)
    assert.ok(reloaded, 'note still exists')
    assert.strictEqual(reloaded.folderId, null)
    assert.strictEqual(await models.Folder.count(), 0)
  })
})
