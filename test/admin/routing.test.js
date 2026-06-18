'use strict'
/* eslint-env node, mocha */
const assert = require('assert')

// Regression guard: the admin router is mounted at the app root
// (appRouter.use(require('./admin'))), so requireTeacher MUST be scoped to /admin.
// A bare router.use(requireTeacher) would run for every request that reaches the
// router and block /me, /new, notes, etc. for non-teachers.
describe('admin router mounting', function () {
  const adminRouter = require('../../lib/admin/index')

  function requireTeacherLayer () {
    return adminRouter.stack.find(function (l) {
      return l.handle && l.handle.name === 'requireTeacher'
    })
  }

  it('mounts requireTeacher', function () {
    assert.ok(requireTeacherLayer(), 'requireTeacher middleware is present on the router')
  })

  it('applies requireTeacher to /admin paths', function () {
    const layer = requireTeacherLayer()
    assert.ok(layer.regexp.test('/admin'))
    assert.ok(layer.regexp.test('/admin/users/abc/role'))
  })

  it('does NOT apply requireTeacher to non-admin paths', function () {
    const layer = requireTeacherLayer()
    assert.strictEqual(layer.regexp.test('/me'), false)
    assert.strictEqual(layer.regexp.test('/new'), false)
    assert.strictEqual(layer.regexp.test('/'), false)
  })
})
