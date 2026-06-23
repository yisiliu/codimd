'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')

describe('Note.template column', function () {
  this.timeout(10000)
  let u1
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
  })

  it('defaults to false and can be set', async function () {
    const n = await models.Note.create({ ownerId: u1, content: 'x' })
    assert.strictEqual(n.template, false)
    n.template = true
    await n.save()
    assert.strictEqual((await models.Note.findByPk(n.id)).template, true)
  })
})
