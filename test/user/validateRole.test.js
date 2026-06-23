'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const validateRole = require('../../lib/user/validateRole')

it('accepts user, admin and owner', function () {
  assert.strictEqual(validateRole('user'), 'user')
  assert.strictEqual(validateRole('admin'), 'admin')
  assert.strictEqual(validateRole('owner'), 'owner')
  assert.strictEqual(validateRole(undefined), 'user') // default
})
it('throws on an unknown role', function () {
  assert.throws(() => validateRole('teacher'), /invalid role/i)
})
