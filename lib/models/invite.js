'use strict'
const crypto = require('crypto')

module.exports = function (sequelize, DataTypes) {
  const Invite = sequelize.define('Invite', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: sequelize.Sequelize.UUIDV4
    },
    token: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      defaultValue: function () { return crypto.randomBytes(32).toString('base64url') }
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [['teacher', 'student']] }
    },
    maxUses: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 }
    },
    usedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    revoked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  })

  Invite.prototype.isRedeemable = function () {
    return !this.revoked &&
      this.expiresAt > new Date() &&
      this.usedCount < this.maxUses
  }

  Invite.associate = function (models) {
    Invite.belongsTo(models.User, { foreignKey: 'createdById', constraints: false })
  }

  return Invite
}
