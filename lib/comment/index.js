'use strict'
const models = require('../models')
const { newCheckViewPermission } = require('../response')

function isOwnerRole (user) { return !!user && user.role === 'owner' }
function canView (user, note) { return newCheckViewPermission(note, true, user.id) }
function canModerate (user, note, c) {
  return String(c.authorId) === String(user.id) ||
    String(note.ownerId) === String(user.id) ||
    isOwnerRole(user)
}

async function loadNote (noteId) {
  const note = await models.Note.findByPk(noteId)
  if (!note) throw new Error('note-not-found')
  return note
}
async function loadComment (commentId) {
  const c = await models.Comment.findByPk(commentId)
  if (!c) throw new Error('comment-not-found')
  return c
}
async function authorOf (authorId) {
  const u = await models.User.findByPk(authorId)
  const p = u ? models.User.getProfile(u) : null
  return { id: authorId, name: (p && p.name) || (u && u.email) || 'Unknown' }
}

async function listComments (user, noteId) {
  const note = await loadNote(noteId)
  if (!canView(user, note)) throw new Error('forbidden')
  const comments = await models.Comment.findAll({ where: { noteId }, order: [['line', 'ASC'], ['createdAt', 'ASC']] })
  return Promise.all(comments.map(async c => ({
    id: c.id,
    line: c.line,
    anchorText: c.anchorText,
    content: c.content,
    resolved: c.resolved,
    createdAt: c.createdAt,
    author: await authorOf(c.authorId),
    mine: String(c.authorId) === String(user.id)
  })))
}

async function addComment (user, noteId, { line, anchorText, content }) {
  const note = await loadNote(noteId)
  if (!canView(user, note)) throw new Error('forbidden')
  const text = (content || '').trim()
  if (!text) throw new Error('comment content required')
  if (text.length > 2000) throw new Error('comment too long')
  const ln = parseInt(line, 10)
  if (!(ln >= 0)) throw new Error('invalid line')
  return models.Comment.create({ noteId, authorId: user.id, line: ln, anchorText: (anchorText || '').slice(0, 1000), content: text })
}

async function setResolved (user, commentId, resolved) {
  const c = await loadComment(commentId)
  const note = await loadNote(c.noteId)
  if (!canModerate(user, note, c)) throw new Error('forbidden')
  c.resolved = !!resolved
  await c.save({ fields: ['resolved'] })
  return c
}

async function deleteComment (user, commentId) {
  const c = await loadComment(commentId)
  const note = await loadNote(c.noteId)
  if (!canModerate(user, note, c)) throw new Error('forbidden')
  await c.destroy()
}

module.exports = { listComments, addComment, setResolved, deleteComment, canView, canModerate }

// --- HTTP router (/api/* only; mounted above /:noteId) ---
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
router.get('/api/notes/:id/comments', requireAuth, handle(async req => ({ comments: await listComments(req.user, await models.Note.parseNoteIdAsync(req.params.id)) })))
router.post('/api/notes/:id/comments', requireAuth, jsonParser, handle(async req => ({ comment: { id: (await addComment(req.user, await models.Note.parseNoteIdAsync(req.params.id), req.body)).id } })))
router.put('/api/comments/:cid', requireAuth, jsonParser, handle(async req => { await setResolved(req.user, req.params.cid, req.body.resolved) }))
router.delete('/api/comments/:cid', requireAuth, handle(async req => { await deleteComment(req.user, req.params.cid) }))

module.exports.router = router
