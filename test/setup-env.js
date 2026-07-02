'use strict'
// Force the test environment before any spec (hence lib/config / lib/models) is
// required. The HTTP integration suites call sequelize.sync({ force: true }) on
// the real models module; without NODE_ENV=test that destructive drop runs
// against the *development* database (config.json → ./db.codimd.sqlite) and wipes
// local data. Referenced from test/mocha.opts, which Mocha 5.x auto-loads for
// EVERY run — including a bare `npx mocha path/to/file.js` that bypasses npm.
process.env.NODE_ENV = process.env.NODE_ENV || 'test'
