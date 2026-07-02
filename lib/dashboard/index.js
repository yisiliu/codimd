'use strict'
const models = require('../models')
const { Op } = require('sequelize')
const { Router } = require('express')
const bodyParser = require('body-parser')
const jsonParser = bodyParser.json()
const browse = require('../browse')

// --- folder services (owner-guarded) ---

async function listFolders (ownerId) {
  return models.Folder.findAll({ where: { ownerId }, order: [['name', 'ASC']] })
}

async function createFolder (ownerId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('folder name required')
  return models.Folder.create({ ownerId, name: trimmed })
}

async function ownedFolder (ownerId, folderId) {
  const folder = await models.Folder.findByPk(folderId)
  if (!folder || String(folder.ownerId) !== String(ownerId)) throw new Error('folder-not-found')
  return folder
}

async function renameFolder (ownerId, folderId, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('folder name required')
  const folder = await ownedFolder(ownerId, folderId)
  folder.name = trimmed
  await folder.save({ fields: ['name'] })
  return folder
}

async function deleteFolder (ownerId, folderId) {
  await ownedFolder(ownerId, folderId)
  // App-level orphan: this repo emits no DB foreign keys, so SET NULL must be explicit.
  await models.Note.update({ folderId: null }, { where: { folderId, ownerId } })
  await models.Folder.destroy({ where: { id: folderId, ownerId } })
}

// --- note organize services (owner-guarded) ---

async function ownedNote (ownerId, noteId) {
  const note = await models.Note.findByPk(noteId)
  if (!note || String(note.ownerId) !== String(ownerId)) throw new Error('note-not-found')
  return note
}

async function setFolder (ownerId, noteId, folderId) {
  const note = await ownedNote(ownerId, noteId)
  if (folderId !== null && folderId !== undefined) {
    await ownedFolder(ownerId, folderId) // throws folder-not-found if not mine
  }
  note.folderId = folderId || null
  await note.save({ fields: ['folderId'] })
  return note
}

async function setPin (ownerId, noteId, pinned) {
  const note = await ownedNote(ownerId, noteId)
  note.pinned = !!pinned
  await note.save({ fields: ['pinned'] })
  return note
}

async function addTag (ownerId, noteId, tag) {
  await ownedNote(ownerId, noteId)
  const normalized = (tag || '').trim().toLowerCase()
  if (!normalized) throw new Error('tag required')
  const [row] = await models.NoteTag.findOrCreate({ where: { noteId, tag: normalized }, defaults: { noteId, tag: normalized } })
  return row
}

async function removeTag (ownerId, noteId, tag) {
  await ownedNote(ownerId, noteId)
  await models.NoteTag.destroy({ where: { noteId, tag: (tag || '').trim().toLowerCase() } })
}

async function tagsFor (noteId) {
  const rows = await models.NoteTag.findAll({ where: { noteId }, order: [['tag', 'ASC']] })
  return rows.map(r => r.tag)
}

module.exports = { listFolders, createFolder, renameFolder, deleteFolder, setFolder, setPin, addTag, removeTag, tagsFor, ownedNote, ownedFolder }

// --- HTTP router (owner-guarded /api/* routes; mounted above the /:noteId catch-all) ---

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
      const code = /not-found/.test(err.message) ? 403 : 400
      res.status(code).send({ status: 'error', message: err.message })
    }
  }
}

// full-text search across the user's own notes: title, body content, and user-tags.
// returns encoded note ids; the client intersects them with its loaded list.
async function searchMyNotes (userId, q) {
  const term = (q || '').trim()
  if (!term) return []
  const like = `%${term}%`
  const textRows = await models.Note.findAll({
    where: { ownerId: userId, [Op.or]: [{ title: { [Op.like]: like } }, { content: { [Op.like]: like } }] },
    attributes: ['id']
  })
  const ids = new Set(textRows.map(r => r.id))
  const userNoteIds = (await models.Note.findAll({ where: { ownerId: userId }, attributes: ['id'] })).map(n => n.id)
  if (userNoteIds.length) {
    const tagRows = await models.NoteTag.findAll({ where: { noteId: { [Op.in]: userNoteIds }, tag: { [Op.like]: like } }, attributes: ['noteId'] })
    tagRows.forEach(t => ids.add(t.noteId))
  }
  return Array.from(ids).map(id => models.Note.encodeNoteId(id))
}

