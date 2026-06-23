'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

// Stub lib/response so the test exercises the middleware branching only,
// not the real errorForbidden (which needs config.serverURL + a real res).
let rejected
mock('../../lib/response', { errorForbidden: () => { rejected = true } })
const requireAdmin = mock.reRequire('../../lib/web/middleware/requireAdmin')
const requireOwner = mock.reRequire('../../lib/web/middleware/requireOwner')

function run (middleware, reqOverrides) {
  rejected = false
  let next = false
  middleware(Object.assign({ flash: () => {} }, reqOverrides), {}, () => { next = true })
  return { next, rejected }
}

describe('requireAdmin', function () {
  after(() => mock.stopAll())

  it('calls next for an active admin', function () {
    const s = run(requireAdmin, { isAuthenticated: () => true, user: { role: 'admin', active: true } })
    assert.strictEqual(s.next, true)
    assert.strictEqual(s.rejected, false)
  })
  it('calls next for an active owner', function () {
    const s = run(requireAdmin, { isAuthenticated: () => true, user: { role: 'owner', active: true } })
    assert.strictEqual(s.next, true)
    assert.strictEqual(s.rejected, false)
  })
  it('rejects a plain user', function () {
    const s = run(requireAdmin, { isAuthenticated: () => true, user: { role: 'user', active: true } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an inactive admin', function () {
    const s = run(requireAdmin, { isAuthenticated: () => true, user: { role: 'admin', active: false } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an anonymous request', function () {
    const s = run(requireAdmin, { isAuthenticated: () => false })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
})

describe('requireOwner', function () {
  after(() => mock.stopAll())

  it('calls next for an active owner', function () {
    const s = run(requireOwner, { isAuthenticated: () => true, user: { role: 'owner', active: true } })
    assert.strictEqual(s.next, true)
    assert.strictEqual(s.rejected, false)
  })
  it('rejects an admin', function () {
    const s = run(requireOwner, { isAuthenticated: () => true, user: { role: 'admin', active: true } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects a plain user', function () {
    const s = run(requireOwner, { isAuthenticated: () => true, user: { role: 'user', active: true } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an inactive owner', function () {
    const s = run(requireOwner, { isAuthenticated: () => true, user: { role: 'owner', active: false } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an anonymous request', function () {
    const s = run(requireOwner, { isAuthenticated: () => false })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
})
