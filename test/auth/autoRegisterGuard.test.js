'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

describe('passportGeneralCallback auto-register guard', function () {
  afterEach(() => mock.stopAll())

  it('refuses a newly-created external account when auto-register is off', function (done) {
    mock('../../lib/config', { allowProviderAutoRegister: false })
    mock('../../lib/models', {
      User: { findOrCreate: async () => [{ id: 'new', destroy: async () => {} }, true] }
    })
    const { passportGeneralCallback } = mock.reRequire('../../lib/auth/utils')
    passportGeneralCallback('at', 'rt', { id: 'p1', provider: 'github' }, (err, user) => {
      assert.ifError(err)
      assert.strictEqual(user, false)
      done()
    })
  })
})
