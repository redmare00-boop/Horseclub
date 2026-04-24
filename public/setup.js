async function api(path, options) {
  const res = await fetch(path, options)
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

function showError(msg) {
  const el = document.getElementById('setup-error')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('setup-success').style.display = 'none'
}

function showSuccess(msg) {
  const el = document.getElementById('setup-success')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('setup-error').style.display = 'none'
}

async function checkStatus() {
  const { res, json } = await api('/api/setup/status')
  if (!res.ok) {
    showError(json.error || 'Ошибка проверки статуса')
    return
  }
  if (!json.needs_setup) {
    showSuccess('Сетап уже выполнен. Сейчас перенаправим на вход...')
    setTimeout(() => (window.location.href = '/login.html'), 1200)
  }
}

document.getElementById('setup-btn').onclick = async () => {
  const full_name = document.getElementById('fullname-input').value.trim()
  const login = document.getElementById('login-input').value.trim()
  const password = document.getElementById('password-input').value

  if (!full_name || !login || !password) {
    showError('Заполните все поля')
    return
  }
  if (password.length < 6) {
    showError('Пароль должен быть не менее 6 символов')
    return
  }

  const { res, json } = await api('/api/setup/create-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name, login, password })
  })

  if (!res.ok) {
    showError(json.error || 'Ошибка создания администратора')
    return
  }

  localStorage.setItem('token', json.token)
  localStorage.setItem('user', JSON.stringify(json.user))

  showSuccess('Администратор создан! Сейчас откроем расписание...')
  setTimeout(() => (window.location.href = '/'), 800)
}

checkStatus()

