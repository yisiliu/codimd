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

// creator OR teacher
async function mutableSpace (user, spaceId) {
  const space = await models.Space.findByPk(spaceId)
  if (!space) throw new Error('space-not-found')
  const isCreator = String(space.createdById) === String(user.id)
  const isTeacher = user.role === 'teacher'
  if (!isCreator && !isTeacher) throw new Error('forbidden')
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