// apply one action to many of the user's own notes at once. Each id is parsed +
// ownership-checked; notes that aren't the caller's are silently skipped (never
// mutated). Returns how many were actually affected.
const BULK_ACTIONS = new Set(['folder', 'pin', 'tag', 'space', 'delete'])
async function bulkAction (ownerId, ids, action, value) {
  if (!BULK_ACTIONS.has(action)) throw new Error('bad-action')
  const encoded = Array.isArray(ids) ? ids : []
  let affected = 0
  for (const enc of encoded) {
    let rawId
    try { rawId = await models.Note.parseNoteIdAsync(enc) } catch (e) { continue }
    if (!rawId) continue
    const note = await models.Note.findByPk(rawId)
    if (!note || String(note.ownerId) !== String(ownerId)) continue // ownership gate
    try {
      if (action === 'folder') {
        await setFolder(ownerId, rawId, value || null)
      } else if (action === 'pin') {
        await setPin(ownerId, rawId, !!value)
      } else if (action === 'tag') {
        if (value) await addTag(ownerId, rawId, value)
      } else if (action === 'space') {
        if (value) await browse.addNoteToSpace(ownerId, rawId, value)
      } else if (action === 'delete') {
        await models.Note.destroy({ where: { id: rawId, ownerId } })
        await models.NoteTag.destroy({ where: { noteId: rawId } })
        await models.NoteSpace.destroy({ where: { noteId: rawId } })
        await models.Comment.destroy({ where: { noteId: rawId } })
        try {
          const rt = require('../realtime/realtime')
          if (rt.isNoteExistsInPool(rawId)) rt.disconnectSocketOnNote(rt.getNoteFromNotePool(rawId))
        } catch (e) {}
      }
      affected++
    } catch (e) { /* skip this note, keep going */ }
  }
  return affected
}

const router = Router()
router.post('/api/notes/bulk', requireAuth, jsonParser, handle(async req => ({ affected: await bulkAction(req.user.id, req.body.ids, req.body.action, req.body.value) })))
router.get('/api/notes/search', requireAuth, handle(async req => ({ ids: await searchMyNotes(req.user.id, req.query.q) })))
router.get('/api/folders', requireAuth, handle(async req => ({ folders: await listFolders(req.user.id) })))
router.post('/api/folders', requireAuth, jsonParser, handle(async req => ({ folder: await createFolder(req.user.id, req.body.name) })))
router.put('/api/folders/:id', requireAuth, jsonParser, handle(async req => ({ folder: await renameFolder(req.user.id, req.params.id, req.body.name) })))
router.delete('/api/folders/:id', requireAuth, handle(async req => { await deleteFolder(req.user.id, req.params.id) }))
// The dashboard sends the base64url-ENCODED note id (as returned by /api/notes/myNotes).
// Parse it to the raw UUID here, server-side, via the canonical note-id chain — the
// client must not reimplement id decoding.
router.put('/api/notes/:id/folder', requireAuth, jsonParser, handle(async req => { await setFolder(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.folderId || null) }))
router.put('/api/notes/:id/pin', requireAuth, jsonParser, handle(async req => { await setPin(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.pinned) }))
router.post('/api/notes/:id/tags', requireAuth, jsonParser, handle(async req => { await addTag(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.tag) }))
router.delete('/api/notes/:id/tags/:tag', requireAuth, handle(async req => { await removeTag(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.params.tag) }))

module.exports.router = router
