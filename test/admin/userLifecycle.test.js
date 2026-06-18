'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

// Stub disconnectUser BEFORE requiring admin, so we can assert the deactivation
// wiring calls it with the right user id (the helper itself is tested in Task 10).
const disconnected = []
mock('../../lib/realtime/disconnectUser', (realtime, id) => disconnected.push(id))

const { models, resetDb } = require('../helpers/db')
const admin = require('../../lib/admin/index')

async function mkTeacher (email) { return models.User.create({ email, password: 'secret12', role: 'teacher' }) }

describe('admin user lifecycle', function () {
  this.timeout(10000)
  beforeEach(async function () {
    disconnected.length = 0
    await resetDb()
  })
  after(() => mock.stopAll())

  it('refuses to deactivate the last active teacher', async function () {
    const t = await mkTeacher('only@x.io')
    await assert.rejects(() => admin.deactivateUser(t.id), /last.teacher/i)
    assert.strictEqual((await models.User.findByPk(t.id)).active, true)
  })

  it('disconnects the deactivated user\'s live sockets', async function () {
    const t1 = await mkTeacher('w1@x.io')
    await mkTeacher('w2@x.io')
    await admin.deactivateUser(t1.id)
    assert.ok(disconnected.includes(t1.id))
  })

  it('allows deactivating a teacher when another active teacher exists', async function () {
    const t1 = await mkTeacher('t1@x.io')
    await mkTeacher('t2@x.io')
    await admin.deactivateUser(t1.id)
    assert.strictEqual((await models.User.findByPk(t1.id)).active, false)
  })

  it('refuses to demote the last active teacher', async function () {
    const t = await mkTeacher('solo@x.io')
    await assert.rejects(() => admin.setRole(t.id, 'student'), /last.teacher/i)
  })

  it('promotes a student to teacher', async function () {
    const s = await models.User.create({ email: 's@x.io', password: 'secret12', role: 'student' })
    await admin.setRole(s.id, 'teacher')
    assert.strictEqual((await models.User.findByPk(s.id)).role, 'teacher')
  })
})
