'use strict'
const models = require('../models')

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
