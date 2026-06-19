'use strict'
/* helper: real in-memory sqlite models for integration tests */
process.env.NODE_ENV = process.env.NODE_ENV || 'test'

const models = require('../../lib/models')

async function resetDb () {
  await models.sequelize.sync({ force: true })
}

module.exports = { models, resetDb }
