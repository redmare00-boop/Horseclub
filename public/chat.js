const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) {
  window.location.href = '/login.html'
}
if (user?.must_change_password) {
  window.location.href = '/change-password.html'
}

const socket = io()
let activeChannelId = null
let channels = []
let pendingAttachments = []
let uploadInProgress = false
const currentMessagesById = new Map()
let activeMenuMessageId = null
let activeMenuChannelId = null
let activeForwardMessageId = null
let editingMessageId = null
let editingBackupHtml = null
let oldestLoadedMessageId = null
let hasMoreHistory = true

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}

function renderPinnedBar(messages) {
  const bar = document.getElementById('pinned-bar')
  if (!bar) return
  const pinned = (messages || []).filter((m) => m?.is_pinned)
  if (pinned.length === 0) {
    bar.style.display = 'none'
    bar.innerHTML = ''
    return
  }
  const last = pinned[pinned.length - 1]
  const text = last.content ? last.content : (last.attachments?.length ? `Вложение: ${last.attachments[0].name || 'файл'}` : 'Сообщение')
  bar.style.display = 'flex'
  bar.innerHTML = `<span style="font-weight:500">Закреплено:</span> <a href="#m-${last.id}">${escapeHtml(text).slice(0, 80)}</a>`
}

function renderPinnedBarFromCache() {
  renderPinnedBar(Array.from(currentMessagesById.values()))
}

function updateAttachButton() {
  const btn = document.getElementById('attach-btn')
  if (!btn) return
  const count = pendingAttachments.length
  btn.textContent = uploadInProgress ? '⏳' : (count > 0 ? `📎${count}` : '📎')
  btn.disabled = uploadInProgress
}

function renderAttachmentsPreview() {
  const wrap = document.getElementById('attachments-preview')
  if (!wrap) return
  if (pendingAttachments.length === 0) {
    wrap.style.display = 'none'
    wrap.innerHTML = ''
    return
  }
  wrap.style.display = 'flex'
  wrap.innerHTML = pendingAttachments
    .map((a, idx) => {
      const name = escapeHtml(a?.name || 'файл')
      return `<span class="attach-chip" data-idx="${idx}">
        <span class="name">${name}</span>
        <button type="button" class="remove" aria-label="Убрать">×</button>
      </span>`
    })
    .join('')

  wrap.querySelectorAll('.attach-chip .remove').forEach((btn) => {
    const chip = btn.closest('.attach-chip')
    const idx = Number(chip?.getAttribute('data-idx'))
    const handler = (e) => {
      e.preventDefault()
      if (!Number.isFinite(idx)) return
      pendingAttachments.splice(idx, 1)
      updateAttachButton()
      renderAttachmentsPreview()
    }
    btn.onclick = handler
    btn.addEventListener('touchstart', handler, { passive: false })
  })
}

function closeMsgMenu() {
  const menu = document.getElementById('msg-menu')
  if (!menu) return
  menu.style.display = 'none'
  activeMenuMessageId = null
}

function openMsgMenu(messageId) {
  const menu = document.getElementById('msg-menu')
  const pinBtn = document.getElementById('msg-menu-pin')
  const editBtn = document.getElementById('msg-menu-edit')
  const fwdBtn = document.getElementById('msg-menu-fwd')
  const delBtn = document.getElementById('msg-menu-del')
  if (!menu || !pinBtn || !editBtn || !fwdBtn || !delBtn) return

  activeMenuMessageId = messageId
  const msg = currentMessagesById.get(messageId)
  const pinned = !!msg?.is_pinned
  pinBtn.textContent = pinned ? 'Открепить' : 'Закрепить'

  const canDelete = msg && (Number(msg.sender_id) === Number(user.id) || user.role === 'admin')
  delBtn.style.display = canDelete ? 'inline-flex' : 'none'

  const isForwarded = String(msg?.content || '').trim().startsWith('↪')
  const canEdit = msg && !isForwarded && (Number(msg.sender_id) === Number(user.id) || user.role === 'admin')
  editBtn.style.display = canEdit ? 'inline-flex' : 'none'
  menu.style.display = 'flex'
}

function setDialogOpen(isOpen) {
  const layout = document.querySelector('.chat-layout')
  const backBtn = document.getElementById('back-to-dialogs')
  if (!layout || !backBtn) return
  layout.classList.toggle('chat--dialog-open', isOpen)
  backBtn.style.display = isOpen ? 'inline-flex' : 'none'
}

