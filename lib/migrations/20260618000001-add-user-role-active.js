'use strict'
module.exports = {
  up: async function (queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'role', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'student'
    })
    await queryInterface.addColumn('Users', 'active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    })
    // Normalize existing emails so the unique index is case-consistent.
    await queryInterface.sequelize.query('UPDATE "Users" SET email = LOWER(email)').catch(function () {
      // MySQL/SQLite identifier quoting differs; fall back to unquoted.
      return queryInterface.sequelize.query('UPDATE Users SET email = LOWER(email)')
    })
    await queryInterface.addIndex('Users', ['email'], { unique: true, name: 'users_email_unique' })
  },
  down: async function (queryInterface, Sequelize) {
    await queryInterface.removeIndex('Users', 'users_email_unique')
    await queryInterface.removeColumn('Users', 'active')
    await queryInterface.removeColumn('Users', 'role')
  }
}
