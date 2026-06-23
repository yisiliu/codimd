'use strict'
const response = require('../../response')

module.exports = function requireOwner (req, res, next) {
  if (req.isAuthenticated() && req.user && req.user.role === 'owner' && req.user.active) {
    return next()
  }
  return response.errorForbidden ? response.errorForbidden(req, res) : res.status(403).render('error')
}
