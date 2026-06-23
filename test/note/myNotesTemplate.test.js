'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const noteCtl = require('../../lib/note/index')

function getMyNoteList (userId) {
  return new Promise((resolve, reject) => noteCtl.getMyNoteListForTest(userId, (e, l) => e ? reject(e) : resolve(l)))
}

describe('getMyNoteList includes template flag', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('returns the template flag per note', async function () {
    await models.Note.create({ ownerId: u1, title: 'T', content: '# T', template: true })
    const list = await getMyNoteList(u1)
    assert.strictEqual(list[0].template, true)
  })
})
