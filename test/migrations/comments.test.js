'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { removeLibModuleCache } = require('../realtime/utils')

describe('migration: add comments', function () {
  this.timeout(10000)
  let models, migration
  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    migration = require('../../lib/migrations/20260630000001-add-comments')
  })
  after(removeLibModuleCache)
  beforeEach(async function () { await models.sequelize.sync({ force: true }) })

  it('creates the table + index; a comment round-trips', async function () {
    const qi = models.sequelize.getQueryInterface()
    const u = (await models.User.create({})).id
    const n = (await models.Note.create({ ownerId: u, content: '# x' })).id
    await qi.dropTable('Comments')
    await migration.up(qi, models.Sequelize)
    await models.Comment.create({ noteId: n, authorId: u, line: 1, content: 'hi' })
    assert.strictEqual(await models.Comment.count(), 1)
  })
})
