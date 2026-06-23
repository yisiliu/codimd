'use strict'

module.exports = function (sequelize, DataTypes) {
  const SpaceMember = sequelize.define('SpaceMember', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    spaceId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    indexes: [{ unique: true, fields: ['spaceId', 'userId'] }]
  })

  SpaceMember.associate = function (models) {
    SpaceMember.belongsTo(models.Space, { foreignKey: 'spaceId', constraints: false })
    SpaceMember.belongsTo(models.User, { foreignKey: 'userId', constraints: false })
  }

  return SpaceMember
}
