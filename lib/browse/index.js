'use strict'
const { Op } = require('sequelize')
const models = require('../models')
const { getHistory } = require('../history')

// A note is viewable by `userId` iff it is not private, or they own it.
// NULL-safe: legacy NULL-permission rows are viewable (matches newCheckViewPermission).
function viewableWhere (userId) {
  return { [Op.or]: [{ ownerId: userId }, { permission: null }, { permission: { [Op.ne]: 'private' } }] }
}

// non-private (shared-visible) predicate for counts
const nonPrivateWhere = { [Op.or]: [{ permission: null }, { permission: { [Op.ne]: 'private' } }] }

function isOwnerRole (user) { return !!user && user.role === 'owner' }

async function isMember (userId, spaceId) {
  return !!(await models.SpaceMember.findOne({ where: { spaceId, userId } }))
}

async function memberSpaceIds (userId) {
  const ms = await models.SpaceMember.findAll({ where: { userId } })
  return ms.map(m => String(m.spaceId))
}

async function loadSpace (spaceId) {
  const space = await models.Space.findByPk(spaceId)
  if (!space) throw new Error('space-not-found')
  return space
}

async function assertMemberOrOwner (user, spaceId) {
  await loadSpace(spaceId)
  if (isOwnerRole(user)) return
  if (!(await isMember(user.id, spaceId))) throw new Error('forbidden')
}

async function createSpace (userId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('space name required')
  const existing = await models.Space.findOne({ where: { nameLower: trimmed.toLowerCase() } })
  if (existing) throw new Error('a space with that name already exists')
  const space = await models.Space.create({ name: trimmed, createdById: userId })
  await models.SpaceMember.findOrCreate({ where: { spaceId: space.id, userId }, defaults: { spaceId: space.id, userId } })
  return space
}

