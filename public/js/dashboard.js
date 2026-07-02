/* eslint-env browser, jquery */
/* global serverurl */

import List from 'list.js'

require('./locale')

require('../css/cover.css')
require('../css/site.css')

const baseurl = (typeof serverurl !== 'undefined' && serverurl) ? serverurl : ''

// state
let notes = []
let folders = []
let spaces = []
let currentFolder = 'all' // 'all' | 'unfiled' | folderId
let currentTag = '' // '' = all tags, else a user-tag

// browse state
const dashboardUser = (typeof window !== 'undefined' && window.dashboardUser) || { id: '', role: '' }
let browseSpaces = []
let browseNotes = []
let currentSpace = 'all' // 'all' | spaceId
let browseLoaded = false

const options = {
  valueNames: ['text', 'timestamp', 'noteid'],
  item: `<li class="dash-note">
          <span class="noteid" style="display:none;"></span>
          <div class="dash-note-main">
            <a class="dash-note-link" target="_blank">
              <i class="fa fa-file-text-o"></i> <span class="text"></span>
            </a>
            <span class="dash-shared-badge" style="display:none;"><i class="fa fa-share-alt"></i>shared</span>
            <span class="dash-template-badge" style="display:none;"><i class="fa fa-star"></i>template</span>
            <span class="timestamp" style="display:none;"></span>
            <span class="dash-note-tags"></span>
            <span class="dash-note-spaces"></span>
          </div>
          <div class="dash-note-actions">
            <button type="button" class="btn btn-xs btn-default dash-pin" title="Pin"><i class="fa fa-thumb-tack"></i></button>
            <button type="button" class="btn btn-xs btn-default dash-copy" title="Make a copy"><i class="fa fa-copy"></i></button>
            <div class="dropdown dash-menu">
              <button type="button" class="btn btn-xs btn-default dash-menu-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" title="Organize"><i class="fa fa-ellipsis-h"></i></button>
              <div class="dropdown-menu dropdown-menu-right dash-menu-panel">
                <div class="dash-menu-section">Organize<span class="dash-menu-hint"> · only you</span></div>
                <div class="dash-menu-row"><span class="dash-menu-label">Folder</span><select class="form-control input-sm dash-move"></select></div>
                <div class="dash-menu-row"><span class="dash-menu-label">Tags</span>
                  <form class="dash-add-tag form-inline">
                    <div class="input-group input-group-sm">
                      <input type="text" class="form-control dash-tag-input" placeholder="Add tag">
                      <span class="input-group-btn"><button type="submit" class="btn btn-default" title="Add tag"><i class="fa fa-plus"></i></button></span>
                    </div>
                  </form>
                </div>
                <div class="dash-menu-divider"></div>
                <div class="dash-menu-section"><i class="fa fa-share-alt"></i>Share<span class="dash-menu-hint"> · visible to members</span></div>
                <div class="dash-menu-row"><span class="dash-menu-label">Space</span><select class="form-control input-sm dash-space-add" title="Add to shared space"></select></div>
                <div class="dash-menu-divider"></div>
                <button type="button" class="btn btn-xs btn-default dash-template dash-menu-template" title="Toggle template"><i class="fa fa-star-o"></i> Template</button>
              </div>
            </div>
          </div>
        </li>`,
  page: 18,
  pagination: [{ outerWindow: 1 }]
}

const noteList = new List('dashboard-list', options)

const browseOptions = {
  valueNames: ['text', 'timestamp', 'noteid'],
  item: `<li class="dash-note">
          <span class="noteid" style="display:none;"></span>
          <div class="dash-note-main">
            <a class="dash-note-link" target="_blank">
              <i class="fa fa-file-text-o"></i> <span class="text"></span>
            </a>
            <span class="timestamp" style="display:none;"></span>
            <div class="dash-note-owner"></div>
            <div class="dash-note-spaces"></div>
          </div>
          <div class="dash-note-actions">
            <button type="button" class="btn btn-xs btn-default dash-copy" title="Make a copy"><i class="fa fa-copy"></i></button>
          </div>
        </li>`,
  page: 18,
  pagination: [{ outerWindow: 1 }]
}

const browseList = new List('browse-list', browseOptions)

