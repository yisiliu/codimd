'use strict'
/* eslint-env node, mocha */
const assert = require('assert')
const { models, resetDb } = require('../helpers/db')
const browse = require('../../lib/browse')

const U = id => ({ id, role: 'user' })
const OWNER = id => ({ id, role: 'owner' })

describe('space membership', function () {
  this.timeout(10000)
  let steward, m2, outsider, ownerUser, space
  beforeEach(async function () {
    await resetDb()
    steward = (await models.User.create({})).id
    m2 = (await models.User.create({})).id
    outsider = (await models.User.create({})).id
    ownerUser = (await models.User.create({ role: 'owner' })).id
    space = await browse.createSpace(steward, 'Lab') // steward auto-added
  })

  it('createSpace makes the creator a member + steward', async function () {
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: steward } }), 1)
    const seen = await browse.listSpaces(U(steward))
    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].isSteward, true)
  })

  it('non-members do not see the space; owner sees all', async function () {
    assert.strictEqual((await browse.listSpaces(U(outsider))).length, 0)
    assert.strictEqual((await browse.listSpaces(OWNER(ownerUser))).length, 1)
  })

  it('any member can invite; only steward can remove another; cannot remove the steward', async function () {
    await browse.addMember(U(steward), space.id, m2)
    // m2 (plain member) cannot remove outsider-added user or anyone
    await browse.addMember(U(m2), space.id, outsider) // member invites — allowed
    await assert.rejects(() => browse.removeMember(U(m2), space.id, outsider), /forbidden/)
    // steward removes outsider — allowed
    await browse.removeMember(U(steward), space.id, outsider)
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: outsider } }), 0)
    // nobody can remove the steward
    await assert.rejects(() => browse.removeMember(OWNER(ownerUser), space.id, steward), /forbidden/)
  })

  it('a member can leave; the steward cannot (must transfer first)', async function () {
    await browse.addMember(U(steward), space.id, m2)
    await browse.removeMember(U(m2), space.id, m2) // leave
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: m2 } }), 0)
    await assert.rejects(() => browse.removeMember(U(steward), space.id, steward), /forbidden/)
  })

  it('steward transfers to a member; cannot transfer to a non-member', async function () {
    await browse.addMember(U(steward), space.id, m2)
    await assert.rejects(() => browse.transferSteward(U(steward), space.id, outsider), /forbidden/)
    await browse.transferSteward(U(steward), space.id, m2)
    const reloaded = await models.Space.findByPk(space.id)
    assert.strictEqual(String(reloaded.createdById), String(m2))
    // old steward is now a plain member and CAN leave
    await browse.removeMember(U(steward), space.id, steward)
    assert.strictEqual(await models.SpaceMember.count({ where: { spaceId: space.id, userId: steward } }), 0)
  })

  it('setNoteSpaces only files into member-spaces; listBrowse hides non-member spaces', async function () {
    const note = await models.Note.create({ ownerId: m2, content: '# n', permission: 'editable' })
    await browse.addMember(U(steward), space.id, m2)
    await browse.setNoteSpaces(m2, note.id, [space.id]) // m2 is a member → allowed
    assert.strictEqual((await browse.spacesForNote(note.id)).length, 1)
    // outsider (non-member) sees nothing in browse for this space
    assert.strictEqual((await browse.listBrowse(U(outsider), { space: space.id })).length, 0)
    // a member sees it
    assert.strictEqual((await browse.listBrowse(U(m2), { space: space.id })).length, 1)
  })
})
