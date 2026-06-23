'use strict'
const models = require('../models')
const config = require('../config')

async function cloneNote (userId, sourceId) {
  const source = await models.Note.findByPk(sourceId)
  if (!source) throw new Error('note-not-found')
  const viewable = source.permission !== 'private' || String(source.ownerId) === String(userId)
  if (!viewable) throw new Error('forbidden')
  const content = source.content
  if (content && content.length > config.documentMaxLength) throw new Error('content too long')
  return models.Note.create({
    ownerId: userId,
    content: content,
    title: models.Note.parseNoteTitle(content)
  })
}

module.exports = { cloneNote }
