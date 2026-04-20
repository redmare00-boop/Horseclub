document.getElementById('login-btn').onclick = async () => {
  const login = document.getElementById('login-input').value.trim()
  const password = document.getElementById('password-input').value

  if (!login || !password) {
    showError('Введите логин и пароль')
    return
  }

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  })

  const json = await res.json()

  if (!res.ok) {
    showError(json.error || 'Неверный логин или пароль')
    return
  }

  localStorage.setItem('token', json.token)
  localStorage.setItem('user', JSON.stringify(json.user))
  window.location.href = '/'
}

document.getElementById('password-input').onkeydown = (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click()
}

function showError(msg) {
  const el = document.getElementById('login-error')
  el.textContent = msg
  el.style.display = 'block'
}