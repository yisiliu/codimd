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

module.exports = { listFolders, createFolder, renameFolder, deleteFolder }
