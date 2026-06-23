'use strict'
const { v4: uuidv4 } = require('uuid')

module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('SpaceMembers', {
      id: { type: Sequelize.UUID, primaryKey: true },
      spaceId: { type: Sequelize.UUID, allowNull: false },
      userId: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('SpaceMembers', ['spaceId', 'userId'], { unique: true, name: 'spacemembers_space_user_unique' })
    // Backfill: each existing space's steward (createdById) becomes a member.
    // Read via the model (portable, no dialect quoting trap); write via bulkInsert with explicit uuid ids.
    const models = require('../models')
    const spaces = await models.Space.findAll()
    const now = new Date()
    const rows = spaces.filter(s => s.createdById).map(s => ({ id: uuidv4(), spaceId: s.id, userId: s.createdById, createdAt: now, updatedAt: now }))
    if (rows.length) await queryInterface.bulkInsert('SpaceMembers', rows)
  },
  down: async function (queryInterface) {
    await queryInterface.dropTable('SpaceMembers')
  }
}
