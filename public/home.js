const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'

document.getElementById('user-name').textContent = user ? user.full_name : ''
if (user?.role === 'admin') {
  const link = document.getElementById('admin-users-link')
  if (link) link.style.display = 'inline-block'
  const vlink = document.getElementById('admin-venues-link')
  if (vlink) vlink.style.display = 'inline-block'
}
document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login.html'
}

const list = document.getElementById('venues-list')
list.innerHTML = '<div class="login-sub">Загрузка площадок…</div>'

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
    <div class="venue-sub">Открыть календарь →</div>
  </a>
`
    ).join('')
  })
  .catch(() => {
    list.innerHTML = '<div class="login-error">Не удалось загрузить площадки</div>'
  })
