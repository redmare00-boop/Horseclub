const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'

document.getElementById('user-name').textContent = user ? user.full_name : ''

document.getElementById('logout-btn').onclick = () => {
  if (!confirm('Выйти из аккаунта?')) return
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login.html'
}

document.getElementById('change-password-link')?.addEventListener('click', () => {
  try { sessionStorage.setItem('profile_return', window.location.href) } catch {}
})

function safeReturnFromProfile() {
  let target = ''
  try { target = String(sessionStorage.getItem('profile_return') || '') } catch {}
  try { sessionStorage.removeItem('profile_return') } catch {}

  // Prefer explicit stored return page
  if (target && target !== window.location.href) {
    window.location.href = target
    return
  }

  // Fallback: browser history
  if (document.referrer && document.referrer !== window.location.href) {
    history.back()
    return
  }

  window.location.href = '/'
}

// back button click handled by nav.js (data-nav-back)

function resetViewportScale() {
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  const base = 'width=device-width, initial-scale=1.0'
  try {
    meta.setAttribute('content', base)
    setTimeout(() => meta.setAttribute('content', base), 50)
  } catch {}
}

function showError(msg) {
  const el = document.getElementById('err')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('ok').style.display = 'none'
}
function showOk(msg) {
  const el = document.getElementById('ok')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('err').style.display = 'none'
}

async function loadMe() {
  const res = await fetch(`/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || `Не удалось загрузить (HTTP ${res.status})`)
    return null
  }
  return json.data
}

function renderHeader(me) {
  document.getElementById('profile-title').textContent = me.nickname || me.full_name || me.login || ''
  document.getElementById('profile-sub').textContent = me.login ? `@${me.login}` : ''
  const ava = String(me.avatar_url || '').trim()
  const el = document.getElementById('profile-avatar')
  if (!el) return
  if (!ava) {
    el.classList.add('user-avatar--placeholder')
    el.innerHTML = ''
    return
  }
  el.classList.remove('user-avatar--placeholder')
  el.innerHTML = `<img src="${ava}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`
}

async function refresh() {
  const me = await loadMe()
  if (!me) return
  document.getElementById('f-nickname').value = me.nickname || ''
  document.getElementById('f-status').value = me.status || ''
  document.getElementById('f-phone').value = me.phone || ''
  renderHeader(me)

  // Keep local user cache fresh for headers across the app
  const nextUser = { ...user, full_name: me.full_name || user.full_name, nickname: me.nickname }
  localStorage.setItem('user', JSON.stringify(nextUser))
}

async function save() {
  const nickname = document.getElementById('f-nickname').value.trim()
  const status = document.getElementById('f-status').value
  const phone = document.getElementById('f-phone').value.trim()

  const res = await fetch('/api/users/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nickname, status, phone })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || `Не удалось сохранить (HTTP ${res.status})`)
    return
  }

  const file = document.getElementById('f-avatar')?.files?.[0]
  if (file) {
    if (file.size > 7 * 1024 * 1024) {
      showError('Аватар слишком большой (максимум 7 МБ)')
      return
    }
    const fd = new FormData()
    fd.append('avatar', file)
    const up = await fetch(`/api/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    })
    const upJson = await up.json().catch(() => ({}))
    if (!up.ok) {
      showError(upJson.error || `Не удалось загрузить аватар (HTTP ${up.status})`)
      return
    }
    showOk('Сохранено')
    document.getElementById('f-avatar').value = ''
    await refresh()
    resetViewportScale()
    // If user came here from somewhere, return them back after first save
    safeReturnFromProfile()
    return
  }

  showOk('Сохранено')
  await refresh()
  resetViewportScale()
  safeReturnFromProfile()
}

document.getElementById('save-btn').onclick = save

refresh()

