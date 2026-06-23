'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const teach = require('../../lib/teach/index')

describe('template services', function () {
  this.timeout(10000)
  let u1, u2
  beforeEach(async function () {
    await resetDb()
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('owner toggles the template flag; cross-owner refused', async function () {
    const n = await models.Note.create({ ownerId: u1, content: '# T', title: 'T' })
    await teach.setTemplate(u1, n.id, true)
    assert.strictEqual((await models.Note.findByPk(n.id)).template, true)
    await assert.rejects(() => teach.setTemplate(u2, n.id, false), /note-not-found/i)
  })

  it('lists viewable template notes; hides another owner\'s private template', async function () {
    const pub = await models.Note.create({ ownerId: u2, content: '# Pub', title: 'Pub', permission: 'editable', template: true })
    const priv = await models.Note.create({ ownerId: u2, content: '# Priv', title: 'Priv', permission: 'private', template: true })
    const mine = await models.Note.create({ ownerId: u1, content: '# Mine', title: 'Mine', permission: 'private', template: true })
    await models.Note.create({ ownerId: u2, content: '# NotTpl', title: 'NotTpl', permission: 'editable' }) // template:false

    const list = await teach.listTemplates(u1)
    const titles = list.map(t => t.text).sort()
    assert.deepStrictEqual(titles, ['Mine', 'Pub']) // Priv (other's private) excluded; NotTpl not a template
    assert.ok(list.every(t => typeof t.owner === 'string'))
  })
})
