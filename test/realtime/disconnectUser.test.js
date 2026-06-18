'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const disconnectUser = require('../../lib/realtime/disconnectUser')

it('disconnects only the target user\'s sockets', function () {
  const disconnected = []
  const sockets = {
    a: { request: { user: { id: 'u1' } }, disconnect () { disconnected.push('a') } },
    b: { request: { user: { id: 'u2' } }, disconnect () { disconnected.push('b') } },
    c: { request: { user: { id: 'u1' } }, disconnect () { disconnected.push('c') } }
  }
  const realtime = { io: { sockets: { sockets } } }
  disconnectUser(realtime, 'u1')
  assert.deepStrictEqual(disconnected.sort(), ['a', 'c'])
})
