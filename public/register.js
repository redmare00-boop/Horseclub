document.getElementById('reg-btn').onclick = async () => {
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

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name, login, password })
  })

  const json = await res.json()

  if (!res.ok) {
    showError(json.error || 'Ошибка регистрации')
    return
  }

  showSuccess('Аккаунт создан! Сейчас перенаправим на страницу входа...')
  setTimeout(() => {
    window.location.href = '/login.html'
  }, 2000)
}

function showError(msg) {
  const el = document.getElementById('reg-error')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('reg-success').style.display = 'none'
}

function showSuccess(msg) {
  const el = document.getElementById('reg-success')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('reg-error').style.display = 'none'
}