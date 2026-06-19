'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const dash = require('../../lib/dashboard/index')
const noteCtl = require('../../lib/note/index')

function getMyNoteList (userId) {
  return new Promise((resolve, reject) => {
    noteCtl.getMyNoteListForTest(userId, (err, list) => err ? reject(err) : resolve(list))
  })
}

describe('getMyNoteList with organization', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('returns owned notes with folderId, userTags, pinned; excludes others', async function () {
    const f = await dash.createFolder(u1, 'F')
    // Provide non-empty content: Note's beforeCreate hook overwrites `title` from
    // public/default.md only when content is empty. With content set, the seeded
    // title persists.
    const mine = await models.Note.create({ ownerId: u1, title: 'Mine', content: 'mine body', folderId: f.id, pinned: true })
    await dash.addTag(u1, mine.id, 'ml')
    await models.Note.create({ ownerId: u2, title: 'Theirs', content: 'theirs body' })

    const list = await getMyNoteList(u1)
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].text, 'Mine')
    assert.strictEqual(list[0].folderId, f.id)
    assert.strictEqual(list[0].pinned, true)
    assert.deepStrictEqual(list[0].userTags, ['ml'])
  })
})
