'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { router } = require('../../lib/dashboard/index')

it('dashboard routes are all under /api', function () {
  const paths = router.stack.filter(l => l.route).map(l => l.route.path)
  assert.ok(paths.length >= 8)
  paths.forEach(p => assert.ok(p.startsWith('/api/'), `route ${p} must be under /api`))
})
