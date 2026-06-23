'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Space model', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('stores display name and derives nameLower', async function () {
    const s = await models.Space.create({ name: '  ML-Course  ', createdById: 'u1' })
    assert.strictEqual(s.name, 'ML-Course')
    assert.strictEqual(s.nameLower, 'ml-course')
  })

  it('rejects a case-insensitive duplicate name', async function () {
    await models.Space.create({ name: 'ML-Course', createdById: 'u1' })
    await assert.rejects(() => models.Space.create({ name: 'ml-course', createdById: 'u2' }))
  })
})
