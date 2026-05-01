const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'

const userName = document.getElementById('user-name')
if (userName) userName.textContent = user ? user.full_name : ''

document.querySelector('[aria-label="Профиль"]')?.addEventListener('click', () => {
  try { sessionStorage.setItem('profile_return', window.location.href) } catch {}
})

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function initials(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  const parts = s.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] || '?'
  const b = (parts[1]?.[0] || '')
  return (a + b).toUpperCase()
}

function normalizePhoneForTel(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '+' && out.length === 0) { out += ch; continue }
    if (ch >= '0' && ch <= '9') out += ch
  }
  return out
}

let allPeople = []

async function fetchPeople() {
  const list = document.getElementById('people-list')
  if (list) list.innerHTML = '<div class="login-sub">Загрузка…</div>'
  const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  allPeople = json.data || []
  renderPeople(allPeople)
}

function renderPeople(people) {
  const list = document.getElementById('people-list')
  if (!list) return
  if (!people.length) {
    list.innerHTML = '<div class="login-sub">Никого не найдено</div>'
    return
  }
  list.innerHTML = people.map((p) => {
    const isDeleted = !!p.deleted
    const title = isDeleted ? 'Удаленный аккаунт' : (p.nickname || p.full_name || p.login || '')
    const status = (!isDeleted && p.status) ? String(p.status) : ''
    const ava = String(p.avatar_url || '').trim()
    const phone = (!isDeleted && p.phone) ? String(p.phone) : ''
    const isSelf = Number(user?.id) === Number(p.id)
    return `
      <div class="person-row" data-id="${p.id}">
        <div class="person-left">
          <div class="person-ava${isDeleted ? ' deleted' : ''}">
            ${isDeleted ? '✕' : (ava ? `<img src="${escapeHtml(ava)}" alt="">` : escapeHtml(initials(title)))}
          </div>
          <div class="person-main">
            <div class="person-name">${escapeHtml(title)}</div>
            <div class="person-meta">${status ? escapeHtml(status) : '—'}</div>
          </div>
        </div>
        <div class="person-actions">
          ${(!isSelf && phone) ? `<button type="button" class="person-call" data-phone="${escapeHtml(phone)}">📞</button>` : ''}
        </div>
      </div>
    `
  }).join('')

  list.querySelectorAll('.person-row').forEach((row) => {
    const id = Number(row.getAttribute('data-id'))
    row.addEventListener('click', async (e) => {
      const callBtn = e?.target?.closest?.('.person-call')
      if (callBtn) return
      if (!Number.isFinite(id)) return
      await openPersonModal(id)
    })
  })
  list.querySelectorAll('.person-call').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const phone = btn.getAttribute('data-phone') || ''
      const tel = normalizePhoneForTel(phone)
      if (!phone) return
      if (confirm(`Позвонить ${phone}?`)) window.location.href = `tel:${tel || phone}`
    })
  })
}

async function getProfile(userId) {
  const res = await fetch(`/api/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json.data
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

async function openPersonModal(userId) {
  const modal = document.getElementById('people-modal')
  const body = document.getElementById('people-modal-body')
  const title = document.getElementById('people-modal-title')
  if (!modal || !body || !title) return

  modal.style.display = 'flex'
  body.innerHTML = '<div class="login-sub">Загрузка…</div>'

  try {
    const p = await getProfile(userId)
    const isDeleted = !!p.deleted
    const horses = Array.isArray(p.horses) ? p.horses : []
    const name = isDeleted ? 'Удаленный аккаунт' : (p.nickname || p.full_name || p.login || '')
    const phone = (!isDeleted && p.phone) ? String(p.phone) : ''
    const tel = normalizePhoneForTel(phone)
    const isSelf = Number(user?.id) === Number(userId)
    const ava = String(p.avatar_url || '').trim()

    title.textContent = name || 'Профиль'
    body.innerHTML = `
      <div class="user-card-modal-top">
        <div class="ava">${isDeleted ? '✕' : (ava ? `<img src="${escapeHtml(ava)}" alt="">` : escapeHtml(initials(name)))}</div>
        <div>
          <div class="name">${escapeHtml(name)}</div>
          <div class="meta">
            ${(!isDeleted && p.status) ? `<span class="user-status">${escapeHtml(p.status)}</span>` : ''}
            ${(!isDeleted && p.login) ? `<span style="color:#999">@${escapeHtml(p.login)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="user-card-modal-row"><span style="color:#999">Лошади:</span> ${(!isDeleted && horses.length) ? escapeHtml(horses.join(', ')) : '—'}</div>
      <div class="user-card-modal-row"><span style="color:#999">Телефон:</span><div style="margin-top:6px">${
        (!phone || isDeleted)
          ? `<div style="color:#999;font-size:13px">${isDeleted ? 'Аккаунт удалён' : 'Телефон не указан'}</div>`
          : (isSelf
            ? `<div style="color:#666;font-size:13px">${escapeHtml(phone)}</div>`
            : `<a href="tel:${escapeHtml(tel || phone)}" class="user-card-phone" id="people-phone">${escapeHtml(phone)}</a>`)
      }</div></div>
      <div class="user-card-modal-row people-actions-row">
        <button type="button" class="chat-link people-chat-btn" id="people-chat-btn">Чат</button>
      </div>
    `

    const chatBtn = document.getElementById('people-chat-btn')
    if (chatBtn) chatBtn.onclick = async () => {
      await ensureDirectChatWith(userId, name)
    }

    const phoneEl = document.getElementById('people-phone')
    if (phoneEl && phone && !isSelf) {
      phoneEl.addEventListener('click', (e) => {
        e.preventDefault()
        if (confirm(`Позвонить ${phone}?`)) window.location.href = `tel:${tel || phone}`
      })
    }
  } catch (err) {
    body.innerHTML = `<div class="login-error">Не удалось загрузить карточку (${escapeHtml(err?.message || 'ошибка')})</div>`
  }
}

function closeModal() {
  const modal = document.getElementById('people-modal')
  if (modal) modal.style.display = 'none'
}
const closeBtn = document.getElementById('people-modal-close')
if (closeBtn) closeBtn.onclick = closeModal
const modalBg = document.getElementById('people-modal')
if (modalBg) {
  modalBg.addEventListener('click', (e) => {
    if (e.target === modalBg) closeModal()
  })
}

const search = document.getElementById('people-search')
if (search) {
  search.addEventListener('input', () => {
    const q = String(search.value || '').trim().toLowerCase()
    if (!q) return renderPeople(allPeople)
    const filtered = allPeople.filter((p) => {
      const s = `${p.nickname || ''} ${p.full_name || ''} ${p.login || ''} ${p.status || ''}`.toLowerCase()
      return s.includes(q)
    })
    renderPeople(filtered)
  })
}

fetchPeople().catch((err) => {
  const list = document.getElementById('people-list')
  if (list) list.innerHTML = `<div class="login-error">Не удалось загрузить список (${escapeHtml(err?.message || 'ошибка')})</div>`
})

