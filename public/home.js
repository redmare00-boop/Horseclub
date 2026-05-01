const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'

document.getElementById('user-name').textContent = user ? user.full_name : ''
if (user?.role === 'admin') {
  const link = document.getElementById('admin-panel-link')
  if (link) link.style.display = 'inline-block'
}
document.querySelector('[aria-label="Профиль"]')?.addEventListener('click', () => {
  try { sessionStorage.setItem('profile_return', window.location.href) } catch {}
})
const userName = document.getElementById('user-name')
if (userName) userName.onclick = () => {
  try { sessionStorage.setItem('profile_return', window.location.href) } catch {}
  window.location.href = '/profile.html'
}

const list = document.getElementById('venues-list')
list.innerHTML = '<div class="login-sub">Загрузка площадок…</div>'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

let clubCache = null

async function loadClub() {
  const res = await fetch('/api/club', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json.data
}

function applyClubToHeader(c) {
  if (!c) return
  clubCache = c
  const nameEl = document.getElementById('club-name')
  if (nameEl) nameEl.textContent = c.name || 'Конный клуб'
  const title = document.querySelector('.topbar h1')
  if (title) title.textContent = c.name || title.textContent

  const img = document.getElementById('club-logo-img')
  const fallback = document.getElementById('club-logo-fallback')
  const logo = String(c.logo_url || '').trim()
  if (img && fallback) {
    if (logo) {
      img.src = logo
      img.style.display = 'block'
      fallback.style.display = 'none'
    } else {
      img.src = ''
      img.style.display = 'none'
      fallback.style.display = 'inline'
    }
  }
}

function openClubModal() {
  const modal = document.getElementById('club-modal')
  const body = document.getElementById('club-modal-body')
  const title = document.getElementById('club-modal-title')
  if (!modal || !body || !title) return

  const c = clubCache || { name: 'Клуб' }
  title.textContent = c.name || 'Клуб'
  const coords = String(c.coords || '').trim()
  const coordsHint = coords ? `<div style="color:#999;margin-top:4px">координаты: ${escapeHtml(coords)}</div>` : ''
  const address = String(c.address || '').trim()
  const mercury = String(c.mercury_id || '').trim()

  body.innerHTML = `
    ${address ? `<div style="margin:8px 0"><span style="color:#999">Адрес:</span> ${escapeHtml(address)}${coordsHint}</div>` : ''}
    ${mercury ? `<div style="margin:8px 0"><span style="color:#999">Меркурий:</span> ${escapeHtml(mercury)}</div>` : ''}
    ${(!address && !mercury) ? `<div style="color:#999">Данные клуба ещё не заполнены администратором.</div>` : ''}
  `
  modal.style.display = 'flex'
}

function closeClubModal() {
  const modal = document.getElementById('club-modal')
  if (modal) modal.style.display = 'none'
}

document.getElementById('club-brand')?.addEventListener('click', (e) => {
  e.preventDefault()
  openClubModal()
})
document.getElementById('club-modal-close')?.addEventListener('click', closeClubModal)
document.getElementById('club-modal')?.addEventListener('click', function (e) {
  if (e.target === this) closeClubModal()
})

fetch('/api/venues')
  .then((r) => r.json())
  .then((json) => {
    const venues = json.data || []
    if (venues.length === 0) {
      list.innerHTML = '<div class="login-sub">Нет активных площадок. Администратор может добавить их в настройках.</div>'
      return
    }
    list.innerHTML = venues.map(
      (v) => `
  <a class="venue-card" href="/venue.html?venueId=${v.id}">
    <div class="venue-title">${v.name}</div>
  </a>
`
    ).join('')
  })
  .catch(() => {
    list.innerHTML = '<div class="login-error">Не удалось загрузить площадки</div>'
  })

loadClub()
  .then(applyClubToHeader)
  .catch(() => {})
