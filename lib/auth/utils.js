'use strict'

const models = require('../models')
const config = require('../config')
const logger = require('../logger')

exports.setReturnToFromReferer = function setReturnToFromReferer (req) {
  if (!req.session) req.session = {}

  var referer = req.get('referer')
  var nextURL
  if (referer) {
    try {
      var refererSearchParams = new URLSearchParams(new URL(referer).search)
      nextURL = refererSearchParams.get('next')
    } catch (err) {
      logger.warn(err)
    }
  }

  if (nextURL) {
    var isRelativeNextURL = nextURL.indexOf('://') === -1 && !nextURL.startsWith('//')
    if (isRelativeNextURL) {
      req.session.returnTo = (new URL(nextURL, config.serverURL)).toString()
    } else {
      req.session.returnTo = config.serverURL
    }
  } else {
    req.session.returnTo = referer
  }
}

exports.passportGeneralCallback = async function callback (accessToken, refreshToken, profile, done) {
  const stringifiedProfile = JSON.stringify(profile)
  try {
    const [user, created] = await models.User.findOrCreate({
      where: { profileid: profile.id.toString() },
      defaults: {
        profile: stringifiedProfile,
        accessToken: accessToken,
        refreshToken: refreshToken
      }
    })
    if (created && !config.allowProviderAutoRegister) {
      logger.info('Refused provider auto-registration for ' + profile.provider)
      if (user) await user.destroy()
      return done(null, false)
    }
    if (!user) return done(null, false)
    let needSave = false
    if (user.profile !== stringifiedProfile) {
      user.profile = stringifiedProfile
      needSave = true
    }
    if (user.accessToken !== accessToken) {
      user.accessToken = accessToken
      needSave = true
    }
    if (user.refreshToken !== refreshToken) {
      user.refreshToken = refreshToken
      needSave = true
    }
    if (needSave) await user.save()
    if (config.debug) { logger.info('user login: ' + user.id) }
    return done(null, user)
  } catch (err) {
    logger.error('auth callback failed: ' + err)
    return done(err, null)
  }
}
