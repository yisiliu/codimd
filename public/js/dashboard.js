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

const options = {
  valueNames: ['text', 'timestamp', 'noteid'],
  item: `<li class="dash-note">
          <span class="noteid" style="display:none;"></span>
          <div class="dash-note-main">
            <a class="dash-note-link" target="_blank">
              <i class="fa fa-file-text-o"></i> <span class="text"></span>
            </a>
            <span class="dash-shared-badge" style="display:none;"><i class="fa fa-share-alt"></i>shared</span>
            <span class="timestamp" style="display:none;"></span>
            <div class="dash-note-tags"></div>
            <div class="dash-note-spaces"></div>
          </div>
          <div class="dash-note-actions">
            <button type="button" class="btn btn-xs btn-default dash-pin" title="Pin"><i class="fa fa-thumb-tack"></i></button>
            <select class="form-control input-sm dash-move"></select>
            <select class="form-control input-sm dash-space-add" title="Add to shared space"></select>
            <form class="dash-add-tag form-inline">
              <input type="text" class="form-control input-sm dash-tag-input" placeholder="+ tag">
            </form>
          </div>
        </li>`,
  page: 18,
  pagination: [{ outerWindow: 1 }]
}

const noteList = new List('dashboard-list', options)

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
  if (currentFolder === 'all') return notes
  if (currentFolder === 'unfiled') return notes.filter(n => !n.folderId)
  return notes.filter(n => String(n.folderId) === String(currentFolder))
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

load()
