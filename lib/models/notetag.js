'use strict'

module.exports = function (sequelize, DataTypes) {
  const NoteTag = sequelize.define('NoteTag', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    noteId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    tag: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    }
  }, {
    indexes: [{ unique: true, fields: ['noteId', 'tag'] }]
  })

  function normalize (instance) {
    if (instance.tag) instance.tag = instance.tag.trim().toLowerCase()
  }
  NoteTag.addHook('beforeValidate', normalize)

  NoteTag.associate = function (models) {
    NoteTag.belongsTo(models.Note, { foreignKey: 'noteId', constraints: false })
  }

  return NoteTag
}