function closeDialogMenu() {
  const menu = document.getElementById('dialog-menu')
  if (!menu) return
  menu.style.display = 'none'
  activeMenuChannelId = null
}

function openDialogMenu(channelId) {
  const menu = document.getElementById('dialog-menu')
  if (!menu) return
  activeMenuChannelId = channelId
  menu.style.display = 'flex'
}

function closeForwardMenu() {
  const menu = document.getElementById('forward-menu')
  if (!menu) return
  menu.style.display = 'none'
  activeForwardMessageId = null
}

function openForwardMenu(messageId) {
  const menu = document.getElementById('forward-menu')
  const list = document.getElementById('forward-menu-list')
  if (!menu || !list) return
  activeForwardMessageId = messageId

  list.innerHTML = (channels || [])
    .map((ch) => {
      const title = escapeHtml(ch.name || (ch.type === 'general' ? 'Общий чат' : 'Личный чат'))
      return `<button type="button" class="fwd-to" data-id="${ch.id}" style="flex:unset;text-align:left">${title}</button>`
    })
    .join('')

  list.querySelectorAll('.fwd-to').forEach((btn) => {
    const handler = (e) => {
      e.preventDefault()
      forwardTo(Number(btn.getAttribute('data-id')))
    }
    btn.onclick = handler
    btn.addEventListener('touchstart', handler, { passive: false })
  })

  menu.style.display = 'flex'
}

function forwardPayload(original) {
  const atts = Array.isArray(original?.attachments) ? original.attachments : []
  const header = original?.sender_name ? `↪ ${original.sender_name}: ` : '↪ '
  const text = (original?.content || '').trim()
  return { content: (header + text).trim(), attachments: atts }
}

let forwardInFlight = false
function forwardTo(targetChannelId) {
  if (forwardInFlight) return
  if (!activeForwardMessageId || !Number.isFinite(targetChannelId)) return
  const msg = currentMessagesById.get(activeForwardMessageId)
  if (!msg) return
  forwardInFlight = true

  const payload = forwardPayload(msg)
  socket.emit('message:send', {
    channel_id: targetChannelId,
    content: payload.content,
    sender_id: user.id,
    sender_name: user.full_name,
    attachments: payload.attachments
  })

  closeForwardMenu()
  closeMsgMenu()
  setTimeout(() => {
    forwardInFlight = false
    loadChannels()
  }, 200)
}

function cancelEditMessage() {
  if (!editingMessageId) return
  const wrap = document.getElementById(`m-${editingMessageId}`)
  if (wrap && editingBackupHtml) {
    wrap.innerHTML = editingBackupHtml
  }
  editingMessageId = null
  editingBackupHtml = null
}

