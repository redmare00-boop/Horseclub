const params = new URLSearchParams(window.location.search)
const token = params.get('token')

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

if (!token) {
  showError('В ссылке нет кода сброса. Откройте письмо целиком или запросите восстановление снова.')
  document.getElementById('save-btn').disabled = true
} else {
  document.getElementById('save-btn').onclick = async () => {
    const new_password = document.getElementById('new_password').value
    const new_password2 = document.getElementById('new_password2').value

    if (!new_password || String(new_password).length < 6) {
      showError('Пароль не менее 6 символов')
      return
    }
    if (new_password !== new_password2) {
      showError('Пароли не совпадают')
      return
    }

    const res = await fetch('/api/auth/complete-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password })
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      showError(json.error || 'Не удалось сохранить')
      return
    }

    showOk('Пароль обновлён. Сейчас перейдём ко входу…')
    setTimeout(() => {
      window.location.href = '/login.html'
    }, 900)
  }
}
