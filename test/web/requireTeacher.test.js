'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const mock = require('mock-require')

// Stub lib/response so the test exercises requireTeacher's branching only,
// not the real errorForbidden (which needs config.serverURL + a real res).
let rejected
mock('../../lib/response', { errorForbidden: () => { rejected = true } })
const requireTeacher = mock.reRequire('../../lib/web/middleware/requireTeacher')

function run (reqOverrides) {
  rejected = false
  let next = false
  requireTeacher(Object.assign({ flash: () => {} }, reqOverrides), {}, () => { next = true })
  return { next, rejected }
}

describe('requireTeacher', function () {
  after(() => mock.stopAll())

  it('calls next for an active teacher', function () {
    const s = run({ isAuthenticated: () => true, user: { role: 'teacher', active: true } })
    assert.strictEqual(s.next, true)
    assert.strictEqual(s.rejected, false)
  })
  it('rejects a student', function () {
    const s = run({ isAuthenticated: () => true, user: { role: 'student', active: true } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an inactive teacher', function () {
    const s = run({ isAuthenticated: () => true, user: { role: 'teacher', active: false } })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
  it('rejects an anonymous request', function () {
    const s = run({ isAuthenticated: () => false })
    assert.strictEqual(s.next, false)
    assert.strictEqual(s.rejected, true)
  })
})