async function saveEditMessage(messageId, newContent) {
  const res = await fetch(`/api/chat/messages/${messageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: newContent })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    alert(json.error || `Не удалось изменить (HTTP ${res.status})`)
    return null
  }
  return json.data
}

function startEditMessage(messageId) {
  if (editingMessageId && editingMessageId !== messageId) cancelEditMessage()
  const msg = currentMessagesById.get(messageId)
  if (!msg) return
  if (String(msg.content || '').trim().startsWith('↪')) return

  const wrap = document.getElementById(`m-${messageId}`)
  if (!wrap) return

  const bubble = wrap.querySelector('.message-bubble')
  if (!bubble) return

  editingMessageId = messageId
  editingBackupHtml = wrap.innerHTML

  const originalText = String(msg.content || '')

  bubble.innerHTML = `
    <textarea class="message-edit" rows="2"></textarea>
    <div class="message-edit-actions">
      <button type="button" class="primary" data-act="save">Сохранить</button>
      <button type="button" data-act="cancel">Отмена</button>
    </div>
  `

  const ta = bubble.querySelector('textarea')
  ta.value = originalText
  // iOS: avoid scroll-jumps
  try {
    ta.focus({ preventScroll: true })
  } catch {
    ta.focus()
  }

  const actions = bubble.querySelector('.message-edit-actions')
  actions.addEventListener(
    'touchstart',
    async (e) => {
      const btn = e.target.closest('button')
      if (!btn) return
      e.preventDefault()
      const act = btn.getAttribute('data-act')
      if (act === 'cancel') {
        cancelEditMessage()
        return
      }
      if (act === 'save') {
        const nextText = ta.value.trim()
        if (!nextText) return
        btn.disabled = true
        const updated = await saveEditMessage(messageId, nextText)
        btn.disabled = false
        if (updated) {
          currentMessagesById.set(messageId, { ...msg, ...updated })
          // simplest: reload channel
          openChannel(activeChannelId, document.getElementById('chat-title')?.textContent || '')
        }
      }
    },
    { passive: false }
  )
}

socket.on('connect', () => {
  socket.emit('join', user.id)
})

socket.on('message:new', (message) => {
  if (message.channel_id === activeChannelId) {
    appendMessage(message)
    markAsRead(activeChannelId)
  } else {
    loadChannels()
  }
})

async function loadChannels() {
  const res = await fetch('/api/chat/channels', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json()
  channels = json.data || []
  renderDialogs()

  // Open requested direct chat (from schedule) once channels are loaded.
  const raw = sessionStorage.getItem('open_chat_channel')
  if (raw) {
    sessionStorage.removeItem('open_chat_channel')
    try {
      const data = JSON.parse(raw)
      if (data?.id) {
        openChannel(data.id, data.name || 'Личный чат')
      }
    } catch {}
  }
}

function renderDialogs() {
  const list = document.getElementById('dialogs-list')
  list.innerHTML = ''
  channels.forEach(ch => {
    const item = document.createElement('div')
    item.className = 'dialog-item' + (ch.id === activeChannelId ? ' active' : '')
    item.setAttribute('data-id', String(ch.id))
    item.setAttribute('data-type', ch.type)
    item.innerHTML = `
      <span class="dialog-name">${ch.name || 'Личный чат'}</span>
      ${ch.unread_count > 0 ? `<span class="dialog-unread">${ch.unread_count}</span>` : ''}
    `
    item.onclick = () => openChannel(ch.id, ch.name || 'Личный чат')
    list.appendChild(item)
  })
}

async function openChannel(channelId, name) {
  activeChannelId = channelId
  document.getElementById('chat-title').textContent = name
  socket.emit('channel:join', channelId)
  setDialogOpen(true)
  document.getElementById('search-results')?.classList.remove('show')

  const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json()
  const messages = (json.data || []).slice().reverse()
  currentMessagesById.clear()
  messages.forEach((m) => currentMessagesById.set(m.id, m))
  oldestLoadedMessageId = messages.length ? messages[0].id : null
  hasMoreHistory = messages.length === 50

  const area = document.getElementById('messages-area')
  area.innerHTML = ''

  if (hasMoreHistory) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Показать предыдущие'
    btn.style.cssText = 'align-self:center;border:1px solid #ddd;background:#fff;border-radius:10px;padding:8px 10px;font-size:12px'
    btn.onclick = loadOlderMessages
    area.appendChild(btn)
  }

  if (messages.length === 0) {
    area.innerHTML = '<div class="chat-empty">Нет сообщений — начните общение!</div>'
  } else {
    messages.forEach(m => appendMessage(m))
  }

  area.scrollTop = area.scrollHeight
  markAsRead(channelId)
  renderDialogs()
  renderPinnedBar(messages)
  closeMsgMenu()
  closeDialogMenu()
  closeForwardMenu()
}

async function loadOlderMessages() {
  if (!activeChannelId || !hasMoreHistory || !Number.isFinite(Number(oldestLoadedMessageId))) return
  const area = document.getElementById('messages-area')
  const firstBtn = area.querySelector('button')
  if (firstBtn) firstBtn.disabled = true

  const res = await fetch(`/api/chat/channels/${activeChannelId}/messages?before=${oldestLoadedMessageId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  const older = (json.data || []).slice().reverse()

  if (older.length === 0) {
    hasMoreHistory = false
    if (firstBtn) firstBtn.remove()
    return
  }

  oldestLoadedMessageId = older[0].id
  hasMoreHistory = older.length === 50

  // Remove "load older" button if no more.
  if (!hasMoreHistory && firstBtn) firstBtn.remove()
  if (firstBtn) firstBtn.disabled = false

  // Prepend older messages (after the "load older" button if present)
  const anchor = area.firstChild
  older.forEach((m) => {
    const div = document.createElement('div')
    appendMessageToContainer(div, m)
    area.insertBefore(div.firstChild, anchor?.nextSibling || anchor)
  })
}

function appendMessageToContainer(container, m) {
  const isMine = m.sender_id === user.id
  const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const editedMark = m.edited_at ? ' (ред.)' : ''
  const atts = Array.isArray(m.attachments) ? m.attachments : []
  const attsHtml = atts.length
    ? `<div class="message-attachments">
        ${atts
          .map((a) => {
            const url = a?.url || ''
            const name = escapeHtml(a?.name || 'файл')
            const mime = a?.mime || ''
            if (isImageMime(mime)) {
              return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}"></a>`
            }
            return `<a href="${url}" target="_blank" rel="noopener">${name}</a>`
          })
          .join('')}
      </div>`
    : ''

  const wrap = document.createElement('div')
  wrap.className = 'message ' + (isMine ? 'mine' : 'other')
  wrap.id = `m-${m.id}`
  wrap.setAttribute('data-id', String(m.id))
  wrap.setAttribute('data-pinned', m.is_pinned ? '1' : '0')
  wrap.innerHTML = `
    ${!isMine ? `<div class="message-author">${m.sender_name}</div>` : ''}
    <div class="message-bubble">${escapeHtml(m.content || '')}${attsHtml}</div>
    <div class="message-time">${time}${editedMark}</div>
  `
  container.appendChild(wrap)
}

function appendMessage(m) {
  const area = document.getElementById('messages-area')
  const empty = area.querySelector('.chat-empty')
  if (empty) empty.remove()
  if (m?.id) currentMessagesById.set(m.id, m)

  const container = document.createElement('div')
  appendMessageToContainer(container, m)
  area.appendChild(container.firstChild)
  area.scrollTop = area.scrollHeight
}

async function markAsRead(channelId) {
  await fetch(`/api/chat/channels/${channelId}/read`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  })
}

async function sendMessage() {
  const input = document.getElementById('message-input')
  const content = input.value.trim()
  if (uploadInProgress) return
  if ((!content && pendingAttachments.length === 0) || !activeChannelId) return

  socket.emit('message:send', {
    channel_id: activeChannelId,
    content,
    sender_id: user.id,
    sender_name: user.full_name,
    attachments: pendingAttachments
  })

  input.value = ''
  input.style.height = 'auto'
  pendingAttachments = []
  updateAttachButton()
  renderAttachmentsPreview()
  // keep keyboard open and avoid viewport jumps on iOS
  try {
    input.focus({ preventScroll: true })
  } catch {
    input.focus()
  }
}

const sendBtn = document.getElementById('send-btn')
sendBtn.onclick = sendMessage
// iOS (Safari/Chrome): когда открыта клавиатура, click по кнопке иногда «съедается».
sendBtn.addEventListener('touchend', (e) => {
  e.preventDefault()
  sendMessage()
})

async function togglePin(messageId, pinned) {
  if (!activeChannelId) return
  try {
    const res = await fetch(`/api/chat/messages/${messageId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pinned })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(json.error || `Не удалось закрепить (HTTP ${res.status})`)
      return { ok: false, error: json.error || String(res.status) }
    }

    // Optimistic UI update even if socket event is delayed/missed
    const row = json.data
    if (row?.id) {
      const prev = currentMessagesById.get(row.id) || { id: row.id, channel_id: row.channel_id }
      const next = { ...prev, ...row }
      currentMessagesById.set(row.id, next)
      const msgEl = document.getElementById(`m-${row.id}`)
      if (msgEl) msgEl.setAttribute('data-pinned', row.is_pinned ? '1' : '0')
      renderPinnedBarFromCache()
      closeMsgMenu()
      return { ok: true, data: row }
    }
    alert('Закрепление: сервер вернул неожиданный ответ')
    return { ok: false, error: 'bad_response' }
  } catch (e) {
    alert('Не удалось закрепить (сеть)')
    return { ok: false, error: 'network' }
  }
}

