'use strict'

module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('Comments', {
      id: { type: Sequelize.UUID, primaryKey: true },
      noteId: { type: Sequelize.UUID, allowNull: false },
      authorId: { type: Sequelize.UUID, allowNull: false },
      line: { type: Sequelize.INTEGER, allowNull: false },
      anchorText: { type: Sequelize.TEXT, allowNull: true },
      content: { type: Sequelize.TEXT, allowNull: false },
      resolved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('Comments', ['noteId'], { name: 'comments_note_idx' })
  },
  down: async function (queryInterface) {
    await queryInterface.dropTable('Comments')
  }
}
