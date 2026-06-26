'use strict'
module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.addColumn('Notes', 'template', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false })
  },
  down: function (queryInterface) {
    return queryInterface.removeColumn('Notes', 'template')
  }
}