// --- fetch helpers (same-origin, session cookie) ---

function apiGet (path) {
  return fetch(`${baseurl}${path}`, { credentials: 'same-origin' }).then(res => res.json())
}

function apiSend (method, path, body) {
  const opts = { method, credentials: 'same-origin' }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  return fetch(`${baseurl}${path}`, opts).then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
}

// --- load + render ---

function load () {
  Promise.all([
    apiGet('/api/notes/myNotes'),
    apiGet('/api/folders'),
    apiGet('/api/spaces')
  ]).then(([notesData, foldersData, spacesData]) => {
    notes = (notesData && notesData.myNotes) || []
    folders = (foldersData && foldersData.folders) || []
    spaces = (spacesData && spacesData.spaces) || []
    renderFolders()
    renderNotes()
  })
}

function folderName (folderId) {
  const f = folders.find(f => String(f.id) === String(folderId))
  return f ? f.name : ''
}

function visibleNotes () {
  let list = notes
  if (currentFolder === 'unfiled') list = list.filter(n => !n.folderId)
  else if (currentFolder !== 'all') list = list.filter(n => String(n.folderId) === String(currentFolder))
  if (currentTag) list = list.filter(n => (n.userTags || []).indexOf(currentTag) >= 0)
  return list
}

// render the sidebar tag-filter chips from the current notes' user-tags
function renderTags () {
  const $box = $('#dashboard-tag-filter')
  if (!$box.length) return
  const counts = {}
  notes.forEach(n => (n.userTags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1 }))
  const allTags = Object.keys(counts).sort()
  if (allTags.indexOf(currentTag) < 0) currentTag = ''
  $box.empty()
  const $all = $('<a href="#" class="dash-tag-filter-chip" data-tag=""></a>').text('All')
  if (currentTag === '') $all.addClass('active')
  $box.append($all)
  allTags.forEach(t => {
    const $chip = $('<a href="#" class="dash-tag-filter-chip"></a>').attr('data-tag', t).text(t)
    $chip.append($('<span class="dash-tag-filter-count"></span>').text(counts[t]))
    if (currentTag === t) $chip.addClass('active')
    $box.append($chip)
  })
  if (!allTags.length) $box.append($('<span class="dash-tag-empty"></span>').text('No tags yet'))
}

function renderFolders () {
  const $list = $('#dashboard-folders')
  // remove previously injected folder rows (keep all/unfiled)
  $list.find('li[data-folder-row]').remove()
  // counts
  $list.find('[data-count="all"]').text(notes.length)
  $list.find('[data-count="unfiled"]').text(notes.filter(n => !n.folderId).length)
  const $unfiled = $list.find('li[data-folder="unfiled"]')
  folders.forEach(folder => {
    const count = notes.filter(n => String(n.folderId) === String(folder.id)).length
    const $li = $(`<li data-folder-row data-folder="${folder.id}">
        <a href="#" data-folder="${folder.id}">
          <span><i class="fa fa-folder-o"></i> <span class="folder-name"></span></span>
          <span class="folder-actions">
            <span class="folder-count" data-count="${folder.id}"></span>
            <i class="fa fa-pencil dash-rename-folder" title="Rename"></i>
            <i class="fa fa-trash dash-delete-folder" title="Delete"></i>
          </span>
        </a>
      </li>`)
    $li.find('.folder-name').text(folder.name)
    $li.find('.folder-count').text(count)
    $li.data('folderId', folder.id)
    $unfiled.after($li)
  })
  // mark active
  $list.find('li').removeClass('active')
  $list.find(`li[data-folder="${currentFolder}"]`).addClass('active')
  // repopulate move selects with current folder list
  refreshMoveSelects()
}

function renderNotes () {
  renderTags()
  const list = visibleNotes()
  noteList.clear()
  list.forEach(note => {
    noteList.add({
      noteid: note.id,
      text: note.text || 'Untitled',
      timestamp: note.lastchangeAt ? new Date(note.lastchangeAt).getTime() : 0
    })
  })
  // pinned first, then newest
  noteList.sort('', {
    sortFunction (a, b) {
      const na = noteByEncoded(a.values().noteid)
      const nb = noteByEncoded(b.values().noteid)
      if (na && nb && na.pinned !== nb.pinned) return na.pinned ? -1 : 1
      return (b.values().timestamp || 0) - (a.values().timestamp || 0)
    }
  })
  checkEmpty()
}

