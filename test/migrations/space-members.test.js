'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { removeLibModuleCache } = require('../realtime/utils')

describe('migration: add space members', function () {
  this.timeout(10000)
  let models, migration
  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    migration = require('../../lib/migrations/20260624000002-add-space-members')
  })
  after(removeLibModuleCache)
  beforeEach(async function () { await models.sequelize.sync({ force: true }) })

  it('creates the table and backfills one member (the steward) per space', async function () {
    const qi = models.sequelize.getQueryInterface()
    const u1 = (await models.User.create({})).id
    const u2 = (await models.User.create({})).id
    await models.Space.create({ name: 'A', createdById: u1 })
    await models.Space.create({ name: 'B', createdById: u2 })
    await qi.dropTable('SpaceMembers') // remove the model-synced table so up() recreates it
    await migration.up(qi, models.Sequelize) // models.Sequelize is the constructor (lib/models/index.js)
    const all = await models.SpaceMember.findAll()
    assert.strictEqual(all.length, 2)
    const a = await models.Space.findOne({ where: { name: 'A' } })
    assert.strictEqual((await models.SpaceMember.findAll({ where: { spaceId: a.id } }))[0].userId, u1)
  })
})
