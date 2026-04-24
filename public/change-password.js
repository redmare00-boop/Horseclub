const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) {
  window.location.href = '/login.html'
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

// If this is NOT forced change, we require old password.
if (!user?.must_change_password) {
  document.getElementById('old-wrap').style.display = 'block'
}

document.getElementById('save-btn').onclick = async () => {
  const old_password = document.getElementById('old_password')?.value
  const new_password = document.getElementById('new_password').value

  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ old_password, new_password })
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || 'Ошибка')
    return
  }

  const updatedUser = { ...user, must_change_password: false }
  localStorage.setItem('user', JSON.stringify(updatedUser))
  showOk('Пароль обновлён. Сейчас откроем расписание...')
  setTimeout(() => (window.location.href = '/'), 800)
}

