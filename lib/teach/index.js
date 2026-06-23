'use strict'
const models = require('../models')
const config = require('../config')
const { viewableWhere, ownedNote } = require('../browse')

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

async function setTemplate (userId, noteId, template) {
  const note = await ownedNote(userId, noteId)
  note.template = !!template
  await note.save({ fields: ['template'] })
  return note
}

async function listTemplates (userId) {
  const notes = await models.Note.findAll({ where: { template: true, ...viewableWhere(userId) }, order: [['title', 'ASC']] })
  return Promise.all(notes.map(async note => {
    const owner = await models.User.findByPk(note.ownerId)
    const profile = owner ? models.User.getProfile(owner) : null
    return {
      id: models.Note.encodeNoteId(note.id),
      text: note.title || models.Note.parseNoteTitle(note.content),
      owner: (profile && profile.name) || 'Unknown'
    }
  }))
}

Object.assign(module.exports, { setTemplate, listTemplates })

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
router.post('/api/notes/:id/clone', requireAuth, handle(async req => {
  const copy = await cloneNote(req.user.id, await models.Note.parseNoteIdAsync(req.params.id))
  return { id: models.Note.encodeNoteId(copy.id) }
}))
router.put('/api/notes/:id/template', requireAuth, jsonParser, handle(async req => {
  await setTemplate(req.user.id, await models.Note.parseNoteIdAsync(req.params.id), req.body.template)
}))
router.get('/api/templates', requireAuth, handle(async req => ({ templates: await listTemplates(req.user.id) })))

module.exports.router = router
