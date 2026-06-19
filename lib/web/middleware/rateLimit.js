'use strict'
// Minimal fixed-window in-memory rate limiter. Per-process; fine for a single-instance deployment.
module.exports = function rateLimit ({ windowMs = 60000, max = 10 } = {}) {
  const hits = new Map()
  return function (req, res, next) {
    const now = Date.now()
    const key = req.ip
    const rec = hits.get(key)
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 })
      return next()
    }
    rec.count++
    if (rec.count > max) {
      return res.status(429).send('Too many requests, please try again later.')
    }
    return next()
  }
}
