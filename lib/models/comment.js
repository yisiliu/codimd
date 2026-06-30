'use strict'

module.exports = function (sequelize, DataTypes) {
  const Comment = sequelize.define('Comment', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    noteId: { type: DataTypes.UUID, allowNull: false },
    authorId: { type: DataTypes.UUID, allowNull: false },
    line: { type: DataTypes.INTEGER, allowNull: false },
    anchorText: { type: DataTypes.TEXT, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    resolved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    indexes: [{ fields: ['noteId'] }]
  })

  Comment.associate = function (models) {
    Comment.belongsTo(models.Note, { foreignKey: 'noteId', constraints: false })
    Comment.belongsTo(models.User, { foreignKey: 'authorId', constraints: false })
  }

  return Comment
}
