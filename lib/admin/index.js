'use strict'
const { Router } = require('express')
const csurf = require('csurf')
const { Op } = require('sequelize')
const models = require('../models')
const logger = require('../logger')
const requireTeacher = require('../web/middleware/requireTeacher')
const disconnectUser = require('../realtime/disconnectUser')
const realtime = require('../realtime/realtime')
const { urlencodedParser } = require('../utils')

const csrfProtection = csurf({ cookie: true })

// --- service layer (unit-testable) ---

// SQLite doesn't support SELECT ... FOR UPDATE; skip the row lock there (its
// serialized writes already isolate transactions). On PG/MySQL the row lock is
// what makes the last-teacher guard atomic.
function rowLock (t) {
  return models.sequelize.getDialect() === 'sqlite' ? undefined : t.LOCK.UPDATE
}

// Atomic last-teacher guard. Lock the OTHER active teachers' rows inside the
// transaction so a concurrent deactivate/demote can't also observe "another teacher
// exists" and race us to zero. Plain Sequelize query (NO raw SQL literal) -> portable
// across PG/MySQL/SQLite. (A `"(SELECT COUNT(*) FROM \"Users\" ...)"` literal is an
// identifier on PG/SQLite but a string on MySQL — avoid it entirely.)
async function assertAnotherActiveTeacher (excludeId, t) {
  const others = await models.User.findAll({
    where: { role: 'teacher', active: true, id: { [Op.ne]: excludeId } },
    transaction: t,
    lock: rowLock(t)
  })
  if (others.length < 1) throw new Error('cannot remove last teacher')
}

async function deactivateUser (userId) {
  await models.sequelize.transaction(async function (t) {
    const target = await models.User.findByPk(userId, { transaction: t })
    if (!target) throw new Error('user-not-found')
    if (target.role === 'teacher' && target.active) {
      await assertAnotherActiveTeacher(userId, t)
    }
    target.active = false
    await target.save({ transaction: t, fields: ['active'] })
  })
  disconnectUser(realtime, userId)
}

async function activateUser (userId) {
  const [n] = await models.User.update({ active: true }, { where: { id: userId }, fields: ['active'] })
  if (n !== 1) throw new Error('user-not-found')
}

async function setRole (userId, role) {
  if (role !== 'teacher' && role !== 'student') throw new Error('invalid-role')
  await models.sequelize.transaction(async function (t) {
    const target = await models.User.findByPk(userId, { transaction: t })
    if (!target) throw new Error('user-not-found')
    if (role === 'student' && target.role === 'teacher' && target.active) {
      await assertAnotherActiveTeacher(userId, t)
    }
    target.role = role
    await target.save({ transaction: t, fields: ['role'] })
  })
  if (role === 'student') disconnectUser(realtime, userId)
}

async function resetPassword (userId, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('weak-password')
  const user = await models.User.findByPk(userId)
  if (!user) throw new Error('user-not-found')
  user.password = newPassword // hashed by beforeUpdate hook
  await user.save({ fields: ['password'] })
}

async function createInvite (createdById, { role, maxUses, expiresInDays }) {
  if (role !== 'teacher' && role !== 'student') throw new Error('invalid-role')
  const uses = parseInt(maxUses, 10)
  const days = parseInt(expiresInDays, 10) || 7
  if (!(uses >= 1)) throw new Error('invalid-maxUses')
  return models.Invite.create({
    role,
    maxUses: uses,
    expiresAt: new Date(Date.now() + days * 86400 * 1000),
    createdById
  })
}

async function revokeInvite (inviteId) {
  const [n] = await models.Invite.update({ revoked: true }, { where: { id: inviteId }, fields: ['revoked'] })
  if (n !== 1) throw new Error('invite-not-found')
}

// --- HTTP layer ---

const router = Router()
// Scope the guard to /admin only. This router is mounted at the app root
// (appRouter.use(require('./admin'))), so a bare router.use(requireTeacher) would
// run for EVERY request that reaches it — blocking /me, /new, notes, etc. for
// non-teachers. Restricting the path keeps requireTeacher on admin routes alone;
// other requests fall through to the next handler.
router.use('/admin', requireTeacher)

router.get('/admin', csrfProtection, async function (req, res) {
  const users = await models.User.findAll({ order: [['createdAt', 'ASC']] })
  const invites = await models.Invite.findAll({ where: { revoked: false }, order: [['createdAt', 'DESC']] })
  res.render('admin/dashboard', { users, invites, me: req.user, csrfToken: req.csrfToken(), infoMessages: req.flash('info'), errorMessages: req.flash('error') })
})

function handle (fn) {
  return async function (req, res) {
    try {
      await fn(req)
      req.flash('info', 'Done.')
    } catch (err) {
      logger.info(err.message)
      req.flash('error', err.message)
    }
    res.redirect('/admin')
  }
}

// urlencodedParser MUST precede csrfProtection — csurf reads req.body._csrf, which
// is undefined until the body is parsed (no global body parser; see lib/routes.js:64).
router.post('/admin/invites', urlencodedParser, csrfProtection, handle(req => createInvite(req.user.id, req.body)))
router.post('/admin/invites/:id/revoke', urlencodedParser, csrfProtection, handle(req => revokeInvite(req.params.id)))
router.post('/admin/users/:id/deactivate', urlencodedParser, csrfProtection, handle(req => deactivateUser(req.params.id)))
router.post('/admin/users/:id/activate', urlencodedParser, csrfProtection, handle(req => activateUser(req.params.id)))
router.post('/admin/users/:id/role', urlencodedParser, csrfProtection, handle(req => setRole(req.params.id, req.body.role)))
router.post('/admin/users/:id/reset-password', urlencodedParser, csrfProtection, handle(req => resetPassword(req.params.id, req.body.password)))

module.exports = router
Object.assign(module.exports, { deactivateUser, activateUser, setRole, resetPassword, createInvite, revokeInvite })
