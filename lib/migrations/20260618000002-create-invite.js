'use strict'
module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.createTable('Invites', {
      id: { type: Sequelize.UUID, primaryKey: true },
      token: { type: Sequelize.STRING, allowNull: false, unique: true },
      role: { type: Sequelize.STRING, allowNull: false },
      maxUses: { type: Sequelize.INTEGER, allowNull: false },
      usedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      revoked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdById: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
  },
  down: function (queryInterface) {
    return queryInterface.dropTable('Invites')
  }
}
