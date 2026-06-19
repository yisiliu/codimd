'use strict'
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.createTable('Folders', {
      id: { type: Sequelize.UUID, primaryKey: true },
      ownerId: { type: Sequelize.UUID, allowNull: true },
      name: { type: Sequelize.STRING, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('Folders', ['ownerId', 'name'], { unique: true, name: 'folders_owner_name_unique' })

    await queryInterface.createTable('NoteTags', {
      id: { type: Sequelize.UUID, primaryKey: true },
      noteId: { type: Sequelize.UUID, allowNull: false },
      tag: { type: Sequelize.STRING, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    })
    await queryInterface.addIndex('NoteTags', ['noteId', 'tag'], { unique: true, name: 'notetags_note_tag_unique' })

    await queryInterface.addColumn('Notes', 'folderId', { type: Sequelize.UUID, allowNull: true, defaultValue: null })
    await queryInterface.addColumn('Notes', 'pinned', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false })
  },
  down: async function (queryInterface) {
    await queryInterface.removeColumn('Notes', 'pinned')
    await queryInterface.removeColumn('Notes', 'folderId')
    await queryInterface.dropTable('NoteTags')
    await queryInterface.dropTable('Folders')
  }
}
