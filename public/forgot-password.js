function showError(msg) {
  const el = document.getElementById('err')
  el.textContent = msg
  el.style.display = 'block'
}

document.getElementById('submit-btn').onclick = async () => {
  const login = document.getElementById('login-input').value.trim()
  if (!login) {
    showError('Введите логин')
    return
  }

  const res = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login })
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showError(json.error || `Ошибка (HTTP ${res.status})`)
    return
  }

  document.getElementById('err').style.display = 'none'
  document.getElementById('form-wrap').style.display = 'none'
  document.getElementById('result-wrap').style.display = 'block'

  let msg =
    'Если такой логин есть в системе: при настроенной почте и SMTP на сервере мы отправили ссылку для нового пароля (действует 1 час). Иначе обратитесь к администратору клуба или после входа укажите почту в профиле и повторите запрос.'

  if (json.mail_sent) {
    msg =
      'Если логин найден, на указанную в профиле почту отправлено письмо со ссылкой. Проверьте папку «Спам». Ссылка действует 1 час.'
  }
  if (json.mail_error) {
    msg =
      'Запрос принят, но отправить письмо не удалось (ошибка почтового сервера). Попробуйте позже или попросите администратора сбросить пароль.'
  }
  if (json.config_error) {
    msg =
      'У сервера не задан публичный адрес сайта (переменная PUBLIC_APP_URL или заголовки прокси). Пока ссылку сброса нельзя собрать для письма — обратитесь к администратору.'
  }

  document.getElementById('result-text').textContent = msg
}

document.getElementById('login-input').onkeydown = (e) => {
  if (e.key === 'Enter') document.getElementById('submit-btn').click()
}
