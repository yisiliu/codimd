'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const { redeemInvite } = require('../../lib/invite/index')

function future () { return new Date(Date.now() + 3600 * 1000) }

describe('redeemInvite', function () {
  this.timeout(10000)
  beforeEach(resetDb)

  it('creates a user with the invite role and increments usedCount', async function () {
    const inv = await models.Invite.create({ role: 'admin', maxUses: 5, expiresAt: future() })
    const user = await redeemInvite(inv.token, { email: 'New@x.io', password: 'secret12' })
    assert.strictEqual(user.role, 'admin')
    assert.strictEqual(user.email, 'new@x.io')
    const reloaded = await models.Invite.findByPk(inv.id)
    assert.strictEqual(reloaded.usedCount, 1)
  })

  it('ignores a role supplied in the form body (no self-promotion)', async function () {
    const inv = await models.Invite.create({ role: 'user', maxUses: 1, expiresAt: future() })
    const user = await redeemInvite(inv.token, { email: 'h@x.io', password: 'secret12', role: 'admin' })
    assert.strictEqual(user.role, 'user')
  })

  it('does not consume a use when the email already exists', async function () {
    await models.User.create({ email: 'taken@x.io', password: 'secret12' })
    const inv = await models.Invite.create({ role: 'user', maxUses: 1, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'taken@x.io', password: 'secret12' }))
    const reloaded = await models.Invite.findByPk(inv.id)
    assert.strictEqual(reloaded.usedCount, 0)
  })

  it('refuses to over-redeem a fully-used invite (guard)', async function () {
    const inv = await models.Invite.create({ role: 'user', maxUses: 1, usedCount: 1, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'late@x.io', password: 'secret12' }))
    assert.strictEqual(await models.User.count({ where: { email: 'late@x.io' } }), 0)
  })

  it('rejects an expired or revoked invite', async function () {
    const inv = await models.Invite.create({ role: 'user', maxUses: 1, revoked: true, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'no@x.io', password: 'secret12' }))
  })

  it('drives the increment guard: a maxUses=2 link redeems exactly twice', async function () {
    const inv = await models.Invite.create({ role: 'user', maxUses: 2, expiresAt: future() })
    await redeemInvite(inv.token, { email: 'a1@x.io', password: 'secret12' })
    await redeemInvite(inv.token, { email: 'a2@x.io', password: 'secret12' })
    assert.strictEqual((await models.Invite.findByPk(inv.id)).usedCount, 2)
    await assert.rejects(() => redeemInvite(inv.token, { email: 'a3@x.io', password: 'secret12' }))
    assert.strictEqual(await models.User.count({ where: { email: 'a3@x.io' } }), 0)
  })

  it('rejects a mixed-case duplicate email (case-insensitive uniqueness)', async function () {
    await models.User.create({ email: 'mix@x.io', password: 'secret12' })
    const inv = await models.Invite.create({ role: 'user', maxUses: 1, expiresAt: future() })
    await assert.rejects(() => redeemInvite(inv.token, { email: 'MIX@x.io', password: 'secret12' }))
    assert.strictEqual((await models.Invite.findByPk(inv.id)).usedCount, 0)
  })
})
