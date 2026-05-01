const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) {
  window.location.href = '/login.html'
}
if (user?.must_change_password) {
  window.location.href = '/change-password.html'
}

// Confirm logout (chat page has no logout button, but keep utility for reuse if added later)

const socket = io()
let activeChannelId = null
let channels = []
let allChannels = []
let pendingAttachments = []
let uploadInProgress = false
const currentMessagesById = new Map()
const userProfileCache = new Map()
let tooltipEl = null
let activeMenuMessageId = null
let activeMenuChannelId = null
let activeForwardMessageId = null
let editingMessageId = null
let editingBackupHtml = null
let oldestLoadedMessageId = null
let hasMoreHistory = true

let scopePending = null // { type: 'pin'|'delete_message'|'delete_chat', messageId?, channelId?, pinned? }

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function resetViewportScale() {
  // iOS sometimes keeps zoom after focusing inputs; this forces scale back to 1.
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  const base = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no'
  try {
    meta.setAttribute('content', base)
    // Force reflow/refresh of viewport settings
    setTimeout(() => meta.setAttribute('content', base), 50)
  } catch {}
}

function openCopyModal(text) {
  const modal = document.getElementById('copy-modal')
  const ta = document.getElementById('copy-text')
  if (!modal || !ta) {
    // last resort
    prompt('Скопируйте текст:', text)
    return
  }
  ta.value = String(text || '')
  modal.style.display = 'flex'
  // iOS: select text for quick copy
  setTimeout(() => {
    try {
      ta.focus({ preventScroll: true })
    } catch {
      try { ta.focus() } catch {}
    }
    try {
      ta.setSelectionRange(0, ta.value.length)
    } catch {
      try { ta.select() } catch {}
    }
  }, 50)
}

function closeCopyModal() {
  const modal = document.getElementById('copy-modal')
  if (modal) modal.style.display = 'none'
}

async function tryCopyText(text) {
  const t = String(text || '')
  if (!t) return false
  // 1) Clipboard API (secure contexts)
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t)
      return true
    }
  } catch {}
  // 2) execCommand fallback
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return !!ok
  } catch {}
  return false
}

function initials(nameOrNick) {
  const s = String(nameOrNick || '').trim()
  if (!s) return '?'
  const parts = s.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] || '?'
  const b = (parts[1]?.[0] || '')
  return (a + b).toUpperCase()
}

function normalizePhoneForTel(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  // keep leading +, remove spaces/brackets/dashes
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '+' && out.length === 0) { out += ch; continue }
    if (ch >= '0' && ch <= '9') out += ch
  }
  return out
}

async function ensureDirectChatWith(userId, displayName) {
  const res = await fetch('/api/chat/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  try {
    sessionStorage.setItem('open_chat_channel', JSON.stringify({ id: json.data?.id, name: displayName || json.data?.name || 'Личный чат' }))
  } catch {}
  window.location.href = '/chat.html'
}

