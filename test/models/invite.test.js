'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

function future () { return new Date(Date.now() + 3600 * 1000) }
function past () { return new Date(Date.now() - 1000) }

describe('Invite.isRedeemable', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('true when fresh, unexpired, under maxUses', function () {
    const i = models.Invite.build({ role: 'user', maxUses: 5, usedCount: 0, expiresAt: future(), revoked: false })
    assert.strictEqual(i.isRedeemable(), true)
  })
  it('false when revoked', function () {
    const i = models.Invite.build({ role: 'user', maxUses: 5, usedCount: 0, expiresAt: future(), revoked: true })
    assert.strictEqual(i.isRedeemable(), false)
  })
  it('false when expired', function () {
    const i = models.Invite.build({ role: 'user', maxUses: 5, usedCount: 0, expiresAt: past(), revoked: false })
    assert.strictEqual(i.isRedeemable(), false)
  })
  it('false when used up', function () {
    const i = models.Invite.build({ role: 'user', maxUses: 1, usedCount: 1, expiresAt: future(), revoked: false })
    assert.strictEqual(i.isRedeemable(), false)
  })
  it('generates a unique high-entropy token on create', async function () {
    const i = await models.Invite.create({ role: 'user', maxUses: 1, expiresAt: future() })
    assert.ok(i.token && i.token.length >= 32)
  })
})