socket.on('message:pin', (payload) => {
  if (!payload || payload.channel_id !== activeChannelId) return
  const prev = currentMessagesById.get(payload.id) || { id: payload.id, channel_id: payload.channel_id }
  const next = { ...prev, is_pinned: !!payload.is_pinned, pinned_at: payload.pinned_at, pinned_by: payload.pinned_by }
  currentMessagesById.set(payload.id, next)
  const msgEl = document.getElementById(`m-${payload.id}`)
  if (msgEl) msgEl.setAttribute('data-pinned', payload.is_pinned ? '1' : '0')
  renderPinnedBarFromCache()
  closeMsgMenu()
})

socket.on('message:delete', (payload) => {
  if (!payload || payload.channel_id !== activeChannelId) return
  currentMessagesById.delete(payload.id)
  const el = document.getElementById(`m-${payload.id}`)
  if (el) el.remove()
  renderPinnedBarFromCache()
  closeMsgMenu()
})

socket.on('message:edit', (payload) => {
  if (!payload || payload.channel_id !== activeChannelId) return
  const prev = currentMessagesById.get(payload.id) || { id: payload.id, channel_id: payload.channel_id }
  currentMessagesById.set(payload.id, { ...prev, content: payload.content, edited_at: payload.edited_at, edited_by: payload.edited_by })
  if (activeChannelId) openChannel(activeChannelId, document.getElementById('chat-title')?.textContent || '')
})

