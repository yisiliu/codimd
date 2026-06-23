'use strict'
module.exports = {
  up: async function (queryInterface) {
    // 1 & 2: portable bulk renames
    await queryInterface.bulkUpdate('Users', { role: 'admin' }, { role: 'teacher' })
    await queryInterface.bulkUpdate('Users', { role: 'user' }, { role: 'student' })
    // 3: promote the earliest active former-teacher to owner (UUID PK → order by createdAt).
    // rawSelect handles dialect quoting + returns the first matching attribute (or null).
    const firstAdminId = await queryInterface.rawSelect('Users', {
      where: { role: 'admin', active: true },
      order: [['createdAt', 'ASC'], ['id', 'ASC']]
    }, 'id')
    if (firstAdminId) {
      await queryInterface.bulkUpdate('Users', { role: 'owner' }, { id: firstAdminId })
    }
  },
  down: async function (queryInterface) {
    const { Op } = require('sequelize')
    await queryInterface.bulkUpdate('Users', { role: 'teacher' }, { role: { [Op.in]: ['admin', 'owner'] } })
    await queryInterface.bulkUpdate('Users', { role: 'student' }, { role: 'user' })
  }
}
