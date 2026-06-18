'use strict'
const { Router } = require('express')
const csurf = require('csurf')
const { Op } = require('sequelize')
const validator = require('validator')
const models = require('../models')
const config = require('../config')
const logger = require('../logger')
const rateLimit = require('../web/middleware/rateLimit')
const { urlencodedParser } = require('../utils')

// csurf is per-route in this app (see lib/routes.js) — NOT global. Both the GET
// (which calls req.csrfToken()) and the POST (which validates) must attach it,
// or the GET throws and every valid invite renders the error page.
const csrfProtection = csurf({ cookie: true })

// Pure redemption logic, unit-testable without Express.
async function redeemInvite (token, { email, password, role: _ignored } = {}) {
  if (!email || !validator.isEmail(email) || !password) {
    throw new Error('invalid-credentials')
  }
  const normalized = email.toLowerCase()
  return models.sequelize.transaction(async function (t) {
    const invite = await models.Invite.findOne({ where: { token }, transaction: t })
    if (!invite || !invite.isRedeemable()) throw new Error('invite-not-redeemable')

    // Create the user with EXPLICIT fields only — never trust the form's role.
    const user = await models.User.create({
      email: normalized,
      password: password,
      role: invite.role,
      active: true
    }, { transaction: t, fields: ['email', 'password', 'role', 'active'] })

    // Guarded conditional increment: succeeds for exactly one concurrent redeemer.
    const [affected] = await models.Invite.update(
      { usedCount: models.sequelize.literal('"usedCount" + 1') },
      {
        where: {
          id: invite.id,
          revoked: false,
          expiresAt: { [Op.gt]: new Date() },
          usedCount: { [Op.lt]: models.sequelize.col('maxUses') }
        },
        transaction: t
      }
    )
    if (affected !== 1) throw new Error('invite-not-redeemable')
    return user
  })
}

const router = Router()

router.get('/invite/:token', csrfProtection, async function (req, res) {
  try {
    const invite = await models.Invite.findOne({ where: { token: req.params.token } })
    if (!invite || !invite.isRedeemable()) return res.status(410).render('invite/invalid')
    return res.render('invite/redeem', { token: req.params.token, csrfToken: req.csrfToken() })
  } catch (err) {
    logger.error(err)
    return res.status(500).render('invite/invalid')
  }
})

router.post('/invite/:token', rateLimit({ windowMs: 60000, max: 10 }), csrfProtection, urlencodedParser, async function (req, res) {
  try {
    await redeemInvite(req.params.token, req.body)
    req.flash('info', "You've registered — please sign in.")
    return res.redirect(config.serverURL + '/')
  } catch (err) {
    logger.info('invite redemption failed: ' + err.message)
    req.flash('error', 'Could not complete registration. The invite may be invalid, expired, or the email already in use.')
    return res.redirect(config.serverURL + '/invite/' + req.params.token)
  }
})

module.exports = router
module.exports.redeemInvite = redeemInvite
