'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('User model: role/active/email', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('defaults new users to active user', async function () {
    const u = await models.User.create({ email: 'a@x.io', password: 'secret12' })
    assert.strictEqual(u.role, 'user')
    assert.strictEqual(u.active, true)
  })

  it('lowercases email on write', async function () {
    const u = await models.User.create({ email: 'MixedCase@X.io', password: 'secret12' })
    assert.strictEqual(u.email, 'mixedcase@x.io')
  })

  it('rejects a second user with the same (case-insensitive) email', async function () {
    await models.User.create({ email: 'dup@x.io', password: 'secret12' })
    await assert.rejects(() => models.User.create({ email: 'DUP@x.io', password: 'secret12' }))
  })

  it('rejects an invalid role', async function () {
    await assert.rejects(() => models.User.create({ email: 'r@x.io', password: 'secret12', role: 'teacher' }))
  })
})