function noteByEncoded (encodedId) {
  return notes.find(n => n.id === encodedId)
}

function moveSelectHtml (note) {
  let html = '<option value="">— Unfiled —</option>'
  folders.forEach(folder => {
    const selected = String(note.folderId) === String(folder.id) ? ' selected' : ''
    html += `<option value="${folder.id}"${selected}>${escapeHtml(folder.name)}</option>`
  })
  return html
}

function noteSpaceIds (note) {
  return (note.spaces || []).map(s => String(s.id))
}

function spaceAddSelectHtml (note) {
  const have = noteSpaceIds(note)
  const available = spaces.filter(s => !have.includes(String(s.id)))
  let html = '<option value="">+ space</option>'
  available.forEach(space => {
    html += `<option value="${space.id}">${escapeHtml(space.name)}</option>`
  })
  return html
}

function refreshMoveSelects () {
  $('#dashboard-notes .dash-move').each(function () {
    const note = noteByEncoded($(this).closest('li').find('.noteid').text())
    if (note) $(this).html(moveSelectHtml(note))
  })
}

function escapeHtml (str) {
  return $('<div>').text(str == null ? '' : str).html()
}

function checkEmpty () {
  const matching = noteList.matchingItems ? noteList.matchingItems.length : noteList.items.length
  if (matching === 0) {
    $('#dashboard-empty').show()
    $('#dashboard-notes').hide()
    $('.pagination').hide()
  } else {
    $('#dashboard-empty').hide()
    $('#dashboard-notes').show()
    $('.pagination').show()
  }
}

// render per-item details on every list update (rebuild, search, sort, page)
noteList.on('updated', () => {
  noteList.items.forEach(item => {
    if (!item.visible()) return
    const $el = $(item.elm)
    const note = noteByEncoded(item.values().noteid)
    if (!note) return
    $el.find('.dash-note-link').attr('href', `${baseurl}/${note.id}`)
    // pin state
    const $pin = $el.find('.dash-pin')
    if (note.pinned) $pin.addClass('active'); else $pin.removeClass('active')
    // template state
    const $template = $el.find('.dash-template')
    if (note.template) {
      $template.addClass('active').find('.fa').removeClass('fa-star-o').addClass('fa-star')
      $el.find('.dash-template-badge').show()
    } else {
      $template.removeClass('active').find('.fa').removeClass('fa-star').addClass('fa-star-o')
      $el.find('.dash-template-badge').hide()
    }
    // move select
    $el.find('.dash-move').html(moveSelectHtml(note))
    // tag chips
    const $tags = $el.find('.dash-note-tags')
    $tags.empty()
    ;(note.userTags || []).forEach(tag => {
      const $chip = $(`<span class="label label-info dash-tag-chip">${escapeHtml(tag)} <a href="#" class="dash-tag-remove">&times;</a></span>`)
      $chip.data('tag', tag)
      $tags.append($chip)
      $tags.append(' ')
    })
    // shared badge
    const noteSpaces = note.spaces || []
    if (noteSpaces.length) $el.find('.dash-shared-badge').show(); else $el.find('.dash-shared-badge').hide()
    // space chips (distinct from private tag chips)
    const $spaces = $el.find('.dash-note-spaces')
    $spaces.empty()
    if (noteSpaces.length) {
      $spaces.append('<span class="dash-spaces-label"><i class="fa fa-share-alt"></i>Spaces:</span>')
      noteSpaces.forEach(space => {
        const $chip = $(`<span class="space-chip">${escapeHtml(space.name)}<a href="#" class="space-x" title="Remove from space">&times;</a></span>`)
        $chip.data('spaceId', space.id)
        $spaces.append($chip)
        $spaces.append(' ')
      })
    }
    // space add select
    $el.find('.dash-space-add').html(spaceAddSelectHtml(note))
  })
})

// --- browse view ---

function canManageSpace (space) {
  return String(space.createdById) === String(dashboardUser.id) || dashboardUser.role === 'owner'
}

