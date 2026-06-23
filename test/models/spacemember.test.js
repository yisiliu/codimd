'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('SpaceMember model', function () {
  this.timeout(10000)
  let u, s
  beforeEach(async function () {
    await resetDb()
    u = (await models.User.create({})).id
    s = (await models.Space.create({ name: 'S', createdById: u })).id
  })
  it('persists a membership and enforces uniqueness', async function () {
    await models.SpaceMember.create({ spaceId: s, userId: u })
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: s, userId: u } }), 1)
    await assert.rejects(() => models.SpaceMember.create({ spaceId: s, userId: u }))
  })
})
