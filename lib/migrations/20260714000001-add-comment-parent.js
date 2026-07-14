'use strict'

// Threaded replies: a comment may be a reply to another (top-level) comment.
// parentId NULL = top-level comment; non-NULL = a reply under that comment.
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.addColumn('Comments', 'parentId', {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null
    })
    await queryInterface.addIndex('Comments', ['parentId'], { name: 'comments_parent_idx' })
  },
  down: async function (queryInterface) {
    await queryInterface.removeIndex('Comments', 'comments_parent_idx')
    await queryInterface.removeColumn('Comments', 'parentId')
  }
}
