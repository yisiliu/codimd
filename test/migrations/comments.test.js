'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { removeLibModuleCache } = require('../realtime/utils')

describe('migration: add comments', function () {
  this.timeout(10000)
  let models, migration, parentMigration
  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    migration = require('../../lib/migrations/20260630000001-add-comments')
    parentMigration = require('../../lib/migrations/20260714000001-add-comment-parent')
  })
  after(removeLibModuleCache)
  beforeEach(async function () { await models.sequelize.sync({ force: true }) })

  it('creates the table + index; a comment (and a reply) round-trips', async function () {
    const qi = models.sequelize.getQueryInterface()
    const u = (await models.User.create({})).id
    const n = (await models.Note.create({ ownerId: u, content: '# x' })).id
    await qi.dropTable('Comments')
    await migration.up(qi, models.Sequelize)
    await parentMigration.up(qi, models.Sequelize) // adds parentId
    const parent = await models.Comment.create({ noteId: n, authorId: u, line: 1, content: 'hi' })
    await models.Comment.create({ noteId: n, authorId: u, parentId: parent.id, line: 1, content: 'reply' })
    assert.strictEqual(await models.Comment.count(), 2)
    assert.strictEqual(await models.Comment.count({ where: { parentId: parent.id } }), 1)
  })
})
