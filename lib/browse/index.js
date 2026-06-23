'use strict'
const { Op } = require('sequelize')
const models = require('../models')

// A note is viewable by `userId` iff it is not private, or they own it.
// NULL-safe: legacy NULL-permission rows are viewable (matches newCheckViewPermission).
function viewableWhere (userId) {
  return { [Op.or]: [{ ownerId: userId }, { permission: null }, { permission: { [Op.ne]: 'private' } }] }
}

// non-private (shared-visible) predicate for counts
const nonPrivateWhere = { [Op.or]: [{ permission: null }, { permission: { [Op.ne]: 'private' } }] }

async function createSpace (userId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('space name required')
  const existing = await models.Space.findOne({ where: { nameLower: trimmed.toLowerCase() } })
  if (existing) throw new Error('a space with that name already exists')
  return models.Space.create({ name: trimmed, createdById: userId })
}

async function listSpaces () {
  const spaces = await models.Space.findAll({ order: [['name', 'ASC']] })
  return Promise.all(spaces.map(async space => {
    const links = await models.NoteSpace.findAll({ where: { spaceId: space.id } })
    const noteIds = links.map(l => l.noteId)
    const count = noteIds.length
      ? await models.Note.count({ where: { id: noteIds, ...nonPrivateWhere } })
      : 0
    return { id: space.id, name: space.name, createdById: space.createdById, count }
  }))
}

// creator OR owner
async function mutableSpace (user, spaceId) {
  const space = await models.Space.findByPk(spaceId)
  if (!space) throw new Error('space-not-found')
  const isCreator = String(space.createdById) === String(user.id)
  const isOwner = user.role === 'owner'
  if (!isCreator && !isOwner) throw new Error('forbidden')
  return space
}

async function renameSpace (user, spaceId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('space name required')
  const space = await mutableSpace(user, spaceId)
  const clash = await models.Space.findOne({ where: { nameLower: trimmed.toLowerCase() } })
  if (clash && String(clash.id) !== String(space.id)) throw new Error('a space with that name already exists')
  space.name = trimmed
  await space.save({ fields: ['name', 'nameLower'] })
  return space
}

async function deleteSpace (user, spaceId) {
  await mutableSpace(user, spaceId)
  await models.NoteSpace.destroy({ where: { spaceId } })
  await models.Space.destroy({ where: { id: spaceId } })
}

module.exports = { createSpace, listSpaces, renameSpace, deleteSpace, viewableWhere, nonPrivateWhere }

async function ownedNote (ownerId, noteId) {
  const note = await models.Note.findByPk(noteId)
  if (!note || String(note.ownerId) !== String(ownerId)) throw new Error('note-not-found')
  return note
}

async function setNoteSpaces (ownerId, noteId, spaceIds) {
  await ownedNote(ownerId, noteId)
  const ids = Array.isArray(spaceIds) ? spaceIds : []
  // keep only spaces that actually exist (no FKs to enforce this)
  const valid = ids.length
    ? (await models.Space.findAll({ where: { id: ids } })).map(s => String(s.id))
    : []
  await models.NoteSpace.destroy({ where: { noteId } })
  for (const spaceId of valid) {
    await models.NoteSpace.findOrCreate({ where: { noteId, spaceId }, defaults: { noteId, spaceId } })
  }
}

async function spacesForNote (noteId) {
  const links = await models.NoteSpace.findAll({ where: { noteId } })
  if (!links.length) return []
  const spaces = await models.Space.findAll({ where: { id: links.map(l => l.spaceId) } })
  return spaces.map(s => ({ id: s.id, name: s.name }))
}

// Browse: notes in `space` (or any space when omitted) that `userId` may view.
async function listBrowse (userId, { space } = {}) {
  const linkWhere = space ? { spaceId: space } : {}
  const links = await models.NoteSpace.findAll({ where: linkWhere })
  const noteIds = [...new Set(links.map(l => l.noteId))]
  if (!noteIds.length) return []
  const notes = await models.Note.findAll({ where: { id: noteIds, ...viewableWhere(userId) } })
  return Promise.all(notes.map(async note => {
    const owner = await models.User.findByPk(note.ownerId)
    const profile = owner ? models.User.getProfile(owner) : null
    return {
      id: models.Note.encodeNoteId(note.id),
      text: note.title,
      owner: (profile && profile.name) || 'Unknown',
      spaces: await spacesForNote(note.id),
      lastchangeAt: note.lastchangeAt,
      shortId: note.shortid
    }
  }))
}

Object.assign(module.exports, { setNoteSpaces, spacesForNote, listBrowse, ownedNote })

// --- HTTP router (owner/creator-guarded /api/* routes; mounted above the /:noteId catch-all) ---

const { Router } = require('express')
const bodyParser = require('body-parser')
const jsonParser = bodyParser.json()

function requireAuth (req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).send({ status: 'forbidden' })
  next()
}

function handle (fn) {
  return async function (req, res) {
    try {
      const result = await fn(req)
      res.send(Object.assign({ status: 'ok' }, result || {}))
    } catch (err) {
      const code = /not-found|forbidden/.test(err.message) ? 403 : 400
      res.status(code).send({ status: 'error', message: err.message })
    }
  }
}

const router = Router()
router.get('/api/spaces', requireAuth, handle(async req => ({ spaces: await listSpaces() })))
router.post('/api/spaces', requireAuth, jsonParser, handle(async req => ({ space: await createSpace(req.user.id, req.body.name) })))
router.put('/api/spaces/:id', requireAuth, jsonParser, handle(async req => ({ space: await renameSpace(req.user, req.params.id, req.body.name) })))
router.delete('/api/spaces/:id', requireAuth, handle(async req => { await deleteSpace(req.user, req.params.id) }))
router.put('/api/notes/:id/spaces', requireAuth, jsonParser, handle(async req => { await setNoteSpaces(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.spaceIds) }))
router.get('/api/browse', requireAuth, handle(async req => ({ notes: await listBrowse(req.user.id, { space: req.query.space }) })))

module.exports.router = router
