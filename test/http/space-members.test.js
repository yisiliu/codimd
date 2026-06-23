'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: space members', function () {
  this.timeout(15000)
  let models, buildApp, browse, steward, m2, outsider

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    browse = require('../../lib/browse')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    steward = (await models.User.create({})).id
    m2 = (await models.User.create({})).id
    outsider = (await models.User.create({})).id
  })

  const as = id => buildApp({ id, role: 'user', active: true })

  it('401 anon on members list', async function () {
    const s = await browse.createSpace(steward, 'X')
    assert.strictEqual((await request(buildApp(null)).get(`/api/spaces/${s.id}/members`)).status, 401)
  })

  it('any member invites; plain member cannot remove another (403)', async function () {
    const s = await browse.createSpace(steward, 'X')
    await browse.addMember({ id: steward, role: 'user' }, s.id, m2)
    // m2 invites outsider — 200
    assert.strictEqual((await request(as(m2)).post(`/api/spaces/${s.id}/members`).send({ userId: outsider })).status, 200)
    // m2 removes outsider — 403
    assert.strictEqual((await request(as(m2)).delete(`/api/spaces/${s.id}/members/${outsider}`)).status, 403)
    // steward removes outsider — 200
    assert.strictEqual((await request(as(steward)).delete(`/api/spaces/${s.id}/members/${outsider}`)).status, 200)
  })

  it('steward cannot leave (403); transfer then leave works', async function () {
    const s = await browse.createSpace(steward, 'X')
    await browse.addMember({ id: steward, role: 'user' }, s.id, m2)
    assert.strictEqual((await request(as(steward)).delete(`/api/spaces/${s.id}/members/${steward}`)).status, 403)
    assert.strictEqual((await request(as(steward)).put(`/api/spaces/${s.id}/steward`).send({ userId: m2 })).status, 200)
    assert.strictEqual((await request(as(steward)).delete(`/api/spaces/${s.id}/members/${steward}`)).status, 200)
  })

  it('GET /api/users lists active users', async function () {
    const res = await request(as(steward)).get('/api/users')
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.users.length >= 3)
  })
})