function spaceName (spaceId) {
  const s = browseSpaces.find(s => String(s.id) === String(spaceId))
  return s ? s.name : ''
}

function loadBrowse () {
  return Promise.all([
    apiGet('/api/spaces'),
    apiGet(`/api/browse${currentSpace === 'all' ? '' : `?space=${encodeURIComponent(currentSpace)}`}`)
  ]).then(([spacesData, browseData]) => {
    browseSpaces = (spacesData && spacesData.spaces) || []
    browseNotes = (browseData && browseData.notes) || []
    renderBrowseSpaces()
    renderBrowseNotes()
    browseLoaded = true
  })
}

function loadBrowseNotes () {
  return apiGet(`/api/browse${currentSpace === 'all' ? '' : `?space=${encodeURIComponent(currentSpace)}`}`).then(browseData => {
    browseNotes = (browseData && browseData.notes) || []
    renderBrowseNotes()
  })
}

function renderBrowseSpaces () {
  const $list = $('#browse-spaces')
  $list.find('li[data-space-row]').remove()
  const total = browseSpaces.reduce((sum, s) => sum + (s.count || 0), 0)
  $list.find('[data-count="all"]').text(total)
  const $all = $list.find('li[data-space="all"]')
  let prev = $all
  browseSpaces.forEach(space => {
    const $li = $(`<li data-space-row data-space="${space.id}">
        <a href="#" data-space="${space.id}">
          <span><i class="fa fa-share-alt"></i> <span class="space-name"></span></span>
          <span class="space-actions">
            <span class="folder-count" data-count="${space.id}"></span>
          </span>
        </a>
      </li>`)
    $li.find('.space-name').text(space.name)
    $li.find('.folder-count').text(space.count || 0)
    $li.find('.space-actions').append('<i class="fa fa-users dash-space-members" title="Members"></i>')
    if (canManageSpace(space)) {
      $li.find('.space-actions')
        .append('<i class="fa fa-pencil dash-rename-space" title="Rename"></i>')
        .append('<i class="fa fa-trash dash-delete-space" title="Delete"></i>')
    }
    $li.data('spaceId', space.id)
    prev.after($li)
    prev = $li
  })
  $list.find('li').removeClass('active')
  $list.find(`li[data-space="${currentSpace}"]`).addClass('active')
  $('#browse-spaces-empty').toggle(browseSpaces.length === 0)
}

function renderBrowseNotes () {
  browseList.clear()
  browseNotes.forEach(note => {
    browseList.add({
      noteid: note.id,
      text: note.text || 'Untitled',
      timestamp: note.lastchangeAt ? new Date(note.lastchangeAt).getTime() : 0
    })
  })
  browseList.sort('', {
    sortFunction (a, b) {
      return (b.values().timestamp || 0) - (a.values().timestamp || 0)
    }
  })
  checkBrowseEmpty()
}

function browseNoteByEncoded (encodedId) {
  return browseNotes.find(n => n.id === encodedId)
}

function checkBrowseEmpty () {
  const matching = browseList.matchingItems ? browseList.matchingItems.length : browseList.items.length
  if (matching === 0) {
    $('#browse-empty').show()
    $('#browse-notes').hide()
    $('#browse-list .pagination').hide()
  } else {
    $('#browse-empty').hide()
    $('#browse-notes').show()
    $('#browse-list .pagination').show()
  }
}

browseList.on('updated', () => {
  browseList.items.forEach(item => {
    if (!item.visible()) return
    const $el = $(item.elm)
    const note = browseNoteByEncoded(item.values().noteid)
    if (!note) return
    $el.find('.dash-note-link').attr('href', `${baseurl}/${note.id}`)
    const $owner = $el.find('.dash-note-owner')
    $owner.empty().append('<i class="fa fa-user-o"></i>').append(document.createTextNode(note.owner || 'Unknown'))
    const $spaces = $el.find('.dash-note-spaces')
    $spaces.empty()
    const noteSpaces = note.spaces || []
    if (noteSpaces.length) {
      $spaces.append('<span class="dash-spaces-label"><i class="fa fa-share-alt"></i>Spaces:</span>')
      noteSpaces.forEach(space => {
        const $chip = $(`<span class="space-chip">${escapeHtml(space.name)}</span>`)
        $spaces.append($chip)
        $spaces.append(' ')
      })
    }
  })
})