const fileInput = document.getElementById('file-input')
const attachBtn = document.getElementById('attach-btn')
if (attachBtn && fileInput) {
  attachBtn.onclick = () => fileInput.click()
  attachBtn.addEventListener('touchend', (e) => {
    e.preventDefault()
    fileInput.click()
  })

  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || [])
    if (files.length === 0) return
    uploadInProgress = true
    updateAttachButton()
    const fd = new FormData()
    files.slice(0, 5).forEach((f) => fd.append('files', f))

    try {
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(json.error || 'Не удалось загрузить файл')
        return
      }
      pendingAttachments = json.data || []
    } catch (e) {
      alert('Не удалось загрузить файл (сеть)')
    } finally {
      uploadInProgress = false
      fileInput.value = ''
      updateAttachButton()
      renderAttachmentsPreview()
    }
  }
}

// Context menu (ПКМ) and long-press (mobile) for message actions (pin/unpin)
const messagesArea = document.getElementById('messages-area')

function closestMessageId(target) {
  const el = target?.closest?.('.message')
  if (!el) return null
  const id = Number(el.getAttribute('data-id'))
  return Number.isFinite(id) ? id : null
}

if (messagesArea) {
  messagesArea.addEventListener('contextmenu', (e) => {
    const id = closestMessageId(e.target)
    if (!id) return
    e.preventDefault()
    openMsgMenu(id)
  })

  // iOS Chrome: contextmenu почти всегда перехватывается браузером.
  // Поэтому открываем меню по долгому нажатию (long press).
  let lpTimer = null
  let lpFired = false
  const LP_MS = 450

  function clearLp() {
    if (lpTimer) clearTimeout(lpTimer)
    lpTimer = null
    lpFired = false
  }

  messagesArea.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches?.length !== 1) return
      const id = closestMessageId(e.target)
      if (!id) return
      clearLp()
      lpTimer = setTimeout(() => {
        lpFired = true
        openMsgMenu(id)
      }, LP_MS)
    },
    { passive: true }
  )

  // Если long press сработал — гасим последующие «клики» и т.п.
  messagesArea.addEventListener(
    'touchend',
    (e) => {
      if (lpFired) e.preventDefault()
      clearLp()
    },
    { passive: false }
  )
  messagesArea.addEventListener('touchcancel', clearLp, { passive: true })
  messagesArea.addEventListener('touchmove', clearLp, { passive: true })
}

