'use strict'
// HTTP test harness: builds an Express app that mounts the REAL lib/routes
// router through a realistic middleware stack (session, flash, body), with an
// injectable fake-auth layer. This lets tests drive routes end-to-end via
// supertest and catch routing/guard/csurf bugs that service-level unit tests miss.
process.env.NODE_ENV = process.env.NODE_ENV || 'test'

const express = require('express')
const ejs = require('ejs')
const cookieParser = require('cookie-parser')
const session = require('express-session')
const flash = require('connect-flash')
const methodOverride = require('method-override')
const config = require('../../lib/config')

// Build an app authenticated as `user` (or anonymous when user is null/undefined).
function buildApp (user) {
  const app = express()

  // views (some routes render EJS, e.g. errorForbidden)
  app.set('views', config.viewPath)
  app.engine('ejs', ejs.renderFile)
  app.set('view engine', 'ejs')
  app.locals.serverURL = ''
  app.locals.allowAnonymous = config.allowAnonymous

  app.use(methodOverride('_method'))
  app.use(cookieParser())
  app.use(session({ name: 'connect.sid', secret: 'test-secret', resave: false, saveUninitialized: true }))
  app.use(flash())

  // fake auth: stub passport's req.isAuthenticated()/req.user
  app.use(function (req, res, next) {
    req.isAuthenticated = function () { return !!user }
    if (user) req.user = user
    next()
  })

  // minimal stubs so any EJS render in a tested route doesn't crash on
  // i18n/nonce/useCDN/title (we assert status codes, not rendered content).
  app.use(function (req, res, next) {
    const identity = function (s) { return s }
    req.__ = res.locals.__ = identity
    req.getLocale = res.locals.getLocale = function () { return 'en' }
    res.locals.nonce = 'test-nonce'
    res.locals.title = 'test'
    res.locals.useCDN = false
    next()
  })

  app.use(require('../../lib/routes').router)
  return app
}

module.exports = { buildApp }