// toggle My Notes / Browse views
$('#dash-view-mynotes').on('click', function () {
  $(this).addClass('active')
  $('#dash-view-browse').removeClass('active')
  $('#dashboard-mynotes-view').show()
  $('#dashboard-browse-view').hide()
})

$('#dash-view-browse').on('click', function () {
  $(this).addClass('active')
  $('#dash-view-mynotes').removeClass('active')
  $('#dashboard-mynotes-view').hide()
  $('#dashboard-browse-view').show()
  if (!browseLoaded) loadBrowse()
})

// switch space
$('#browse-spaces').on('click', 'a[data-space]', function (e) {
  e.preventDefault()
  currentSpace = $(this).attr('data-space')
  $('#browse-spaces li').removeClass('active')
  $(this).closest('li').addClass('active')
  loadBrowseNotes()
})

// create space
$('#create-space-form').on('submit', function (e) {
  e.preventDefault()
  const name = $('#create-space-name').val().trim()
  if (!name) return
  apiSend('POST', '/api/spaces', { name }).then(({ ok }) => {
    if (ok) {
      $('#create-space-name').val('')
      loadBrowse()
    }
  })
})

// rename space
$('#browse-spaces').on('click', '.dash-rename-space', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const spaceId = $(this).closest('li').data('spaceId')
  const current = spaceName(spaceId)
  // eslint-disable-next-line no-alert
  const name = window.prompt('Rename space', current)
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed || trimmed === current) return
  apiSend('PUT', `/api/spaces/${spaceId}`, { name: trimmed }).then(({ ok }) => { if (ok) loadBrowse() })
})

// delete space
$('#browse-spaces').on('click', '.dash-delete-space', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const spaceId = $(this).closest('li').data('spaceId')
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Delete space "${spaceName(spaceId)}"? Notes will be unlinked from it.`)) return
  apiSend('DELETE', `/api/spaces/${spaceId}`).then(({ ok }) => {
    if (ok) {
      if (String(currentSpace) === String(spaceId)) currentSpace = 'all'
      loadBrowse()
    }
  })
})

// browse search keeps the empty-state in sync
$('#browse-list .search').on('keyup', () => { setTimeout(checkBrowseEmpty, 0) })

// --- actions ---

// switch folder
$('#dashboard-folders').on('click', 'a[data-folder]', function (e) {
  e.preventDefault()
  currentFolder = $(this).attr('data-folder')
  $('#dashboard-folders li').removeClass('active')
  $(this).closest('li').addClass('active')
  renderNotes()
})

// create folder
$('#create-folder-form').on('submit', function (e) {
  e.preventDefault()
  const name = $('#create-folder-name').val().trim()
  if (!name) return
  apiSend('POST', '/api/folders', { name }).then(({ ok }) => {
    if (ok) {
      $('#create-folder-name').val('')
      load()
    }
  })
})

// rename folder
$('#dashboard-folders').on('click', '.dash-rename-folder', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const folderId = $(this).closest('li').data('folderId')
  const current = folderName(folderId)
  // eslint-disable-next-line no-alert
  const name = window.prompt('Rename folder', current)
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed || trimmed === current) return
  apiSend('PUT', `/api/folders/${folderId}`, { name: trimmed }).then(({ ok }) => { if (ok) load() })
})

// delete folder
$('#dashboard-folders').on('click', '.dash-delete-folder', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const folderId = $(this).closest('li').data('folderId')
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Delete folder "${folderName(folderId)}"? Notes inside will become Unfiled.`)) return
  apiSend('DELETE', `/api/folders/${folderId}`).then(({ ok }) => {
    if (ok) {
      if (String(currentFolder) === String(folderId)) currentFolder = 'all'
      load()
    }
  })
})

// keep the organize dropdown open while interacting with its selects/inputs
$('#dashboard-notes').on('click', '.dash-menu-panel', function (e) {
  e.stopPropagation()
})

