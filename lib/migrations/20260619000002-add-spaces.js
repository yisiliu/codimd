'use strict'
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('Spaces', {
      id: { type: Sequelize.UUID, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      nameLower: { type: Sequelize.STRING, allowNull: false },
      createdById: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('Spaces', ['nameLower'], { unique: true, name: 'spaces_namelower_unique' })

    await queryInterface.createTable('NoteSpaces', {
      id: { type: Sequelize.UUID, primaryKey: true },
      noteId: { type: Sequelize.UUID, allowNull: false },
      spaceId: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('NoteSpaces', ['noteId', 'spaceId'], { unique: true, name: 'notespaces_note_space_unique' })
  },
  down: async function (queryInterface) {
    await queryInterface.dropTable('NoteSpaces')
    await queryInterface.dropTable('Spaces')
  }
}
