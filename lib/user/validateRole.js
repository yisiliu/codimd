'use strict'
const ROLES = ['user', 'admin', 'owner']
module.exports = function validateRole (role) {
  if (role === undefined || role === null) return 'user'
  if (!ROLES.includes(role)) {
    throw new Error('invalid role: ' + role + " (must be 'user', 'admin', or 'owner')")
  }
  return role
}
module.exports.ROLES = ROLES
