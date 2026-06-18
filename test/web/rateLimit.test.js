'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const rateLimit = require('../../lib/web/middleware/rateLimit')

function mkRes () {
  return {
    code: null,
    status (c) {
      this.code = c
      return this
    },
    send () {},
    json () {}
  }
}

describe('rateLimit', function () {
  it('allows up to the limit then 429s', function () {
    const mw = rateLimit({ windowMs: 10000, max: 2 })
    const req = { ip: '1.1.1.1' }
    let nexts = 0
    mw(req, mkRes(), () => nexts++)
    mw(req, mkRes(), () => nexts++)
    const r = mkRes()
    mw(req, r, () => nexts++)
    assert.strictEqual(nexts, 2)
    assert.strictEqual(r.code, 429)
  })
})