// move note to folder
$('#dashboard-notes').on('change', '.dash-move', function () {
  const encodedId = $(this).closest('li').find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const folderId = $(this).val() || null
  apiSend('PUT', `/api/notes/${encodedId}/folder`, { folderId }).then(({ ok }) => {
    if (ok) {
      note.folderId = folderId
      renderFolders()
      renderNotes()
    }
  })
})

// pin toggle
$('#dashboard-notes').on('click', '.dash-pin', function (e) {
  e.preventDefault()
  const encodedId = $(this).closest('li').find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const pinned = !note.pinned
  apiSend('PUT', `/api/notes/${encodedId}/pin`, { pinned }).then(({ ok }) => {
    if (ok) {
      note.pinned = pinned
      renderNotes()
    }
  })
})

// clone a note and open the copy in a new tab
function cloneNoteAndOpen (encodedId) {
  return apiSend('POST', `/api/notes/${encodedId}/clone`).then(({ ok, data }) => {
    if (ok && data && data.id) window.open(`${baseurl}/${data.id}`, '_blank')
  })
}

// make a copy (My Notes)
$('#dashboard-notes').on('click', '.dash-copy', function (e) {
  e.preventDefault()
  const encodedId = $(this).closest('li').find('.noteid').text()
  if (encodedId) cloneNoteAndOpen(encodedId)
})

// template toggle
$('#dashboard-notes').on('click', '.dash-template', function (e) {
  e.preventDefault()
  const encodedId = $(this).closest('li').find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const template = !note.template
  apiSend('PUT', `/api/notes/${encodedId}/template`, { template }).then(({ ok }) => {
    if (ok) {
      note.template = template
      renderNotes()
    }
  })
})

// make a copy (Browse)
$('#browse-notes').on('click', '.dash-copy', function (e) {
  e.preventDefault()
  const encodedId = $(this).closest('li').find('.noteid').text()
  if (encodedId) cloneNoteAndOpen(encodedId)
})

// new from template modal
function openTemplateModal () {
  const $body = $('#template-modal-body')
  $body.html('<p class="text-muted" style="padding: 12px;">Loading…</p>')
  $('#template-modal').modal('show')
  apiGet('/api/templates').then(data => {
    const templates = (data && data.templates) || []
    if (!templates.length) {
      $body.html('<p class="text-muted" style="padding: 12px;">No templates yet — mark one of your notes as a template.</p>')
      return
    }
    const $list = $('<ul id="template-list"></ul>')
    templates.forEach(t => {
      const $li = $(`<li><a href="#"><span class="template-title">${escapeHtml(t.text || 'Untitled')}</span><span class="template-owner"><i class="fa fa-user-o"></i>${escapeHtml(t.owner || 'Unknown')}</span></a></li>`)
      $li.find('a').data('templateId', t.id)
      $list.append($li)
    })
    $body.empty().append($list)
  })
}

$('#dash-new-from-template').on('click', function (e) {
  e.preventDefault()
  openTemplateModal()
})

$('#template-modal').on('click', '#template-list a', function (e) {
  e.preventDefault()
  const encodedId = $(this).data('templateId')
  if (!encodedId) return
  $('#template-modal').modal('hide')
  cloneNoteAndOpen(encodedId)
})

// --- members modal ---

let membersSpaceId = null

function openMembersModal (spaceId) {
  membersSpaceId = spaceId
  $('.members-modal-space').text(spaceName(spaceId) ? `· ${spaceName(spaceId)}` : '')
  $('#members-modal-body').html('<p class="text-muted" style="padding: 12px;">Loading…</p>')
  $('#members-modal').modal('show')
  loadMembers(spaceId)
}

function loadMembers (spaceId) {
  return Promise.all([
    apiGet(`/api/spaces/${spaceId}/members`),
    apiGet('/api/users')
  ]).then(([membersData, usersData]) => {
    if (String(membersSpaceId) !== String(spaceId)) return
    const members = (membersData && membersData.members) || []
    const users = (usersData && usersData.users) || []
    renderMembers(spaceId, members, users)
  })
}

