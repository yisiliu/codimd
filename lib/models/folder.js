'use strict'

module.exports = function (sequelize, DataTypes) {
  const Folder = sequelize.define('Folder', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    ownerId: {
      type: DataTypes.UUID
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    }
  }, {
    indexes: [{ unique: true, fields: ['ownerId', 'name'] }]
  })

  Folder.associate = function (models) {
    Folder.belongsTo(models.User, { foreignKey: 'ownerId', constraints: false })
    Folder.hasMany(models.Note, { foreignKey: 'folderId', constraints: false })
  }

  return Folder
}
