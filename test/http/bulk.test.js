'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const request = require('supertest')
const { removeLibModuleCache } = require('../realtime/utils')

describe('HTTP: bulk note actions', function () {
  this.timeout(15000)
  let models, buildApp, dash, browse, u1, u2

  before(function () {
    removeLibModuleCache()
    models = require('../../lib/models')
    buildApp = require('../helpers/httpApp').buildApp
    dash = require('../../lib/dashboard/index')
    browse = require('../../lib/browse/index')
  })
  after(removeLibModuleCache)

  beforeEach(async function () {
    await models.sequelize.sync({ force: true })
    u1 = (await models.User.create({})).id
    u2 = (await models.User.create({})).id
  })

  async function makeNotes (ownerId, n) {
    const ids = []
    for (let i = 0; i < n; i++) {
      const note = await models.Note.create({ ownerId, title: `N${i}`, content: `# N${i}` })
      ids.push(models.Note.encodeNoteId(note.id))
    }
    return ids
  }

  it('anonymous bulk is 401', async function () {
    assert.strictEqual((await request(buildApp(null)).post('/api/notes/bulk').send({ ids: [], action: 'pin', value: true })).status, 401)
  })

  it('bulk move files every selected note into the folder', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const ids = await makeNotes(u1, 3)
    const folder = await dash.createFolder(u1, 'Coursework')
    const res = await request(app).post('/api/notes/bulk').send({ ids, action: 'folder', value: folder.id })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.affected, 3)
    const filed = await models.Note.count({ where: { ownerId: u1, folderId: folder.id } })
    assert.strictEqual(filed, 3)
  })

  it('bulk tag adds the tag to each note (normalized, delete-safe)', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const ids = await makeNotes(u1, 2)
    await request(app).post('/api/notes/bulk').send({ ids, action: 'tag', value: 'Week5' })
    const tags = await models.NoteTag.findAll()
    assert.strictEqual(tags.length, 2)
    assert.ok(tags.every(t => t.tag === 'week5')) // normalized lowercase
  })

  it('bulk pin sets pinned on all', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const ids = await makeNotes(u1, 2)
    await request(app).post('/api/notes/bulk').send({ ids, action: 'pin', value: true })
    assert.strictEqual(await models.Note.count({ where: { ownerId: u1, pinned: true } }), 2)
  })

  it('bulk space files notes into a space the owner is a member of', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const ids = await makeNotes(u1, 2)
    const space = await browse.createSpace(u1, 'Physics')
    const res = await request(app).post('/api/notes/bulk').send({ ids, action: 'space', value: space.id })
    assert.strictEqual(res.body.affected, 2)
    assert.strictEqual(await models.NoteSpace.count({ where: { spaceId: space.id } }), 2)
  })

  it('bulk delete removes the notes and their org rows (tags/spaces)', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const ids = await makeNotes(u1, 3)
    const space = await browse.createSpace(u1, 'S')
    await request(app).post('/api/notes/bulk').send({ ids, action: 'space', value: space.id })
    await request(app).post('/api/notes/bulk').send({ ids, action: 'tag', value: 'x' })
    const res = await request(app).post('/api/notes/bulk').send({ ids, action: 'delete' })
    assert.strictEqual(res.body.affected, 3)
    assert.strictEqual(await models.Note.count({ where: { ownerId: u1 } }), 0)
    assert.strictEqual(await models.NoteTag.count(), 0)
    assert.strictEqual(await models.NoteSpace.count(), 0)
  })

  it('never touches another user\'s notes (ownership-guarded)', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const mine = await makeNotes(u1, 1)
    const theirs = await makeNotes(u2, 2)
    const res = await request(app).post('/api/notes/bulk').send({ ids: mine.concat(theirs), action: 'delete' })
    assert.strictEqual(res.body.affected, 1) // only mine
    assert.strictEqual(await models.Note.count({ where: { ownerId: u2 } }), 2) // theirs intact
  })

  it('rejects an unknown action', async function () {
    const app = buildApp({ id: u1, role: 'user', active: true })
    const ids = await makeNotes(u1, 1)
    const res = await request(app).post('/api/notes/bulk').send({ ids, action: 'nuke' })
    assert.strictEqual(res.status, 400)
  })
})
