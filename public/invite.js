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

function getToken() {
  const url = new URL(window.location.href)
  return url.searchParams.get('token') || ''
}

async function loadInvite() {
  const token = getToken()
  if (!token) {
    showError('Нет токена в ссылке')
    document.getElementById('subtitle').textContent = 'Ссылка некорректна'
    return
  }

  const res = await fetch(`/api/invites/${encodeURIComponent(token)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || 'Ошибка приглашения')
    document.getElementById('subtitle').textContent = 'Ссылка не подходит'
    return
  }

  document.getElementById('login').value = json.data.login
  document.getElementById('full_name').value = json.data.full_name
  document.getElementById('subtitle').textContent = 'Придумайте пароль, чтобы создать аккаунт'
  document.getElementById('form').style.display = 'block'
}

document.getElementById('accept-btn').onclick = async () => {
  const token = getToken()
  const password = document.getElementById('password').value

  const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || 'Ошибка')
    return
  }

  showOk('Аккаунт создан! Теперь войдите со своим логином и паролем.')
  document.getElementById('form').style.display = 'none'
  setTimeout(() => (window.location.href = '/login.html'), 1200)
}

loadInvite()

