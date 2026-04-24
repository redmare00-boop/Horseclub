const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) {
  window.location.href = '/login.html'
}

if (user?.must_change_password) {
  window.location.href = '/change-password.html'
}

if (user?.role !== 'admin') {
  window.location.href = '/'
}

document.getElementById('user-name').textContent = user ? user.full_name : ''

document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login.html'
}

function showError(msg) {
  const el = document.getElementById('err')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('ok').style.display = 'none'
  const invite = document.getElementById('invite-result')
  if (invite) invite.style.display = 'none'
}

function showOk(msg) {
  const el = document.getElementById('ok')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('err').style.display = 'none'
  const invite = document.getElementById('invite-result')
  if (invite) invite.style.display = 'none'
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

let selectedUserId = null
let lastInviteUrl = ''

function formatDt(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear())
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yy} ${hh}:${mi}`
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {
    // fallback
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch (_) {
      return false
    }
  }
}

function showInvite(url) {
  lastInviteUrl = url
  const wrap = document.getElementById('invite-result')
  if (!wrap) return
  wrap.style.display = 'block'
  wrap.innerHTML = `
    <div class="login-success" style="margin:0">
      <div style="font-weight:500;margin-bottom:6px">Инвайт‑ссылка</div>
      <div style="word-break:break-all">${escapeHtml(url)}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button id="copy-invite" style="padding:8px 10px;border:1px solid #5DCAA5;border-radius:6px;background:#fff;cursor:pointer">Скопировать</button>
        <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;text-decoration:none;color:#333">Открыть</a>
      </div>
    </div>
  `
  document.getElementById('copy-invite').onclick = async () => {
    const ok = await copyToClipboard(lastInviteUrl)
    if (ok) showOk('Ссылка скопирована')
    else showError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.')
  }
}

async function loadUsers() {
  const res = await fetch('/api/admin/users', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  const wrap = document.getElementById('users-list')

  if (!res.ok) {
    wrap.innerHTML = `<div class="login-error">${escapeHtml(json.error || 'Ошибка загрузки пользователей')}</div>`
    return
  }

  const users = json.data || []
  if (users.length === 0) {
    wrap.innerHTML = '<div style="color:#999">Пользователей нет</div>'
    return
  }

  wrap.innerHTML = users.map(u => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #eee">
      <div>
        <div style="font-weight:500;color:#333">${escapeHtml(u.full_name)} <span style="color:#999;font-weight:400">(@${escapeHtml(u.login)})</span></div>
        <div style="font-size:12px;color:#999">роль: ${escapeHtml(u.role)} · id: ${u.id}</div>
      </div>
      <button data-reset="${u.id}" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Сбросить пароль</button>
    </div>
  `).join('')

  wrap.querySelectorAll('button[data-reset]').forEach(btn => {
    btn.onclick = () => openResetModal(btn.getAttribute('data-reset'))
  })
}

function openResetModal(userId) {
  selectedUserId = userId
  document.getElementById('reset-password').value = ''
  document.getElementById('reset-modal').style.display = 'flex'
  document.getElementById('reset-password').focus()
}

function closeResetModal() {
  document.getElementById('reset-modal').style.display = 'none'
  selectedUserId = null
}

document.getElementById('reset-close').onclick = closeResetModal
document.getElementById('reset-cancel').onclick = closeResetModal
document.getElementById('reset-modal').onclick = function (e) {
  if (e.target === this) closeResetModal()
}

