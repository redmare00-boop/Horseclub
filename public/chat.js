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
  bar.innerHTML = `📌 <span style="font-weight:500">Закреплено:</span> <a href="#m-${last.id}">${escapeHtml(text).slice(0, 80)}</a>`
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

function closeMsgMenu() {
  const menu = document.getElementById('msg-menu')
  if (!menu) return
  menu.style.display = 'none'
  activeMenuMessageId = null
}

function openMsgMenu(messageId) {
  const menu = document.getElementById('msg-menu')
  const pinBtn = document.getElementById('msg-menu-pin')
  if (!menu || !pinBtn) return

  activeMenuMessageId = messageId
  const msg = currentMessagesById.get(messageId)
  const pinned = !!msg?.is_pinned
  pinBtn.textContent = pinned ? '📌 Открепить' : '📌 Закрепить'
  menu.style.display = 'flex'
}

function setDialogOpen(isOpen) {
  const layout = document.querySelector('.chat-layout')
  const backBtn = document.getElementById('back-to-dialogs')
  if (!layout || !backBtn) return
  layout.classList.toggle('chat--dialog-open', isOpen)
  backBtn.style.display = isOpen ? 'inline-flex' : 'none'
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

  const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json()
  const messages = json.data || []
  currentMessagesById.clear()
  messages.forEach((m) => currentMessagesById.set(m.id, m))

  const area = document.getElementById('messages-area')
  area.innerHTML = ''

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
}

function appendMessage(m) {
  const area = document.getElementById('messages-area')
  const empty = area.querySelector('.chat-empty')
  if (empty) empty.remove()
  if (m?.id) currentMessagesById.set(m.id, m)

  const isMine = m.sender_id === user.id
  const time = new Date(m.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit'
  })

  const div = document.createElement('div')
  div.className = 'message ' + (isMine ? 'mine' : 'other')
  div.id = `m-${m.id}`
  div.setAttribute('data-id', String(m.id))
  div.setAttribute('data-pinned', m.is_pinned ? '1' : '0')

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

  div.innerHTML = `
    ${!isMine ? `<div class="message-author">${m.sender_name}</div>` : ''}
    <div class="message-bubble">${escapeHtml(m.content || '')}${attsHtml}</div>
    <div class="message-time">${time}</div>
  `
  area.appendChild(div)
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
    menuPin.textContent = '⏳'
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

document.addEventListener('click', (e) => {
  const menu = document.getElementById('msg-menu')
  if (!menu || menu.style.display === 'none') return
  if (menu.contains(e.target)) return
  closeMsgMenu()
})

updateAttachButton()

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
    const res = await fetch(`/api/chat/users?search=${q}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const json = await res.json()
    const users = json.data || []

    results.innerHTML = users.map(u =>
      `<div class="search-result-item" data-id="${u.id}" data-name="${u.full_name}">${u.full_name}</div>`
    ).join('')

    results.classList.toggle('show', users.length > 0)

    results.querySelectorAll('.search-result-item').forEach(item => {
      item.onclick = async () => {
        results.classList.remove('show')
        document.getElementById('user-search').value = ''

        const res = await fetch('/api/chat/channels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ user_id: parseInt(item.dataset.id) })
        })
        const json = await res.json()
        await loadChannels()
        openChannel(json.data.id, item.dataset.name)
      }
    })
  }, 300)
}

loadChannels()

document.getElementById('back-to-dialogs').onclick = () => {
  activeChannelId = null
  document.getElementById('chat-title').textContent = 'Выберите чат'
  document.getElementById('messages-area').innerHTML = ''
  setDialogOpen(false)
  renderDialogs()
}