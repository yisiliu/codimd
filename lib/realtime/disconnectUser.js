'use strict'
module.exports = function disconnectUser (realtime, userId) {
  if (!realtime || !realtime.io) return
  const sockets = realtime.io.sockets.sockets
  Object.keys(sockets).forEach(function (key) {
    const socket = sockets[key]
    const u = socket.request && socket.request.user
    if (u && String(u.id) === String(userId)) {
      socket.disconnect(true)
    }
  })
}