const menuCancel = document.getElementById('msg-menu-cancel')
const menuPin = document.getElementById('msg-menu-pin')
const menuEdit = document.getElementById('msg-menu-edit')
const menuFwd = document.getElementById('msg-menu-fwd')
const menuDel = document.getElementById('msg-menu-del')
if (menuCancel) {
  menuCancel.onclick = closeMsgMenu
  menuCancel.addEventListener('touchend', (e) => {
    e.preventDefault()
    closeMsgMenu()
  })
}
if (menuPin) {
  const runPin = async (e) => {
    if (e) e.preventDefault()
    if (!activeMenuMessageId) return
    menuPin.disabled = true
    const prevText = menuPin.textContent
    menuPin.textContent = '...'
    const msg = currentMessagesById.get(activeMenuMessageId)
    await togglePin(activeMenuMessageId, !msg?.is_pinned)
    menuPin.textContent = prevText
    menuPin.disabled = false
  }
  // iOS: touchstart срабатывает надёжнее touchend/click
  menuPin.onclick = runPin
  menuPin.addEventListener('touchstart', runPin, { passive: false })
  menuPin.addEventListener('touchend', runPin, { passive: false })
  menuPin.addEventListener('pointerup', runPin)
}
if (menuEdit) {
  const run = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation?.()
    }
    if (!activeMenuMessageId) return
    startEditMessage(activeMenuMessageId)
    closeMsgMenu()
  }
  menuEdit.onclick = run
  menuEdit.addEventListener('touchstart', run, { passive: false })
}
if (menuFwd) {
  const run = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation?.()
    }
    if (!activeMenuMessageId) return
    openForwardMenu(activeMenuMessageId)
  }
  menuFwd.onclick = run
  menuFwd.addEventListener('touchstart', run, { passive: false })
}
if (menuDel) {
  let inFlight = false
  const runDel = async (e) => {
    if (e) e.preventDefault()
    if (e?.stopPropagation) e.stopPropagation()
    if (inFlight) return
    if (!activeMenuMessageId) return
    const msg = currentMessagesById.get(activeMenuMessageId)
    const canDelete = msg && (Number(msg.sender_id) === Number(user.id) || user.role === 'admin')
    if (!canDelete) return
    inFlight = true
    if (!confirm('Удалить сообщение?')) {
      inFlight = false
      return
    }
    menuDel.disabled = true
    const prevText = menuDel.textContent
    menuDel.textContent = '...'
    try {
      const res = await fetch(`/api/chat/messages/${activeMenuMessageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(json.error || `Не удалось удалить (HTTP ${res.status})`)
        return
      }
      // optimistic UI update even if socket is delayed
      currentMessagesById.delete(activeMenuMessageId)
      const el = document.getElementById(`m-${activeMenuMessageId}`)
      if (el) el.remove()
      renderPinnedBarFromCache()
      closeMsgMenu()
    } catch {
      alert('Не удалось удалить (сеть)')
    } finally {
      menuDel.textContent = prevText
      menuDel.disabled = false
      inFlight = false
    }
  }
  // Desktop
  menuDel.onclick = runDel
  // iOS: используем только touchstart, чтобы не получать дубли (touchend/click).
  menuDel.addEventListener('touchstart', runDel, { passive: false })
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('msg-menu')
  if (!menu || menu.style.display === 'none') return
  if (menu.contains(e.target)) return
  closeMsgMenu()
})

document.addEventListener('click', (e) => {
  const menu = document.getElementById('dialog-menu')
  if (!menu || menu.style.display === 'none') return
  if (menu.contains(e.target)) return
  closeDialogMenu()
})

document.addEventListener('click', (e) => {
  const menu = document.getElementById('forward-menu')
  if (!menu || menu.style.display === 'none') return
  if (menu.contains(e.target)) return
  closeForwardMenu()
})

updateAttachButton()

// Dialog context menu (delete direct chats)
const dialogsList = document.getElementById('dialogs-list')
function closestDialogEl(target) {
  return target?.closest?.('.dialog-item')
}
function dialogMeta(el) {
  if (!el) return null
  const id = Number(el.getAttribute('data-id'))
  const type = el.getAttribute('data-type')
  if (!Number.isFinite(id)) return null
  return { id, type }
}

if (dialogsList) {
  // Right-click on desktop
  dialogsList.addEventListener('contextmenu', (e) => {
    const el = closestDialogEl(e.target)
    const meta = dialogMeta(el)
    if (!meta) return
    if (meta.type !== 'direct') return
    e.preventDefault()
    openDialogMenu(meta.id)
  })

  // Long-press on mobile (iOS Chrome)
  let lpTimer = null
  let lpFired = false
  const LP_MS = 450
  function clearLp() {
    if (lpTimer) clearTimeout(lpTimer)
    lpTimer = null
    lpFired = false
  }
  dialogsList.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches?.length !== 1) return
      const el = closestDialogEl(e.target)
      const meta = dialogMeta(el)
      if (!meta || meta.type !== 'direct') return
      clearLp()
      lpTimer = setTimeout(() => {
        lpFired = true
        openDialogMenu(meta.id)
      }, LP_MS)
    },
    { passive: true }
  )
  dialogsList.addEventListener(
    'touchend',
    (e) => {
      if (lpFired) e.preventDefault()
      clearLp()
    },
    { passive: false }
  )
  dialogsList.addEventListener('touchcancel', clearLp, { passive: true })
  dialogsList.addEventListener('touchmove', clearLp, { passive: true })
}

const dialogMenuCancel = document.getElementById('dialog-menu-cancel')
const dialogMenuDel = document.getElementById('dialog-menu-del')
if (dialogMenuCancel) {
  dialogMenuCancel.onclick = closeDialogMenu
  dialogMenuCancel.addEventListener('touchend', (e) => {
    e.preventDefault()
    closeDialogMenu()
  })
}
if (dialogMenuDel) {
  let inFlight = false
  const run = async (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation?.()
    }
    if (inFlight) return
    if (!activeMenuChannelId) return
    inFlight = true
    if (!confirm('Удалить чат? Он исчезнет у обоих участников.')) {
      inFlight = false
      return
    }
    dialogMenuDel.disabled = true
    const prevText = dialogMenuDel.textContent
    dialogMenuDel.textContent = '...'
    try {
      const res = await fetch(`/api/chat/channels/${activeMenuChannelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.status !== 204) {
        const json = await res.json().catch(() => ({}))
        alert(json.error || `Не удалось удалить (HTTP ${res.status})`)
        return
      }
      // refresh list; if we deleted active chat, go back
      if (activeChannelId === activeMenuChannelId) {
        activeChannelId = null
        document.getElementById('chat-title').textContent = ''
        document.getElementById('messages-area').innerHTML = ''
        setDialogOpen(false)
      }
      closeDialogMenu()
      await loadChannels()
    } catch {
      alert('Не удалось удалить (сеть)')
    } finally {
      dialogMenuDel.textContent = prevText
      dialogMenuDel.disabled = false
      inFlight = false
    }
  }
  // Desktop
  dialogMenuDel.onclick = run
  // iOS: используем только touchstart, чтобы не получать дубли (touchend/click).
  dialogMenuDel.addEventListener('touchstart', run, { passive: false })
}

const forwardCancel = document.getElementById('forward-menu-cancel')
if (forwardCancel) {
  forwardCancel.onclick = closeForwardMenu
  forwardCancel.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault()
      closeForwardMenu()
    },
    { passive: false }
  )
}

