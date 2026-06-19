'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

describe('deserializeUser active gate', function () {
  afterEach(() => mock.stopAll())

  it('de-auths an inactive user', function (done) {
    // Arrange a fake passport whose deserializeUser callback we can capture.
    let deserializeFn
    mock('passport', { deserializeUser: (fn) => { deserializeFn = fn }, serializeUser: () => {}, use: () => {} })
    mock('../../lib/models', { User: { findOne: async () => ({ id: '1', active: false }) } })
    // Requiring the auth index registers deserializeUser.
    mock.reRequire('../../lib/auth/index')
    deserializeFn('1', (err, user) => {
      assert.ifError(err)
      assert.strictEqual(user, false)
      done()
    })
  })
})