async function listSpaces (user) {
  let where = {}
  if (!isOwnerRole(user)) {
    const ids = await memberSpaceIds(user.id)
    if (!ids.length) return []
    where = { id: ids }
  }
  const spaces = await models.Space.findAll({ where, order: [['name', 'ASC']] })
  return Promise.all(spaces.map(async space => {
    const links = await models.NoteSpace.findAll({ where: { spaceId: space.id } })
    const noteIds = links.map(l => l.noteId)
    const count = noteIds.length ? await models.Note.count({ where: { id: noteIds, ...nonPrivateWhere } }) : 0
    const memberCount = await models.SpaceMember.count({ where: { spaceId: space.id } })
    return { id: space.id, name: space.name, createdById: space.createdById, count, memberCount, isSteward: String(space.createdById) === String(user.id) }
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
  await models.SpaceMember.destroy({ where: { spaceId } })
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
  const mySpaces = await memberSpaceIds(ownerId)
  const mySet = new Set(mySpaces)
  const valid = ids.length
    ? (await models.Space.findAll({ where: { id: ids } })).map(s => String(s.id)).filter(id => mySet.has(id))
    : []
  // reconcile ONLY within the owner's member-spaces; legacy links to other spaces are left intact
  if (mySpaces.length) {
    await models.NoteSpace.destroy({ where: { noteId, spaceId: { [Op.in]: mySpaces } } })
  }
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
async function listBrowse (user, { space } = {}) {
  const userId = user.id
  let visibleIds = null // null = all (owner)
  if (!isOwnerRole(user)) {
    visibleIds = await memberSpaceIds(userId)
    if (!visibleIds.length) return []
  }
  const linkWhere = {}
  if (space) {
    if (visibleIds && !visibleIds.includes(String(space))) return []
    linkWhere.spaceId = space
  } else if (visibleIds) {
    linkWhere.spaceId = visibleIds
  }
  const links = await models.NoteSpace.findAll({ where: linkWhere })
  const noteIds = [...new Set(links.map(l => l.noteId))]
  if (!noteIds.length) return []
  const notes = await models.Note.findAll({ where: { id: noteIds, ...viewableWhere(userId) } })
  const history = await new Promise(resolve => getHistory(userId, (err, h) => resolve(err ? {} : (h || {}))))
  return Promise.all(notes.map(async note => {
    const owner = await models.User.findByPk(note.ownerId)
    const profile = owner ? models.User.getProfile(owner) : null
    const encodedId = models.Note.encodeNoteId(note.id)
    return {
      id: encodedId,
      text: note.title,
      owner: (profile && profile.name) || 'Unknown',
      spaces: await spacesForNote(note.id),
      createdAt: note.createdAt,
      lastchangeAt: note.lastchangeAt,
      lastReadAt: history[encodedId] ? history[encodedId].time : null,
      shortId: note.shortid
    }
  }))
}

// full-text search over the shared notes a user may browse: title, body content,
// owner name, and space name — respecting membership + view permission.
// returns encoded note ids for the client to intersect with its loaded list.
async function searchBrowse (user, q, space) {
  const term = (q || '').trim()
  if (!term) return []
  const userId = user.id
  let visibleIds = null
  if (!isOwnerRole(user)) {
    visibleIds = await memberSpaceIds(userId)
    if (!visibleIds.length) return []
  }
  const linkWhere = {}
  if (space) {
    if (visibleIds && !visibleIds.includes(String(space))) return []
    linkWhere.spaceId = space
  } else if (visibleIds) {
    linkWhere.spaceId = visibleIds
  }
  const links = await models.NoteSpace.findAll({ where: linkWhere })
  const noteIds = [...new Set(links.map(l => l.noteId))]
  if (!noteIds.length) return []
  const notes = await models.Note.findAll({ where: { id: noteIds, ...viewableWhere(userId) }, attributes: ['id', 'title', 'content', 'ownerId'] })
  const ql = term.toLowerCase()
  const matched = []
  for (const note of notes) {
    let hit = (note.title && note.title.toLowerCase().includes(ql)) || (note.content && note.content.toLowerCase().includes(ql))
    if (!hit) {
      const owner = await models.User.findByPk(note.ownerId)
      const profile = owner ? models.User.getProfile(owner) : null
      if (profile && profile.name && profile.name.toLowerCase().includes(ql)) hit = true
    }
    if (!hit) {
      const spaceList = await spacesForNote(note.id)
      if (spaceList.some(s => s.name && s.name.toLowerCase().includes(ql))) hit = true
    }
    if (hit) matched.push(models.Note.encodeNoteId(note.id))
  }
  return matched
}

async function listMembers (user, spaceId) {
  const space = await loadSpace(spaceId)
  await assertMemberOrOwner(user, spaceId)
  const ms = await models.SpaceMember.findAll({ where: { spaceId } })
  return Promise.all(ms.map(async m => {
    const u = await models.User.findByPk(m.userId)
    const profile = u ? models.User.getProfile(u) : null
    return { id: m.userId, name: (profile && profile.name) || (u && u.email) || 'Unknown', isSteward: String(space.createdById) === String(m.userId) }
  }))
}

async function addMember (user, spaceId, targetUserId) {
  await assertMemberOrOwner(user, spaceId)
  const target = await models.User.findByPk(targetUserId)
  if (!target) throw new Error('user-not-found')
  await models.SpaceMember.findOrCreate({ where: { spaceId, userId: targetUserId }, defaults: { spaceId, userId: targetUserId } })
}

async function removeMember (user, spaceId, targetUserId) {
  const space = await loadSpace(spaceId)
  const targetIsSteward = String(space.createdById) === String(targetUserId)
  if (String(targetUserId) === String(user.id)) {
    // leaving
    if (!(await isMember(user.id, spaceId))) throw new Error('forbidden')
    if (targetIsSteward) throw new Error('forbidden') // steward must transfer first
  } else {
    // removing another
    if (!(String(space.createdById) === String(user.id) || isOwnerRole(user))) throw new Error('forbidden')
    if (targetIsSteward) throw new Error('forbidden') // protects exactly-one-steward
  }
  const n = await models.SpaceMember.destroy({ where: { spaceId, userId: targetUserId } })
  if (n < 1) throw new Error('not-found')
}

async function transferSteward (user, spaceId, targetUserId) {
  const space = await loadSpace(spaceId)
  if (!(String(space.createdById) === String(user.id) || isOwnerRole(user))) throw new Error('forbidden')
  if (!(await isMember(targetUserId, spaceId))) throw new Error('forbidden') // target must already be a member
  space.createdById = targetUserId
  await space.save({ fields: ['createdById'] })
  return space
}

async function listUsers () {
  const users = await models.User.findAll({ where: { active: true }, order: [['createdAt', 'ASC']] })
  return users.map(u => ({ id: u.id, name: (models.User.getProfile(u) || {}).name || u.email || 'Unknown' }))
}

Object.assign(module.exports, { setNoteSpaces, spacesForNote, listBrowse, searchBrowse, ownedNote, listMembers, addMember, removeMember, transferSteward, listUsers })

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
router.get('/api/spaces', requireAuth, handle(async req => ({ spaces: await listSpaces(req.user) })))
router.post('/api/spaces', requireAuth, jsonParser, handle(async req => ({ space: await createSpace(req.user.id, req.body.name) })))
router.put('/api/spaces/:id', requireAuth, jsonParser, handle(async req => ({ space: await renameSpace(req.user, req.params.id, req.body.name) })))
router.delete('/api/spaces/:id', requireAuth, handle(async req => { await deleteSpace(req.user, req.params.id) }))
router.put('/api/notes/:id/spaces', requireAuth, jsonParser, handle(async req => { await setNoteSpaces(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.spaceIds) }))
router.get('/api/browse/search', requireAuth, handle(async req => ({ ids: await searchBrowse(req.user, req.query.q, req.query.space) })))
router.get('/api/browse', requireAuth, handle(async req => ({ notes: await listBrowse(req.user, { space: req.query.space }) })))
router.get('/api/users', requireAuth, handle(async req => ({ users: await listUsers() })))
router.get('/api/spaces/:id/members', requireAuth, handle(async req => ({ members: await listMembers(req.user, req.params.id) })))
router.post('/api/spaces/:id/members', requireAuth, jsonParser, handle(async req => { await addMember(req.user, req.params.id, req.body.userId) }))
router.delete('/api/spaces/:id/members/:userId', requireAuth, handle(async req => { await removeMember(req.user, req.params.id, req.params.userId) }))
router.put('/api/spaces/:id/steward', requireAuth, jsonParser, handle(async req => ({ space: await transferSteward(req.user, req.params.id, req.body.userId) })))

module.exports.router = router
