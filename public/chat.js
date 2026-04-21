const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) {
  window.location.href = '/login.html'
}

const socket = io()
let activeChannelId = null
let channels = []

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
}

function renderDialogs() {
  const list = document.getElementById('dialogs-list')
  list.innerHTML = ''
  channels.forEach(ch => {
    const item = document.createElement('div')
    item.className = 'dialog-item' + (ch.id === activeChannelId ? ' active' : '')
    item.innerHTML = `
      <span class="dialog-name">${ch.name || 'Личный диалог'}</span>
      ${ch.unread_count > 0 ? `<span class="dialog-unread">${ch.unread_count}</span>` : ''}
    `
    item.onclick = () => openChannel(ch.id, ch.name || 'Личный диалог')
    list.appendChild(item)
  })
}

async function openChannel(channelId, name) {
  activeChannelId = channelId
  document.getElementById('chat-title').textContent = name
  socket.emit('channel:join', channelId)

  const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json()
  const messages = json.data || []

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
}

function appendMessage(m) {
  const area = document.getElementById('messages-area')
  const empty = area.querySelector('.chat-empty')
  if (empty) empty.remove()

  const isMine = m.sender_id === user.id
  const time = new Date(m.created_at).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit'
  })

  const div = document.createElement('div')
  div.className = 'message ' + (isMine ? 'mine' : 'other')
  div.innerHTML = `
    ${!isMine ? `<div class="message-author">${m.sender_name}</div>` : ''}
    <div class="message-bubble">${m.content}</div>
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
  if (!content || !activeChannelId) return

  socket.emit('message:send', {
    channel_id: activeChannelId,
    content,
    sender_id: user.id,
    sender_name: user.full_name
  })

  input.value = ''
  input.style.height = 'auto'
}

document.getElementById('send-btn').onclick = sendMessage

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