function renderMembers (spaceId, members, users) {
  const $body = $('#members-modal-body')
  $body.empty()
  // viewer's steward status from the fresh list (stays correct after a transfer)
  const me = members.find(m => String(m.id) === String(dashboardUser.id))
  const canManage = (me && me.isSteward) || dashboardUser.role === 'owner'

  const $list = $('<ul id="members-list"></ul>')
  members.forEach(member => {
    const isSelf = String(member.id) === String(dashboardUser.id)
    const $li = $('<li></li>')
    const $name = $('<span class="member-name"><i class="fa fa-user-o"></i></span>')
    $name.append(document.createTextNode(member.name || 'Unknown'))
    if (member.isSteward) $name.append('<span class="member-steward-badge"><i class="fa fa-star"></i>steward</span>')
    $li.append($name)

    const $actions = $('<span class="member-actions"></span>')
    if (!member.isSteward && canManage && !isSelf) {
      const $makeSteward = $('<button type="button" class="btn btn-xs btn-default member-make-steward" title="Make steward"><i class="fa fa-star-o"></i> Make steward</button>')
      $makeSteward.data('userId', member.id)
      $actions.append($makeSteward)
    }
    if (isSelf && !member.isSteward) {
      const $leave = $('<button type="button" class="btn btn-xs btn-default member-leave" title="Leave space"><i class="fa fa-sign-out"></i> Leave</button>')
      $leave.data('userId', member.id)
      $actions.append($leave)
    }
    if (!isSelf && !member.isSteward && canManage) {
      const $remove = $('<button type="button" class="btn btn-xs btn-default member-remove" title="Remove member">&times;</button>')
      $remove.data('userId', member.id)
      $actions.append($remove)
    }
    $li.append($actions)
    $list.append($li)
  })
  $body.append($list)

  // add-member control (any member): users minus current members
  const memberIds = members.map(m => String(m.id))
  const candidates = users.filter(u => !memberIds.includes(String(u.id)))
  const $add = $('<form class="form-inline members-add"></form>')
  const $group = $('<div class="input-group input-group-sm"></div>')
  const $select = $('<select class="form-control members-add-select"></select>')
  if (candidates.length) {
    $select.append('<option value="">Add a member…</option>')
    candidates.forEach(u => {
      const $opt = $('<option></option>').attr('value', u.id).text(u.name || 'Unknown')
      $select.append($opt)
    })
  } else {
    $select.append('<option value="">No users to add</option>').prop('disabled', true)
  }
  $group.append($select)
  $group.append('<span class="input-group-btn"><button type="submit" class="btn btn-default members-add-btn"><i class="fa fa-plus"></i> Add</button></span>')
  $add.append($group)
  $body.append($add)
}

$('#browse-spaces').on('click', '.dash-space-members', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const spaceId = $(this).closest('li').data('spaceId')
  if (spaceId) openMembersModal(spaceId)
})

// add a member
$('#members-modal').on('submit', '.members-add', function (e) {
  e.preventDefault()
  const userId = $(this).find('.members-add-select').val()
  if (!userId || !membersSpaceId) return
  apiSend('POST', `/api/spaces/${membersSpaceId}/members`, { userId }).then(({ ok }) => {
    if (ok) loadMembers(membersSpaceId)
  })
})

// make another member the steward
$('#members-modal').on('click', '.member-make-steward', function (e) {
  e.preventDefault()
  const userId = $(this).data('userId')
  if (!userId || !membersSpaceId) return
  apiSend('PUT', `/api/spaces/${membersSpaceId}/steward`, { userId }).then(({ ok }) => {
    if (ok) loadMembers(membersSpaceId)
  })
})

// remove another member
$('#members-modal').on('click', '.member-remove', function (e) {
  e.preventDefault()
  const userId = $(this).data('userId')
  if (!userId || !membersSpaceId) return
  apiSend('DELETE', `/api/spaces/${membersSpaceId}/members/${userId}`).then(({ ok }) => {
    if (ok) loadMembers(membersSpaceId)
  })
})