document.getElementById('reset-save').onclick = async () => {
  const password = document.getElementById('reset-password').value
  if (!selectedUserId) return

  const res = await fetch(`/api/admin/users/${selectedUserId}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ password })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || 'Ошибка сброса пароля')
    return
  }
  closeResetModal()
  showOk('Пароль обновлён')
}

function formatInviteStatus(inv) {
  if (inv.used_at) return 'использован'
  const exp = new Date(inv.expires_at).getTime()
  if (Number.isFinite(exp) && exp < Date.now()) return 'истёк'
  return 'активен'
}

function inviteStatusMeta(inv) {
  const status = formatInviteStatus(inv)
  if (status === 'использован') {
    return { status, label: 'использован', bg: '#f0f0f0', color: '#666', hint: '' }
  }
  if (status === 'истёк') {
    return { status, label: 'истёк', bg: '#FCEBEB', color: '#A32D2D', hint: '' }
  }

  const expMs = new Date(inv.expires_at).getTime()
  const diffMs = expMs - Date.now()
  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60))
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  let hint = ''
  if (diffHours <= 1) hint = 'истекает скоро'
  else if (diffHours <= 6) hint = `истекает через ${diffHours} ч`
  else if (diffDays <= 1) hint = 'истекает сегодня'
  else hint = `через ${diffDays} дн`

  return { status, label: 'активен', bg: '#E1F5EE', color: '#085041', hint }
}

async function loadInvites() {
  const res = await fetch('/api/admin/invites', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  const wrap = document.getElementById('invites-list')
  if (!wrap) return

  if (!res.ok) {
    wrap.innerHTML = `<div class="login-error">${escapeHtml(json.error || 'Ошибка загрузки инвайтов')}</div>`
    return
  }

  const filter = document.getElementById('invites-filter')?.value || 'active'
  const invitesAll = json.data || []
  const invites = filter === 'all'
    ? invitesAll
    : invitesAll.filter((inv) => formatInviteStatus(inv) === 'активен')

  if (invites.length === 0) {
    wrap.innerHTML = '<div style="color:#999">Инвайтов нет</div>'
    return
  }

  wrap.innerHTML = invites.map(inv => {
    const meta = inviteStatusMeta(inv)
    const canRevoke = meta.status === 'активен'
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #eee">
        <div>
          <div style="font-weight:500;color:#333">${escapeHtml(inv.full_name)} <span style="color:#999;font-weight:400">(@${escapeHtml(inv.login)})</span></div>
          <div style="font-size:12px;color:#999">
            роль: ${escapeHtml(inv.role)} ·
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.color};border:1px solid rgba(0,0,0,0.06)">
              ${escapeHtml(meta.label)}
            </span>
            ${meta.hint ? `<span style="margin-left:6px;color:#999">(${escapeHtml(meta.hint)})</span>` : ''}
            · до: ${escapeHtml(formatDt(inv.expires_at))}
          </div>
        </div>
        <button data-revoke="${inv.id}" ${canRevoke ? '' : 'disabled'} style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:${canRevoke ? 'pointer' : 'not-allowed'};opacity:${canRevoke ? '1' : '0.5'}">Отменить</button>
      </div>
    `
  }).join('')

  wrap.querySelectorAll('button[data-revoke]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-revoke')
      if (!id) return
      if (!confirm('Отменить этот инвайт?')) return

      const res2 = await fetch(`/api/admin/invites/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const json2 = await res2.json().catch(() => ({}))
      if (!res2.ok) {
        showError(json2.error || 'Не удалось отменить')
        return
      }
      showOk('Инвайт отменён')
      loadInvites()
    }
  })
}

document.getElementById('create-btn').onclick = async () => {
  const full_name = document.getElementById('full_name').value.trim()
  const login = document.getElementById('login').value.trim()
  const password = document.getElementById('password').value
  const role = document.getElementById('role').value
  const invite = document.getElementById('invite')?.checked

  if (!full_name || !login || (!invite && !password)) {
    showError(invite ? 'Заполните имя и логин' : 'Заполните все поля')
    return
  }

  const url = invite ? '/api/admin/invites' : '/api/admin/users'
  const payload = invite ? { full_name, login, role } : { full_name, login, password, role }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })

  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    showError(json.error || 'Ошибка')
    return
  }

  document.getElementById('password').value = ''
  if (invite && json.data?.invite_url) {
    showInvite(json.data.invite_url)
    loadInvites()
  } else {
    showOk(`Пользователь создан: ${json.user.full_name} (${json.user.role})`)
  }
  loadUsers()
}

document.getElementById('refresh-btn').onclick = loadUsers
document.getElementById('invites-refresh-btn').onclick = loadInvites
document.getElementById('invites-filter').onchange = loadInvites

loadUsers()
loadInvites()

