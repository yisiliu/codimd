'use strict'
module.exports = function validateRole (role) {
  if (role === undefined || role === null) return 'student'
  if (role !== 'teacher' && role !== 'student') {
    throw new Error('invalid role: ' + role + " (must be 'teacher' or 'student')")
  }
  return role
}
