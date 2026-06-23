'use strict'
/* eslint-env node, mocha */
const assert = require('assert')

// Regression guard: the admin router is mounted at the app root
// (appRouter.use(require('./admin'))), so requireAdmin MUST be scoped to /admin.
// A bare router.use(requireAdmin) would run for every request that reaches the
// router and block /me, /new, notes, etc. for non-admins.
describe('admin router mounting', function () {
  const adminRouter = require('../../lib/admin/index')

  function requireAdminLayer () {
    return adminRouter.stack.find(function (l) {
      return l.handle && l.handle.name === 'requireAdmin'
    })
  }

  it('mounts requireAdmin', function () {
    assert.ok(requireAdminLayer(), 'requireAdmin middleware is present on the router')
  })

  it('applies requireAdmin to /admin paths', function () {
    const layer = requireAdminLayer()
    assert.ok(layer.regexp.test('/admin'))
    assert.ok(layer.regexp.test('/admin/users/abc/role'))
  })

  it('does NOT apply requireAdmin to non-admin paths', function () {
    const layer = requireAdminLayer()
    assert.strictEqual(layer.regexp.test('/me'), false)
    assert.strictEqual(layer.regexp.test('/new'), false)
    assert.strictEqual(layer.regexp.test('/'), false)
  })
})