async function getUserProfile(userId) {
  const id = Number(userId)
  if (!Number.isFinite(id)) return null
  if (userProfileCache.has(id)) return userProfileCache.get(id)
  try {
    const res = await fetch(`/api/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errText = json?.error || `HTTP ${res.status}`
      return { __error: errText, __status: res.status }
    }
    userProfileCache.set(id, json.data)
    return json.data
  } catch {
    return { __error: 'сеть', __status: 0 }
  }
}

function ensureTooltip() {
  if (tooltipEl) return tooltipEl
  tooltipEl = document.createElement('div')
  tooltipEl.className = 'user-tooltip'
  document.body.appendChild(tooltipEl)
  return tooltipEl
}

function showTooltipAt(rect, html) {
  const el = ensureTooltip()
  el.innerHTML = html
  const pad = 10
  const vw = window.innerWidth
  const vh = window.innerHeight
  el.style.display = 'block'
  const w = el.offsetWidth
  const h = el.offsetHeight
  let left = rect.left + rect.width / 2 - w / 2
  let top = rect.top - h - 10
  if (left < pad) left = pad
  if (left + w > vw - pad) left = vw - pad - w
  if (top < pad) top = rect.bottom + 10
  if (top + h > vh - pad) top = vh - pad - h
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

function hideTooltip() {
  if (!tooltipEl) return
  tooltipEl.style.display = 'none'
}

async function openUserCard(userId) {
  const modal = document.getElementById('user-card-modal')
  const body = document.getElementById('user-card-body')
  const title = document.getElementById('user-card-title')
  if (!modal || !body || !title) return

  body.innerHTML = '<div style="color:#999;font-size:13px">Загрузка...</div>'
  modal.style.display = 'flex'

  const p = await getUserProfile(userId)
  if (!p || p.__error) {
    const hint = p?.__error ? escapeHtml(p.__error) : 'неизвестно'
    body.innerHTML = `<div class="login-error">Не удалось загрузить профиль (${hint})</div>`
    return
  }

  const ava = String(p.avatar_url || '').trim()
  const horses = Array.isArray(p.horses) ? p.horses : []
  const isDeleted = !!p.deleted
  const isSelf = Number(user?.id) === Number(userId)
  const displayName = String(p.full_name || p.nickname || p.login || '').trim()
  title.textContent = p.nickname ? `@${p.nickname}` : 'Профиль'

  const phone = String(p.phone || '').trim()
  const tel = normalizePhoneForTel(phone)
  const phoneHtml = (isDeleted || !phone)
    ? `<div style="color:#999;font-size:13px">${isDeleted ? 'Аккаунт удалён' : 'Телефон не указан'}</div>`
    : (isSelf
      ? `<div style="color:#666;font-size:13px">${escapeHtml(phone)}</div>`
      : `<a href="tel:${escapeHtml(tel || phone)}" class="user-card-phone" id="user-card-phone">${escapeHtml(phone)}</a>`)

  body.innerHTML = `
    <div class="user-card-modal-top">
      <div class="ava">${ava ? `<img src="${escapeHtml(ava)}" alt="">` : escapeHtml(initials(p.nickname || p.full_name || p.login))}</div>
      <div>
        <div class="name">${escapeHtml(isDeleted ? 'Удаленный аккаунт' : (p.nickname || p.full_name || p.login || ''))}</div>
        <div class="meta">
          ${(!isDeleted && p.status) ? `<span class="user-status">${escapeHtml(p.status)}</span>` : ''}
          ${!isDeleted ? `<span style="color:#999">@${escapeHtml(p.login || '')}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="user-card-modal-row"><span style="color:#999">Лошади:</span> ${(!isDeleted && horses.length) ? escapeHtml(horses.join(', ')) : '—'}</div>
    <div class="user-card-modal-row"><span style="color:#999">Телефон:</span><div style="margin-top:6px">${phoneHtml}</div></div>
    <div class="user-card-modal-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
      ${isSelf ? '' : `<button type="button" class="btn-ghost" id="user-card-chat" style="padding:8px 10px;border-radius:10px">Написать в чат</button>`}
    </div>
  `

  const phoneEl = document.getElementById('user-card-phone')
  if (phoneEl) {
    phoneEl.addEventListener('click', (e) => {
      e.preventDefault()
      if (confirm(`Позвонить ${phone}?`)) {
        window.location.href = `tel:${tel || phone}`
      }
    })
  }

  const chatBtn = document.getElementById('user-card-chat')
  if (chatBtn && !isSelf) {
    chatBtn.addEventListener('click', async (e) => {
      e.preventDefault()
      try {
        await ensureDirectChatWith(Number(userId), displayName)
      } catch (err) {
        alert(`Не удалось открыть чат: ${escapeHtml(err?.message || 'ошибка')}`)
      }
    })
  }
}

function closeUserCard() {
  const modal = document.getElementById('user-card-modal')
  if (modal) modal.style.display = 'none'
}

function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}

function renderPinnedBar(messages) {
  const bar = document.getElementById('pinned-bar')
  if (!bar) return
  const pinned = (messages || []).filter((m) => m?.is_pinned || m?.my_pinned)
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
  if (uploadInProgress) {
    btn.textContent = '...'
    btn.disabled = true
    return
  }
  const icon = `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7.1-7.1L14.6 3.7a3.5 3.5 0 1 1 5 5L10 18.3a2 2 0 1 1-2.8-2.8l8.6-8.6"></path>
    </svg>
  `
  btn.innerHTML = icon + (count > 0 ? `<span class="attach-count">${count}</span>` : '')
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

function closeScopeMenu() {
  const menu = document.getElementById('scope-menu')
  if (!menu) return
  menu.style.display = 'none'
  scopePending = null
}

function openScopeMenu(pending) {
  const menu = document.getElementById('scope-menu')
  if (!menu) return
  scopePending = pending
  menu.style.display = 'flex'
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
  const pinned = !!msg?.is_pinned || !!msg?.my_pinned
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
  updateComposerVisibility(isOpen)
}

function updateComposerVisibility(isDialogOpen) {
  const composer = document.getElementById('composer')
  const preview = document.getElementById('attachments-preview')
  if (composer) composer.style.display = isDialogOpen ? 'flex' : 'none'
  if (!isDialogOpen) {
    pendingAttachments = []
    updateAttachButton()
    renderAttachmentsPreview()
    if (preview) preview.style.display = 'none'
  }
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
  allChannels = json.data || []
  channels = allChannels
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
    if (ch.other_user_id) item.setAttribute('data-other', String(ch.other_user_id))
    const title = ch.name || (ch.type === 'general' ? 'Общий чат' : 'Личный чат')
    const otherId = Number(ch.other_user_id)
    const isDeleted = !!ch.other_deleted
    const otherAva = String(ch.other_avatar_url || '').trim()
    const avaHtml = (ch.type === 'direct')
      ? `<span class="dialog-ava${isDeleted ? ' deleted' : ''}" data-user="${Number.isFinite(otherId) ? otherId : ''}">${
          isDeleted
            ? '✕'
            : (otherAva ? `<img src="${escapeHtml(otherAva)}" alt="">` : escapeHtml(initials(title)))
        }</span>`
      : `<span class="dialog-ava">#</span>`
    item.innerHTML = `
      <span class="dialog-left">
        ${avaHtml}
        <span class="dialog-name">${escapeHtml(title)}</span>
      </span>
      ${ch.unread_count > 0 ? `<span class="dialog-unread">${ch.unread_count}</span>` : ''}
    `
    item.onclick = (e) => {
      // iPhone: a tap on avatar often becomes a synthetic click on the row.
      // So we explicitly ignore clicks that originated from the avatar.
      if (e?.target?.closest?.('.dialog-ava')) return
      openChannel(ch.id, ch.name || 'Личный чат')
    }
    list.appendChild(item)

    // tooltip + open card on avatar click (NOT on name)
    if (ch.type === 'direct' && Number.isFinite(otherId)) {
      const avaEl = item.querySelector('.dialog-ava')
      if (avaEl) {
        const show = async () => {
          if (isDeleted) {
            showTooltipAt(avaEl.getBoundingClientRect(), `<div class="t-title">Удаленный аккаунт</div>`)
            return
          }
          const p = await getUserProfile(otherId)
          if (!p) return
          const horses = Array.isArray(p.horses) ? p.horses : []
          const html = `
            <div class="t-title">${escapeHtml(p.nickname || p.full_name || p.login || '')}</div>
            <div class="t-sub">${p.status ? escapeHtml(p.status) : ''}${(p.status && horses.length) ? ' · ' : ''}${horses.length ? `лошади: ${escapeHtml(horses.join(', '))}` : ''}</div>
          `
          showTooltipAt(avaEl.getBoundingClientRect(), html)
        }

        avaEl.addEventListener('mouseenter', show)
        avaEl.addEventListener('mouseleave', hideTooltip)

        avaEl.addEventListener('click', async (e) => {
          e.preventDefault()
          e.stopPropagation()
          hideTooltip()
          await openUserCard(otherId)
        })
      }
    }
  })
}

async function openChannel(channelId, name) {
  activeChannelId = channelId
  const titleEl = document.getElementById('chat-title')
  if (titleEl) {
    titleEl.textContent = name
    const ch = allChannels.find((c) => c.id === channelId)
    const otherId = Number(ch?.other_user_id)
    titleEl.setAttribute('data-user', ch?.type === 'direct' && Number.isFinite(otherId) ? String(otherId) : '')
  }
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
  const senderDeleted = !!m.sender_deleted
  const senderAva = String(m.sender_avatar_url || '').trim()
  const senderName = senderDeleted ? 'Удаленный аккаунт' : String(m.sender_name || '')
  wrap.innerHTML = `
    ${!isMine ? `<div class="message-author">${escapeHtml(senderName)}</div>` : ''}
    <div class="message-row">
      ${!isMine ? `<div class="msg-avatar${senderDeleted ? ' deleted' : ''}" data-user="${Number(m.sender_id)}">${
        senderDeleted ? '✕' : (senderAva ? `<img src="${escapeHtml(senderAva)}" alt="">` : escapeHtml(initials(senderName)))
      }</div>` : ''}
      <div class="message-bubble">${escapeHtml(m.content || '')}${attsHtml}</div>
    </div>
    <div class="message-time">${time}${editedMark}</div>
  `
  container.appendChild(wrap)

  if (!isMine) {
    const senderId = Number(m.sender_id)
    const avaEl = wrap.querySelector('.msg-avatar')
    if (avaEl && Number.isFinite(senderId)) {
      avaEl.addEventListener('mouseenter', async () => {
        if (senderDeleted) {
          showTooltipAt(avaEl.getBoundingClientRect(), `<div class="t-title">Удаленный аккаунт</div>`)
          return
        }
        const p = await getUserProfile(senderId)
        if (!p) return
        const horses = Array.isArray(p.horses) ? p.horses : []
        const html = `
          <div class="t-title">${escapeHtml(p.nickname || p.full_name || p.login || '')}</div>
          <div class="t-sub">${p.status ? escapeHtml(p.status) : ''}${(p.status && horses.length) ? ' · ' : ''}${horses.length ? `лошади: ${escapeHtml(horses.join(', '))}` : ''}</div>
        `
        showTooltipAt(avaEl.getBoundingClientRect(), html)
      })
      avaEl.addEventListener('mouseleave', hideTooltip)
      avaEl.addEventListener('click', async (e) => {
        e.preventDefault()
        hideTooltip()
        await openUserCard(senderId)
      })
      avaEl.addEventListener(
        'touchstart',
        async (e) => {
          e.preventDefault()
          hideTooltip()
          await openUserCard(senderId)
        },
        { passive: false }
      )
    }
  }
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
  // After sending, close keyboard and reset iOS zoom.
  try { input.blur() } catch {}
  resetViewportScale()
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
      body: JSON.stringify({ pinned, scope: 'all' })
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
      if (msgEl) msgEl.setAttribute('data-pinned', (row.is_pinned || row.my_pinned) ? '1' : '0')
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

async function togglePinScoped(messageId, pinned, scope) {
  if (!activeChannelId) return
  try {
    const res = await fetch(`/api/chat/messages/${messageId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pinned, scope })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(json.error || `Не удалось закрепить (HTTP ${res.status})`)
      return
    }
    const row = json.data
    if (row?.id) {
      const prev = currentMessagesById.get(row.id) || { id: row.id, channel_id: row.channel_id }
      currentMessagesById.set(row.id, { ...prev, ...row })
      renderPinnedBarFromCache()
    }
  } catch {
    alert('Не удалось закрепить (сеть)')
  }
}

async function deleteMessageScoped(messageId, scope) {
  try {
    const res = await fetch(`/api/chat/messages/${messageId}?scope=${encodeURIComponent(scope)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(json.error || `Не удалось удалить (HTTP ${res.status})`)
      return
    }
    currentMessagesById.delete(messageId)
    const el = document.getElementById(`m-${messageId}`)
    if (el) el.remove()
    renderPinnedBarFromCache()
  } catch {
    alert('Не удалось удалить (сеть)')
  }
}

async function deleteChatScoped(channelId, scope) {
  try {
    const res = await fetch(`/api/chat/channels/${channelId}?scope=${encodeURIComponent(scope)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 204) {
      const json = await res.json().catch(() => ({}))
      alert(json.error || `Не удалось удалить (HTTP ${res.status})`)
      return
    }
    if (activeChannelId === channelId) {
      activeChannelId = null
      document.getElementById('chat-title').textContent = ''
      document.getElementById('messages-area').innerHTML = ''
      setDialogOpen(false)
    }
    await loadChannels()
  } catch {
    alert('Не удалось удалить (сеть)')
  }
}

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
  async function copyActiveMessage() {
    if (!activeMenuMessageId) return
    const msg = currentMessagesById.get(activeMenuMessageId)
    const text = String(msg?.content || '').trim()
    if (!text) {
      closeMsgMenu()
      return
    }
    const copied = await tryCopyText(text)
    closeMsgMenu()
    if (copied) return
    openCopyModal(text)
  }
  menuCancel.onclick = (e) => {
    e?.preventDefault?.()
    copyActiveMessage()
  }
  menuCancel.addEventListener('touchstart', (e) => {
    e.preventDefault()
    copyActiveMessage()
  }, { passive: false })
}
if (menuPin) {
  const runPin = async (e) => {
    if (e) e.preventDefault()
    if (!activeMenuMessageId) return
    const messageId = activeMenuMessageId
    const msg = currentMessagesById.get(messageId)
    const currentlyPinned = !!msg?.is_pinned || !!msg?.my_pinned
    closeMsgMenu()
    openScopeMenu({ type: 'pin', messageId, pinned: !currentlyPinned })
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
    const messageId = activeMenuMessageId
    const msg = currentMessagesById.get(messageId)
    const canDelete = msg && (Number(msg.sender_id) === Number(user.id) || user.role === 'admin')
    if (!canDelete) return
    inFlight = true
    closeMsgMenu()
    openScopeMenu({ type: 'delete_message', messageId })
    inFlight = false
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

document.addEventListener('click', (e) => {
  const menu = document.getElementById('scope-menu')
  if (!menu || menu.style.display === 'none') return
  if (menu.contains(e.target)) return
  closeScopeMenu()
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
  // iPhone: reliably open user card on avatar tap (not the row).
  let suppressNextRowClick = false

  dialogsList.addEventListener(
    'touchstart',
    async (e) => {
      const ava = e.target?.closest?.('.dialog-ava')
      if (!ava) return
      const userId = Number(ava.getAttribute('data-user'))
      if (!Number.isFinite(userId)) return
      suppressNextRowClick = true
      e.preventDefault()
      e.stopPropagation()
      hideTooltip()
      await openUserCard(userId)
    },
    { passive: false, capture: true }
  )

  dialogsList.addEventListener(
    'click',
    (e) => {
      if (!suppressNextRowClick) return
      const ava = e.target?.closest?.('.dialog-ava')
      if (!ava) return
      e.preventDefault()
      e.stopPropagation()
      suppressNextRowClick = false
    },
    true
  )

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
    closeDialogMenu()
    openScopeMenu({ type: 'delete_chat', channelId: activeMenuChannelId })
    inFlight = false
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

// Copy modal controls
const copyClose = document.getElementById('copy-close')
const copyDone = document.getElementById('copy-done')
const copyModal = document.getElementById('copy-modal')
if (copyClose) copyClose.onclick = closeCopyModal
if (copyDone) copyDone.onclick = closeCopyModal
if (copyModal) {
  copyModal.addEventListener('click', (e) => {
    if (e.target === copyModal) closeCopyModal()
  })
}

// Scope menu actions ("у меня" / "у всех")
const scopeCancel = document.getElementById('scope-cancel')
const scopeMe = document.getElementById('scope-me')
const scopeAll = document.getElementById('scope-all')
if (scopeCancel) {
  scopeCancel.onclick = closeScopeMenu
  scopeCancel.addEventListener('touchstart', (e) => { e.preventDefault(); closeScopeMenu() }, { passive: false })
}
if (scopeMe) {
  let lastTouch = 0
  const run = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation?.()
    }
    runScope('me')
  }
  scopeMe.addEventListener('touchstart', (e) => { lastTouch = Date.now(); run(e) }, { passive: false })
  scopeMe.addEventListener('click', (e) => {
    if (Date.now() - lastTouch < 800) return
    run(e)
  })
}
if (scopeAll) {
  let lastTouch = 0
  const run = (e) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation?.()
    }
    runScope('all')
  }
  scopeAll.addEventListener('touchstart', (e) => { lastTouch = Date.now(); run(e) }, { passive: false })
  scopeAll.addEventListener('click', (e) => {
    if (Date.now() - lastTouch < 800) return
    run(e)
  })
}

async function runScope(scope) {
  if (!scopePending) return
  const pending = scopePending
  closeScopeMenu()
  if (pending.type === 'pin') return togglePinScoped(pending.messageId, pending.pinned, scope)
  if (pending.type === 'delete_message') {
    const label = scope === 'me' ? 'Удалить сообщение у меня?' : 'Удалить сообщение у всех?'
    if (!confirm(label)) return
    return deleteMessageScoped(pending.messageId, scope)
  }
  if (pending.type === 'delete_chat') {
    const label = scope === 'me'
      ? 'Удалить чат у меня?'
      : 'Удалить чат у всех? Он исчезнет у обоих участников.'
    if (!confirm(label)) return
    return deleteChatScoped(pending.channelId, scope)
  }
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
    await fetchAndShowSearch(q)
  }, 250)
}

document.getElementById('user-search').onfocus = async function() {
  // On tap: invite user to type a name/word/phrase (no dropdown by default)
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

async function fetchAndShowSearch(query) {
  const results = document.getElementById('search-results')
  const q = (query ?? '').trim()
  if (!q) {
    results.classList.remove('show')
    results.innerHTML = ''
    return
  }

  const res = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    results.classList.remove('show')
    return
  }

  const users = json.data?.users || []
  const messages = json.data?.messages || []

  const parts = []
  if (users.length) {
    parts.push(`<div class="search-section">По имени</div>`)
    parts.push(
      users
        .map(
          (u) =>
            `<div class="search-result-item" data-kind="user" data-id="${u.id}" data-name="${escapeHtml(u.full_name)}">${escapeHtml(u.full_name)}</div>`
        )
        .join('')
    )
  }
  if (messages.length) {
    parts.push(`<div class="search-section">По содержимому</div>`)
    parts.push(
      messages
        .map((m) => {
          const title = escapeHtml(m.channel_name || 'Чат')
          const snippet = escapeHtml(String(m.content || '').slice(0, 90))
          return `<div class="search-result-item" data-kind="msg" data-id="${m.id}" data-channel="${m.channel_id}">
            ${snippet}
            <span class="meta">${title}</span>
          </div>`
        })
        .join('')
    )
  }

  results.innerHTML = parts.length ? parts.join('') : `<div class="search-section">Ничего не найдено</div>`
  results.classList.add('show')

  results.querySelectorAll('.search-result-item').forEach((item) => {
    item.onclick = async () => {
      const kind = item.getAttribute('data-kind')
      if (kind === 'user') {
        const userId = parseInt(item.getAttribute('data-id'), 10)
        const name = item.getAttribute('data-name') || ''
        results.classList.remove('show')
        document.getElementById('user-search').value = ''
        const res = await fetch('/api/chat/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ user_id: userId })
        })
        const json = await res.json()
        await loadChannels()
        openChannel(json.data.id, name)
        setTimeout(() => document.getElementById('message-input')?.focus(), 0)
        return
      }
      if (kind === 'msg') {
        const channelId = Number(item.getAttribute('data-channel'))
        const msgId = Number(item.getAttribute('data-id'))
        const ch = allChannels.find((c) => c.id === channelId)
        results.classList.remove('show')
        document.getElementById('user-search').value = ''
        await openChannel(channelId, ch?.name || 'Чат')

        // try to load older history until message is found (best-effort)
        let attempts = 0
        while (!document.getElementById(`m-${msgId}`) && hasMoreHistory && attempts < 8) {
          await loadOlderMessages()
          attempts += 1
        }
        const el = document.getElementById(`m-${msgId}`)
        if (el) el.scrollIntoView({ block: 'center' })
      }
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
updateComposerVisibility(false)

document.getElementById('user-card-close')?.addEventListener('click', closeUserCard)
document.getElementById('user-card-modal')?.addEventListener('click', function (e) {
  if (e.target === this) closeUserCard()
})

document.getElementById('chat-title')?.addEventListener('click', async function (e) {
  const raw = this.getAttribute('data-user') || ''
  const id = Number(raw)
  if (!Number.isFinite(id)) return
  e.preventDefault()
  await openUserCard(id)
})

document.getElementById('back-to-dialogs').onclick = () => {
  activeChannelId = null
  document.getElementById('chat-title').textContent = ''
  document.getElementById('messages-area').innerHTML = ''
  setDialogOpen(false)
  renderDialogs()
}