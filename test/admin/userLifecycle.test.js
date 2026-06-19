'use strict'
/* eslint-env node, mocha */
const assert = require('assert')

const { models, resetDb } = require('../helpers/db')
const admin = require('../../lib/admin/index')
const realtime = require('../../lib/realtime/realtime')
const { removeLibModuleCache } = require('../realtime/utils')

async function mkTeacher (email) { return models.User.create({ email, password: 'secret12', role: 'teacher' }) }

describe('admin user lifecycle', function () {
  this.timeout(10000)
  beforeEach(resetDb)
  afterEach(function () { realtime.io = null })
  // Requiring the real realtime singleton above pollutes the require cache for the
  // realtime suite (which re-requires realtime with mocked deps). Evict the lib
  // module cache we populated so those tests start fresh. Other test files captured
  // their references at load time, before this hook runs, so they are unaffected.
  after(removeLibModuleCache)

  it('refuses to deactivate the last active teacher', async function () {
    const t = await mkTeacher('only@x.io')
    await assert.rejects(() => admin.deactivateUser(t.id), /last.teacher/i)
    assert.strictEqual((await models.User.findByPk(t.id)).active, true)
  })

  it('disconnects the deactivated user\'s live sockets', async function () {
    const t1 = await mkTeacher('w1@x.io')
    await mkTeacher('w2@x.io')
    // Inject a fake io with a socket for t1 and assert the REAL disconnectUser drops it.
    const dropped = []
    realtime.io = { sockets: { sockets: { s1: { request: { user: { id: t1.id } }, disconnect () { dropped.push('s1') } } } } }
    await admin.deactivateUser(t1.id)
    assert.deepStrictEqual(dropped, ['s1'])
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