// leave the space (own row) — re-load the sidebar since the space disappears for the viewer
$('#members-modal').on('click', '.member-leave', function (e) {
  e.preventDefault()
  const userId = $(this).data('userId')
  if (!userId || !membersSpaceId) return
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Leave space "${spaceName(membersSpaceId)}"?`)) return
  const leftSpaceId = membersSpaceId
  apiSend('DELETE', `/api/spaces/${membersSpaceId}/members/${userId}`).then(({ ok }) => {
    if (ok) {
      $('#members-modal').modal('hide')
      if (String(currentSpace) === String(leftSpaceId)) currentSpace = 'all'
      loadBrowse()
    }
  })
})

// filter notes by tag (sidebar chips)
$('#dashboard-tag-filter').on('click', '.dash-tag-filter-chip', function (e) {
  e.preventDefault()
  currentTag = $(this).attr('data-tag')
  renderNotes()
})

// add tag
$('#dashboard-notes').on('submit', '.dash-add-tag', function (e) {
  e.preventDefault()
  const $li = $(this).closest('li')
  const encodedId = $li.find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const tag = $li.find('.dash-tag-input').val().trim().toLowerCase()
  if (!tag) return
  apiSend('POST', `/api/notes/${encodedId}/tags`, { tag }).then(({ ok }) => {
    if (ok) {
      $li.find('.dash-tag-input').val('')
      note.userTags = note.userTags || []
      if (!note.userTags.includes(tag)) note.userTags.push(tag)
      note.userTags.sort()
      renderNotes()
    }
  })
})

// remove tag
$('#dashboard-notes').on('click', '.dash-tag-remove', function (e) {
  e.preventDefault()
  const $li = $(this).closest('li')
  const encodedId = $li.find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const tag = $(this).closest('.dash-tag-chip').data('tag')
  apiSend('DELETE', `/api/notes/${encodedId}/tags/${encodeURIComponent(tag)}`).then(({ ok }) => {
    if (ok) {
      note.userTags = (note.userTags || []).filter(t => t !== tag)
      renderNotes()
    }
  })
})

function saveNoteSpaces (encodedId, note, nextSpaces) {
  const spaceIds = nextSpaces.map(s => s.id)
  return apiSend('PUT', `/api/notes/${encodedId}/spaces`, { spaceIds }).then(({ ok }) => {
    if (ok) {
      note.spaces = nextSpaces
      renderNotes()
    }
  })
}

// add note to a shared space
$('#dashboard-notes').on('change', '.dash-space-add', function () {
  const encodedId = $(this).closest('li').find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const spaceId = $(this).val()
  if (!spaceId) return
  const space = spaces.find(s => String(s.id) === String(spaceId))
  if (!space) return
  const current = note.spaces || []
  if (current.some(s => String(s.id) === String(spaceId))) return
  saveNoteSpaces(encodedId, note, current.concat([{ id: space.id, name: space.name }]))
})

// remove note from a shared space
$('#dashboard-notes').on('click', '.space-x', function (e) {
  e.preventDefault()
  const encodedId = $(this).closest('li').find('.noteid').text()
  const note = noteByEncoded(encodedId)
  if (!note) return
  const spaceId = $(this).closest('.space-chip').data('spaceId')
  const next = (note.spaces || []).filter(s => String(s.id) !== String(spaceId))
  saveNoteSpaces(encodedId, note, next)
})

// search keeps the empty-state in sync
$('.search').on('keyup', () => { setTimeout(checkEmpty, 0) })

// prevent empty link change hash
$('a[href="#"]').click(function (e) { e.preventDefault() })

// --- dark mode (interops with the editor's nightMode cookie + localStorage) ---
function dashNightPref () {
  try { if (window.localStorage.getItem('nightMode') === 'true') return true } catch (e) {}
  return document.cookie.indexOf('nightMode=true') !== -1
}
function applyDashNight (on) {
  $('body').toggleClass('dash-night', on)
  $('.dash-night-toggle i').attr('class', on ? 'fa fa-sun-o' : 'fa fa-moon-o')
}
function setDashNight (on) {
  try { window.localStorage.setItem('nightMode', on ? 'true' : 'false') } catch (e) {}
  document.cookie = 'nightMode=' + (on ? 'true' : 'false') + ';path=/;max-age=31536000;samesite=lax'
  applyDashNight(on)
}
applyDashNight(dashNightPref())
$(document).on('click', '.dash-night-toggle', function () {
  setDashNight(!$('body').hasClass('dash-night'))
})

load()
