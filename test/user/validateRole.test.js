'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const validateRole = require('../../lib/user/validateRole')

it('accepts teacher and student', function () {
  assert.strictEqual(validateRole('teacher'), 'teacher')
  assert.strictEqual(validateRole(undefined), 'student') // default
})
it('throws on an unknown role', function () {
  assert.throws(() => validateRole('admin'), /invalid role/i)
})