document.getElementById('message-input').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

document.getElementById('message-input').oninput = function() {
  this.style.height = 'auto'
  this.style.height = Math.min(this.scrollHeight, 80) + 'px'
}

let searchTimeout
document.getElementById('user-search').oninput = async function() {
  clearTimeout(searchTimeout)
  const q = this.value.trim()
  const results = document.getElementById('search-results')

  if (!q) {
    results.classList.remove('show')
    return
  }

  searchTimeout = setTimeout(async () => {
    await fetchAndShowUsers(q)
  }, 250)
}

document.getElementById('user-search').onfocus = async function() {
  // On tap: show list even without typing (messenger-like)
  const q = this.value.trim()
  if (!q) {
    await fetchAndShowUsers('')
  }
}

async function fetchAndShowUsers(query) {
  const results = document.getElementById('search-results')
  const q = (query ?? '').trim()
  const res = await fetch(`/api/chat/users?search=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  const users = json.data || []

  results.innerHTML = users
    .map((u) => `<div class="search-result-item" data-id="${u.id}" data-name="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</div>`)
    .join('')

  results.classList.toggle('show', users.length > 0)

  results.querySelectorAll('.search-result-item').forEach((item) => {
    item.onclick = async () => {
      results.classList.remove('show')
      document.getElementById('user-search').value = ''

      const res = await fetch('/api/chat/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ user_id: parseInt(item.dataset.id) })
      })
      const json = await res.json()
      await loadChannels()
      openChannel(json.data.id, item.dataset.name)
      // After user selection (gesture), focus message input so keyboard appears.
      setTimeout(() => document.getElementById('message-input')?.focus(), 0)
    }
  })
}

const plusBtn = document.getElementById('open-user-picker')
if (plusBtn) {
  plusBtn.onclick = async () => {
    document.getElementById('user-search').value = ''
    await fetchAndShowUsers('')
  }
  plusBtn.addEventListener('touchend', async (e) => {
    e.preventDefault()
    document.getElementById('user-search').value = ''
    await fetchAndShowUsers('')
  })
}

loadChannels()

document.getElementById('back-to-dialogs').onclick = () => {
  activeChannelId = null
  document.getElementById('chat-title').textContent = ''
  document.getElementById('messages-area').innerHTML = ''
  setDialogOpen(false)
  renderDialogs()
}