'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const migration = require('../../lib/migrations/20260624000001-roles-user-admin-owner')

describe('migration: roles user/admin/owner', function () {
  this.timeout(10000)
  const qi = models.sequelize.getQueryInterface()
  beforeEach(resetDb)

  it('maps teacher→admin/owner and student→user; exactly one owner on a createdAt tie', async function () {
    const ts = new Date('2020-01-01T00:00:00Z')
    // two teachers with IDENTICAL createdAt (the tie case) + a student.
    // NO `fields` array — passing `fields` would exclude `id` and suppress its
    // UUIDV4 default (id→NULL → rawSelect returns null → 0 owners). `validate:false`
    // lets us seed the old vocab; `createdAt` persists without `fields`.
    await models.User.bulkCreate([
      { email: 't1@x.io', role: 'teacher', active: true, createdAt: ts, updatedAt: ts },
      { email: 't2@x.io', role: 'teacher', active: true, createdAt: ts, updatedAt: ts },
      { email: 's1@x.io', role: 'student', active: true }
    ], { validate: false })

    await migration.up(qi)

    const all = await models.User.findAll()
    const byRole = r => all.filter(u => u.role === r).length
    assert.strictEqual(byRole('owner'), 1, 'exactly one owner')
    assert.strictEqual(byRole('admin'), 1, 'the other teacher → admin')
    assert.strictEqual(byRole('user'), 1, 'student → user')
    assert.strictEqual(byRole('teacher') + byRole('student'), 0, 'old vocab gone')
  })

  it('no active teacher → no owner', async function () {
    await models.User.bulkCreate([{ email: 's@x.io', role: 'student', active: true }], { validate: false })
    await migration.up(qi)
    assert.strictEqual((await models.User.findAll({ where: { role: 'owner' } })).length, 0)
  })
})
