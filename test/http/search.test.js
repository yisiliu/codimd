'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: dashboard + browse search', function () {
  this.timeout(15000)
  let models, buildApp, browse, u1, u2

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    browse = require('../../lib/browse/index')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  it('anonymous /api/notes/search is 401', async function () {
    assert.strictEqual((await request(buildApp(null)).get('/api/notes/search?q=x')).status, 401)
  })

  it('my-notes search matches title, body content and tags — but not another user\'s note', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const byTitle = await models.Note.create({ ownerId: u1, title: 'Quantum lecture', content: '# Quantum lecture\n\nintro' })
    const byBody = await models.Note.create({ ownerId: u1, title: 'Notes', content: '# Notes\n\ndiscusses entanglement deeply' })
    const byTag = await models.Note.create({ ownerId: u1, title: 'Plain', content: '# Plain\n\nnothing' })
    await models.NoteTag.create({ noteId: byTag.id, tag: 'exam' })
    // another user's note that also contains the term must never appear
    await models.Note.create({ ownerId: u2, title: 'Quantum secrets', content: '# Quantum secrets' })

    const title = await request(app).get('/api/notes/search?q=quantum')
    assert.strictEqual(title.status, 200)
    assert.deepStrictEqual(title.body.ids, [models.Note.encodeNoteId(byTitle.id)])

    const body = await request(app).get('/api/notes/search?q=entanglement')
    assert.deepStrictEqual(body.body.ids, [models.Note.encodeNoteId(byBody.id)])

    const tag = await request(app).get('/api/notes/search?q=exam')
    assert.deepStrictEqual(tag.body.ids, [models.Note.encodeNoteId(byTag.id)])
  })

  it('empty query returns no ids', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    await models.Note.create({ ownerId: u1, title: 'x', content: '# x' })
    const res = await request(app).get('/api/notes/search?q=')
    assert.deepStrictEqual(res.body.ids, [])
  })

  it('browse search matches title / space name / owner and respects membership + privacy', async function () {
    // u1 is a member of space "Optics"; u2 owns notes filed into it
    const space = await browse.createSpace(u1, 'Optics')
    const shared = await models.Note.create({ ownerId: u2, title: 'Lens design', content: '# Lens design' })
    const priv = await models.Note.create({ ownerId: u2, title: 'Lens secret', content: '# Lens secret', permission: 'private' })
    await models.NoteSpace.create({ noteId: shared.id, spaceId: space.id })
    await models.NoteSpace.create({ noteId: priv.id, spaceId: space.id })
    const app = buildApp({ id: u1, role: 'user', active: true })

    // title match — private note excluded even though it also matches
    const byTitle = await request(app).get('/api/browse/search?q=lens')
    assert.strictEqual(byTitle.status, 200)
    assert.deepStrictEqual(byTitle.body.ids, [models.Note.encodeNoteId(shared.id)])

    // space-name match returns the note filed in that space
    const bySpace = await request(app).get('/api/browse/search?q=optics')
    assert.deepStrictEqual(bySpace.body.ids, [models.Note.encodeNoteId(shared.id)])
  })

  it('browse search returns nothing for a non-member', async function () {
    const space = await browse.createSpace(u1, 'Closed')
    const note = await models.Note.create({ ownerId: u1, title: 'Members only', content: '# Members only' })
    await models.NoteSpace.create({ noteId: note.id, spaceId: space.id })
    const res = await request(buildApp({ id: u2, role: 'user', active: true })).get('/api/browse/search?q=members')
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(res.body.ids, [])
  })
})
