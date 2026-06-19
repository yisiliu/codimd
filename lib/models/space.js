'use strict'

module.exports = function (sequelize, DataTypes) {
  const Space = sequelize.define('Space', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { notEmpty: true }
    },
    nameLower: {
      type: DataTypes.STRING,
      allowNull: false
    },
    createdById: {
      type: DataTypes.UUID
    }
  }, {
    indexes: [{ unique: true, fields: ['nameLower'] }]
  })

  function normalize (space) {
    if (space.name) {
      space.name = space.name.trim()
      space.nameLower = space.name.toLowerCase()
    }
  }
  Space.addHook('beforeValidate', normalize)

  Space.associate = function (models) {
    Space.belongsTo(models.User, { foreignKey: 'createdById', constraints: false })
    // NB: no `Space.hasMany(NoteSpace)` here — NoteSpace is created in Task 2 and the
    // model loader runs associate() eagerly, so referencing it now throws when only
    // space.js exists. The services query NoteSpace directly, so the reverse
    // association is unused anyway.
  }

  return Space
}
