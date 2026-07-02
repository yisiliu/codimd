#!/usr/bin/env node

// Seed a durable QA test account with corner-case dashboard data.
// Re-runnable: wipes this account's prior seed, then recreates it.
//   node bin/seed_test_account.js
// Login: qa@example.com / qapass123  (role: user)

const logger = require('../lib/logger')
logger.transports.forEach((t) => { t.level = 'warning' })

const models = require('../lib/models/')
const { Op } = require('sequelize')

const EMAIL = 'qa@example.com'
const PASSWORD = 'qapass123'
const SPACE_NAMES = ['Physics 101', 'Lab Group', 'Journal Club', 'Interdisciplinary Methods Seminar']

function body (title, extra) {
  return `# ${title}\n\n${extra || 'Seeded note for QA verification.'}\n`
}

async function run () {
  // 1. user
  let user = await models.User.findOne({ where: { email: EMAIL } })
  if (!user) {
    user = await models.User.create({ email: EMAIL, password: PASSWORD, role: 'user', active: true })
    console.log(`created user ${EMAIL}`)
  } else {
    user.password = PASSWORD
    user.active = true
    await user.save()
    console.log(`reset existing user ${EMAIL}`)
  }
  const uid = user.id

  // 2. wipe prior seed for this user (idempotent)
  const oldNotes = await models.Note.findAll({ where: { ownerId: uid } })
  const oldNoteIds = oldNotes.map(n => n.id)
  if (oldNoteIds.length) {
    await models.NoteTag.destroy({ where: { noteId: oldNoteIds } })
    await models.NoteSpace.destroy({ where: { noteId: oldNoteIds } })
    await models.Note.destroy({ where: { id: oldNoteIds } })
  }
  await models.Folder.destroy({ where: { ownerId: uid } })
  // wipe the seed's spaces by NAME (not just this uid) so orphans from a previously
  // deleted-and-recreated qa (different UUID, same names) don't cause a unique collision
  const oldSpaces = await models.Space.findAll({ where: { [Op.or]: [{ createdById: uid }, { name: SPACE_NAMES }] } })
  const oldSpaceIds = oldSpaces.map(s => s.id)
  if (oldSpaceIds.length) {
    await models.NoteSpace.destroy({ where: { spaceId: oldSpaceIds } })
    await models.SpaceMember.destroy({ where: { spaceId: oldSpaceIds } })
    await models.Space.destroy({ where: { id: oldSpaceIds } })
  }
  await models.SpaceMember.destroy({ where: { userId: uid } })
  console.log('wiped prior QA seed')

  // 3. folders (incl. empty + long-name corner cases)
  const folders = {}
  for (const name of ['Coursework', 'Reading Group', 'Archive 2025', 'Empty Folder',
    'A Deliberately Very Long Folder Name To Test Sidebar Wrapping']) {
    const f = await models.Folder.create({ ownerId: uid, name })
    folders[name] = f.id
  }

  // 4. spaces (qa is steward + member) incl. long name
  const spaces = {}
  for (const name of SPACE_NAMES) {
    const s = await models.Space.create({ name, createdById: uid })
    spaces[name] = s.id
    await models.SpaceMember.create({ spaceId: s.id, userId: uid })
  }

  // 5. notes with corner cases
  // helper: create a note and optionally tag / file / share it
  async function note (opts) {
    const n = await models.Note.create({
      ownerId: uid,
      title: opts.title,
      content: body(opts.title || 'Untitled', opts.extra),
      permission: opts.permission || 'editable',
      folderId: opts.folder ? folders[opts.folder] : null,
      pinned: !!opts.pinned,
      template: !!opts.template
    })
    for (const t of (opts.tags || [])) await models.NoteTag.create({ noteId: n.id, tag: t })
    for (const sp of (opts.spaces || [])) await models.NoteSpace.create({ noteId: n.id, spaceId: spaces[sp] })
    return n
  }

  await note({ title: 'Comprehensive Notes on the Thermodynamic Behavior of Non-Equilibrium Systems Under Extreme Conditions', folder: 'Coursework', pinned: true, tags: ['thermo', 'urgent'] }) // long title + pinned
  await note({ title: 'Meeting agenda — 2026-07-06', folder: 'Reading Group', pinned: true, tags: ['meeting'] }) // pinned
  await note({ title: 'Weekly Report Template', template: true, tags: ['template'] }) // template
  await note({ title: 'Everything note', folder: 'Coursework', pinned: true, template: true, tags: ['urgent', 'draft', 'review'], spaces: ['Physics 101', 'Lab Group'] }) // pinned + template + many tags + many spaces
  await note({ title: 'Heavily tagged reading', folder: 'Reading Group', tags: ['methodology', 'q3', '2025', 'needs-committee-approval', 'review', 'draft', 'important'] }) // tag overflow
  await note({ title: 'Shared across groups', tags: ['shared'], spaces: ['Physics 101', 'Lab Group', 'Journal Club', 'Interdisciplinary Methods Seminar'] }) // many space chips
  await note({ title: 'Résumé draft — 日本語 notes 📚 café', folder: 'Archive 2025', tags: ['personal'] }) // unicode/emoji
  await note({ title: '', extra: 'A note with no heading, so the dashboard should show it as Untitled.' }) // Untitled corner
  await note({ title: 'Quick scratch', permission: 'private' }) // minimal: no folder/tags/spaces, private
  await note({ title: 'Lab safety checklist', folder: 'Coursework', tags: ['lab'], spaces: ['Lab Group'] })
  await note({ title: 'Journal club — paper summary', folder: 'Reading Group', tags: ['summary'], spaces: ['Journal Club'] })
  await note({ title: 'Old draft (archived)', folder: 'Archive 2025', tags: ['draft'] })
  await note({ title: 'Physics problem set 3', folder: 'Coursework', tags: ['homework'], spaces: ['Physics 101'] })
  await note({ title: 'Reading list', folder: 'Reading Group' })
  await note({ title: 'Ideas parking lot' }) // unfiled, no tags

  const noteCount = await models.Note.count({ where: { ownerId: uid } })
  console.log(`\nSeeded ${noteCount} notes, ${Object.keys(folders).length} folders (1 empty), ${Object.keys(spaces).length} spaces.`)
  console.log('\n===============================================')
  console.log('  QA test account ready')
  console.log(`  URL:      http://localhost:3300/`)
  console.log(`  Email:    ${EMAIL}`)
  console.log(`  Password: ${PASSWORD}`)
  console.log('===============================================')
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
