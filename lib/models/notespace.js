'use strict'

module.exports = function (sequelize, DataTypes) {
  const NoteSpace = sequelize.define('NoteSpace', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    noteId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    spaceId: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    indexes: [{ unique: true, fields: ['noteId', 'spaceId'] }]
  })

  NoteSpace.associate = function (models) {
    NoteSpace.belongsTo(models.Note, { foreignKey: 'noteId', constraints: false })
    NoteSpace.belongsTo(models.Space, { foreignKey: 'spaceId', constraints: false })
  }

  return NoteSpace
}
