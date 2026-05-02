const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) {
  window.location.href = '/login.html'
}

if (user?.must_change_password) {
  window.location.href = '/change-password.html'
}

if (user?.role !== 'admin') {
  window.location.href = '/'
}

document.getElementById('user-name').textContent = user ? user.full_name : ''

document.querySelector('[aria-label="Профиль"]')?.addEventListener('click', () => {
  try { sessionStorage.setItem('profile_return', window.location.href) } catch {}
})

function showError(msg) {
  const el = document.getElementById('err')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('ok').style.display = 'none'
  const invite = document.getElementById('invite-result')
  if (invite) invite.style.display = 'none'
}

function showOk(msg) {
  const el = document.getElementById('ok')
  el.textContent = msg
  el.style.display = 'block'
  document.getElementById('err').style.display = 'none'
  const invite = document.getElementById('invite-result')
  if (invite) invite.style.display = 'none'
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizePhoneForTel(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '+' && out.length === 0) { out += ch; continue }
    if (ch >= '0' && ch <= '9') out += ch
  }
  return out
}

async function ensureDirectChatWith(userId, displayName) {
  const res = await fetch('/api/chat/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  try {
    sessionStorage.setItem('open_chat_channel', JSON.stringify({ id: json.data?.id, name: displayName || json.data?.name || 'Личный чат' }))
  } catch {}
  window.location.href = '/chat.html'
}

async function fetchUserCard(userId) {
  const res = await fetch(`/api/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json.data
}

function openUserViewModal(html) {
  const modal = document.getElementById('user-view-modal')
  const body = document.getElementById('user-view-body')
  if (!modal || !body) return
  body.innerHTML = html
  modal.style.display = 'flex'
}

function closeUserViewModal() {
  const modal = document.getElementById('user-view-modal')
  if (modal) modal.style.display = 'none'
}

let lastInviteUrl = ''
let activeUserViewId = null
let activeUserViewArchived = false
let archivedById = new Map()

function formatDt(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear())
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yy} ${hh}:${mi}`
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {
    // fallback
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch (_) {
      return false
    }
  }
}

function buildNewUserMessage({ login, inviteUrl }) {
  const lines = [
    'Привет!',
    '',
    'Тебе создан доступ в Horseclub.',
    '',
    `Логин: ${login}`,
    `Ссылка для регистрации: ${inviteUrl}`,
    '',
    'Инструкция:',
    '1) Открой ссылку для регистрации.',
    '2) Придумай и установи пароль (минимум 6 символов).',
    '3) Войди в приложение: введи логин и пароль.',
    '',
    'Если ссылка не открывается — пришли мне скрин/ошибку, я помогу.'
  ]
  return lines.join('\n')
}

function showInvite({ url, login }) {
  lastInviteUrl = url
  const wrap = document.getElementById('invite-result')
  if (!wrap) return
  const msg = buildNewUserMessage({ login, inviteUrl: url })
  wrap.style.display = 'block'
  wrap.innerHTML = `
    <div class="login-success" style="margin:0">
      <div style="font-weight:500;margin-bottom:6px">Данные для новичка</div>
      <div style="font-size:13px;margin-bottom:8px">
        <span style="color:#666">Логин:</span> <span style="font-weight:600">${escapeHtml(login || '')}</span>
      </div>
      <div style="font-size:13px;margin-bottom:8px">
        <span style="color:#666">Инвайт‑ссылка:</span> <span style="word-break:break-all">${escapeHtml(url)}</span>
      </div>
      <div style="margin-top:10px">
        <div style="font-weight:500;margin-bottom:6px">Сообщение пользователю</div>
        <textarea id="new-user-message" readonly style="width:100%;min-height:170px;resize:vertical;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:13px;line-height:1.35">${escapeHtml(msg)}</textarea>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button id="copy-message" style="padding:8px 10px;border:1px solid #5DCAA5;border-radius:6px;background:#fff;cursor:pointer">Скопировать сообщение</button>
          <button id="copy-invite" style="padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Скопировать ссылку</button>
          <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;text-decoration:none;color:#333">Открыть ссылку</a>
        </div>
      </div>
    </div>
  `
  document.getElementById('copy-message').onclick = async () => {
    const ok = await copyToClipboard(msg)
    if (ok) showOk('Сообщение скопировано')
    else showError('Не удалось скопировать. Выделите текст и скопируйте вручную.')
  }
  document.getElementById('copy-invite').onclick = async () => {
    const ok = await copyToClipboard(lastInviteUrl)
    if (ok) showOk('Ссылка скопирована')
    else showError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.')
  }
}

async function loadUsers() {
  const scope = document.getElementById('users-filter')?.value || 'active'
  const res = await fetch(`/api/admin/users?scope=${encodeURIComponent(scope)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  const wrap = document.getElementById('users-list')

  if (!res.ok) {
    wrap.innerHTML = `<div class="login-error">${escapeHtml(json.error || 'Ошибка загрузки пользователей')}</div>`
    return
  }

  const users = json.data || []
  if (users.length === 0) {
    wrap.innerHTML = '<div style="color:#999">Пользователей нет</div>'
    return
  }
  archivedById = new Map(users.map(u => [Number(u.id), Boolean(u.archived)]))

  function statusLabel(raw) {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return ''
    const map = {
      'коневладелец': 'Коневладелец',
      'тренер': 'Тренер',
      'руководитель клуба': 'Руководитель клуба',
      'ветврач': 'Ветврач',
      'конюх': 'Конюх'
    }
    return map[v] || raw
  }

  wrap.innerHTML = users.map(u => {
    const name = escapeHtml(u.full_name || '')
    const st = statusLabel(u.status)
    const statusSub = st ? escapeHtml(String(st)) : '—'
    const avatar = String(u.avatar_url || '').trim()
    const horses = Array.isArray(u.horses) ? u.horses : []
    const isOwner = String(u.status || '').trim().toLowerCase() === 'коневладелец'
    const isSelf = Number(user.id) === Number(u.id)
    const isArchived = Boolean(u.archived)

    const avatarHtml = avatar
      ? `<img class="user-avatar" src="${escapeHtml(avatar)}" alt="${name || 'Пользователь'}">`
      : `<div class="user-avatar user-avatar--placeholder" aria-hidden="true"></div>`

    const horsesHtml = (isOwner && horses.length)
      ? `<div class="user-horses"><span class="label">Лошади:</span> ${escapeHtml(horses.join(', '))}</div>`
      : (isOwner ? `<div class="user-horses user-horses--empty">Лошади: —</div>` : '')

    const actionBtn = isSelf
      ? `<button type="button" class="btn-ghost" disabled style="opacity:0.5;cursor:not-allowed" title="Нельзя архивировать себя">В архив</button>`
      : (isArchived
        ? `<button type="button" data-unarchive="${u.id}" class="admin-user-unarchive" style="padding:7px 10px;border:1px solid #cfe7dd;border-radius:6px;background:#fff;color:#085041;cursor:pointer">Восстановить</button>`
        : `<button type="button" data-archive="${u.id}" class="admin-user-archive" style="padding:7px 10px;border:1px solid #f0b4b4;border-radius:6px;background:#fff;color:#A32D2D;cursor:pointer">В архив</button>`
      )

    return `
      <div class="user-card" data-user="${u.id}">
        <div class="user-card-left">
          ${avatarHtml}
          <div class="user-main">
            <div class="user-title">
              <span class="user-nick">${name || '—'}</span>
              <span class="user-login">@${escapeHtml(u.login || '')}</span>
            </div>
            <div class="user-sub">
              <span class="user-status">${statusSub}</span>
              ${isArchived ? `<span class="user-status" style="background:#FCEBEB;color:#A32D2D">в архиве</span>` : ''}
            </div>
            ${horsesHtml}
          </div>
        </div>
        <div class="user-card-actions">
          ${actionBtn}
        </div>
      </div>
    `
  }).join('')

  wrap.querySelectorAll('button[data-archive]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation()
      const id = Number(btn.getAttribute('data-archive'))
      if (!Number.isFinite(id)) return
      if (!confirm('Поместить пользователя в архив? Он больше не сможет входить.')) return
      try {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.status !== 204) {
          const json = await res.json().catch(() => ({}))
          showError(json.error || `Не удалось архивировать (HTTP ${res.status})`)
          return
        }
        showOk('Пользователь в архиве')
        await loadUsers()
        await loadInvites()
      } catch {
        showError('Не удалось архивировать (сеть)')
      }
    }
  })

  wrap.querySelectorAll('button[data-unarchive]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation()
      const id = Number(btn.getAttribute('data-unarchive'))
      if (!Number.isFinite(id)) return
      try {
        const res = await fetch(`/api/admin/users/${id}/unarchive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          showError(json.error || `Не удалось восстановить (HTTP ${res.status})`)
          return
        }
        showOk('Пользователь восстановлен')
        await loadUsers()
      } catch {
        showError('Не удалось восстановить (сеть)')
      }
    }
  })

  wrap.querySelectorAll('.user-card').forEach((card) => {
    card.onclick = async (e) => {
      if (e.target?.closest?.('button')) return
      const id = Number(card.getAttribute('data-user'))
      if (!Number.isFinite(id)) return
      try {
        activeUserViewId = id
        activeUserViewArchived = Boolean(archivedById.get(id))
        const u = await fetchUserCard(id)
        const ava = String(u.avatar_url || '').trim()
        const horses = Array.isArray(u.horses) ? u.horses : []
        const phone = String(u.phone || '').trim()
        const tel = normalizePhoneForTel(phone)
        const isSelf = Number(user?.id) === Number(id)
        const displayName = String(u.full_name || u.nickname || u.login || '').trim()
        openUserViewModal(`
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
            <div class="user-avatar ${ava ? '' : 'user-avatar--placeholder'}" style="width:56px;height:56px;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center">
              ${ava ? `<img src="${escapeHtml(ava)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : ''}
            </div>
            <div style="min-width:0">
              <div style="font-size:14px;font-weight:600;color:#333">${escapeHtml(u.nickname || u.full_name || u.login || '')}</div>
              <div style="font-size:12px;color:#999">@${escapeHtml(u.login || '')}</div>
            </div>
          </div>
          ${u.status ? `<div style="margin:8px 0"><span class="user-status">${escapeHtml(u.status)}</span></div>` : ''}
          <div style="font-size:13px;color:#444;margin-top:10px"><span style="color:#999">Лошади:</span> ${horses.length ? escapeHtml(horses.join(', ')) : '—'}</div>
          <div style="font-size:13px;color:#444;margin-top:10px">
            <span style="color:#999">Телефон:</span>
            ${
              phone
                ? (isSelf
                  ? `<span style="margin-left:6px;color:#666">${escapeHtml(phone)}</span>`
                  : `<a href="tel:${escapeHtml(tel || phone)}" class="user-card-phone" id="admin-user-phone" style="margin-left:6px">${escapeHtml(phone)}</a>`)
                : ' —'
            }
          </div>
          ${!isSelf ? `
          <div style="border-top:1px solid #eee;margin-top:14px;padding-top:12px">
            <div style="font-weight:600;margin-bottom:6px;color:#333;font-size:13px">Новый пароль пользователя</div>
            <div style="font-size:12px;color:#888;margin-bottom:10px">Без ввода старого пароля — только для администратора.</div>
            <input type="password" id="admin-reset-pw" autocomplete="new-password" placeholder="Новый пароль (от 6 символов)" style="width:100%;padding:9px 10px;border:1px solid #ddd;border-radius:10px;margin-bottom:8px;box-sizing:border-box">
            <input type="password" id="admin-reset-pw2" autocomplete="new-password" placeholder="Повтор пароля" style="width:100%;padding:9px 10px;border:1px solid #ddd;border-radius:10px;margin-bottom:10px;box-sizing:border-box">
            <button type="button" id="admin-reset-submit" style="width:100%;padding:10px 12px;background:#534AB7;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer">Установить пароль</button>
            ${activeUserViewArchived ? `<div style="font-size:12px;color:#A32D2D;margin-top:10px">Аккаунт в архиве — войти нельзя, пока не восстановите пользователя.</div>` : ''}
          </div>
          ` : ''}
          <div class="user-card-modal-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
            ${isSelf ? '' : `<button type="button" class="btn-ghost" id="admin-user-chat" style="padding:8px 10px;border-radius:10px">Написать в чат</button>`}
          </div>
        `)
        const phoneEl = document.getElementById('admin-user-phone')
        if (phoneEl && phone && !isSelf) {
          phoneEl.addEventListener('click', (e2) => {
            e2.preventDefault()
            if (confirm(`Позвонить ${phone}?`)) window.location.href = `tel:${tel || phone}`
          })
        }
        const chatBtn = document.getElementById('admin-user-chat')
        if (chatBtn && !isSelf) {
          chatBtn.addEventListener('click', async (e3) => {
            e3.preventDefault()
            try {
              await ensureDirectChatWith(id, displayName)
            } catch (err2) {
              showError(`Не удалось открыть чат: ${escapeHtml(err2?.message || 'ошибка')}`)
            }
          })
        }
        const resetBtn = document.getElementById('admin-reset-submit')
        if (resetBtn && !isSelf) {
          resetBtn.addEventListener('click', async () => {
            const p1 = document.getElementById('admin-reset-pw')?.value || ''
            const p2 = document.getElementById('admin-reset-pw2')?.value || ''
            if (p1.length < 6) {
              showError('Пароль должен быть не менее 6 символов')
              return
            }
            if (p1 !== p2) {
              showError('Пароли не совпадают')
              return
            }
            try {
              const resPw = await fetch(`/api/admin/users/${id}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ password: p1 })
              })
              const jsonPw = await resPw.json().catch(() => ({}))
              if (!resPw.ok) {
                showError(jsonPw.error || `Не удалось сменить пароль (HTTP ${resPw.status})`)
                return
              }
              const inp1 = document.getElementById('admin-reset-pw')
              const inp2 = document.getElementById('admin-reset-pw2')
              if (inp1) inp1.value = ''
              if (inp2) inp2.value = ''
              closeUserViewModal()
              showOk('Пароль пользователя обновлён')
            } catch {
              showError('Не удалось сменить пароль (сеть)')
            }
          })
        }
        const btn = document.getElementById('user-delete')
        if (btn) {
          btn.style.display = activeUserViewArchived ? 'none' : ''
        }
      } catch (err) {
        showError(`Не удалось открыть профиль: ${escapeHtml(err.message || 'ошибка')}`)
      }
    }
  })
}

const userViewClose = document.getElementById('user-view-close')
if (userViewClose) userViewClose.onclick = closeUserViewModal
document.getElementById('user-view-modal')?.addEventListener('click', function (e) {
  if (e.target === this) closeUserViewModal()
})
document.getElementById('user-view-cancel')?.addEventListener('click', closeUserViewModal)

document.getElementById('user-delete')?.addEventListener('click', async () => {
  if (!activeUserViewId) return
  if (!confirm('Поместить пользователя в архив? Он больше не сможет входить.')) return
  try {
    const res = await fetch(`/api/admin/users/${activeUserViewId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status !== 204) {
      const json = await res.json().catch(() => ({}))
      showError(json.error || `Не удалось архивировать (HTTP ${res.status})`)
      return
    }
    closeUserViewModal()
    activeUserViewId = null
    await loadUsers()
    await loadInvites()
    showOk('Пользователь в архиве')
  } catch {
    showError('Не удалось архивировать (сеть)')
  }
})

function formatInviteStatus(inv) {
  if (inv.used_at) return 'использован'
  const exp = new Date(inv.expires_at).getTime()
  if (Number.isFinite(exp) && exp < Date.now()) return 'истёк'
  return 'активен'
}

function inviteStatusMeta(inv) {
  const status = formatInviteStatus(inv)
  if (status === 'использован') {
    return { status, label: 'использован', bg: '#f0f0f0', color: '#666', hint: '' }
  }
  if (status === 'истёк') {
    return { status, label: 'истёк', bg: '#FCEBEB', color: '#A32D2D', hint: '' }
  }

  const expMs = new Date(inv.expires_at).getTime()
  const diffMs = expMs - Date.now()
  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60))
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  let hint = ''
  if (diffHours <= 1) hint = 'истекает скоро'
  else if (diffHours <= 6) hint = `истекает через ${diffHours} ч`
  else if (diffDays <= 1) hint = 'истекает сегодня'
  else hint = `через ${diffDays} дн`

  return { status, label: 'активен', bg: '#E1F5EE', color: '#085041', hint }
}

async function loadInvites() {
  const res = await fetch('/api/admin/invites', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const json = await res.json().catch(() => ({}))
  const wrap = document.getElementById('invites-list')
  if (!wrap) return

  if (!res.ok) {
    wrap.innerHTML = `<div class="login-error">${escapeHtml(json.error || 'Ошибка загрузки инвайтов')}</div>`
    return
  }

  const filter = document.getElementById('invites-filter')?.value || 'active'
  const invitesAll = json.data || []
  const invites = filter === 'all'
    ? invitesAll
    : invitesAll.filter((inv) => formatInviteStatus(inv) === 'активен')

  if (invites.length === 0) {
    wrap.innerHTML = '<div style="color:#999">Инвайтов нет</div>'
    return
  }

  wrap.innerHTML = invites.map(inv => {
    const meta = inviteStatusMeta(inv)
    const canRevoke = meta.status === 'активен'
    const token = String(inv.token || '').trim()
    const inviteUrl = token ? `${window.location.origin}/invite.html?token=${encodeURIComponent(token)}` : ''
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid #eee">
        <div>
          <div style="font-weight:500;color:#333">${escapeHtml(inv.full_name)} <span style="color:#999;font-weight:400">(@${escapeHtml(inv.login)})</span></div>
          <div style="font-size:12px;color:#999">
            роль: ${escapeHtml(inv.role)} ·
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.color};border:1px solid rgba(0,0,0,0.06)">
              ${escapeHtml(meta.label)}
            </span>
            ${meta.hint ? `<span style="margin-left:6px;color:#999">(${escapeHtml(meta.hint)})</span>` : ''}
            · до: ${escapeHtml(formatDt(inv.expires_at))}
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${inviteUrl
              ? `<button type="button" class="btn-ghost" data-copy-invite="${escapeHtml(inviteUrl)}">Скопировать ссылку</button>
                 <a class="btn-ghost" href="${escapeHtml(inviteUrl)}" target="_blank" style="text-decoration:none;color:#333">Открыть</a>`
              : `<span style="color:#999;font-size:12px">Ссылка недоступна (инвайт создан до обновления)</span>`
            }
          </div>
        </div>
        <button data-revoke="${inv.id}" ${canRevoke ? '' : 'disabled'} style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:${canRevoke ? 'pointer' : 'not-allowed'};opacity:${canRevoke ? '1' : '0.5'}">Отменить</button>
      </div>
    `
  }).join('')

  wrap.querySelectorAll('button[data-copy-invite]').forEach((btn) => {
    btn.onclick = async () => {
      const url = btn.getAttribute('data-copy-invite') || ''
      if (!url) return
      const ok = await copyToClipboard(url)
      if (ok) showOk('Ссылка скопирована')
      else showError('Не удалось скопировать. Скопируйте вручную.')
    }
  })

  wrap.querySelectorAll('button[data-revoke]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-revoke')
      if (!id) return
      if (!confirm('Отменить этот инвайт?')) return

      const res2 = await fetch(`/api/admin/invites/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const json2 = await res2.json().catch(() => ({}))
      if (!res2.ok) {
        showError(json2.error || 'Не удалось отменить')
        return
      }
      showOk('Инвайт отменён')
      loadInvites()
    }
  })
}

document.getElementById('create-btn').onclick = async () => {
  const full_name = document.getElementById('full_name').value.trim()
  const loginRaw = document.getElementById('login')?.value?.trim() || ''
  const status = document.getElementById('status')?.value?.trim()
  const role = document.getElementById('role').value

  if (!full_name) {
    showError('Заполните имя и фамилию')
    return
  }

  let login = loginRaw
  if (!login) {
    // Generate a reasonable login automatically (admin can later change it if needed).
    const baseLogin = String(full_name)
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'user'
    login = `${baseLogin}-${Math.floor(Math.random() * 9000 + 1000)}`
  }

  const url = '/api/admin/invites'
  const payload = { full_name, login, role, status }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })

  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    showError(json.error || 'Ошибка')
    return
  }

  if (json.data?.invite_url) {
    showInvite({ url: json.data.invite_url, login })
    showOk('Инвайт создан')
  }
  loadInvites()
}

document.getElementById('cancel-create')?.addEventListener('click', () => {
  document.getElementById('full_name').value = ''
  const login = document.getElementById('login')
  if (login) login.value = ''
  document.getElementById('status').value = ''
  document.getElementById('role').value = 'user'
  document.getElementById('err').style.display = 'none'
  document.getElementById('ok').style.display = 'none'
  const invite = document.getElementById('invite-result')
  if (invite) invite.style.display = 'none'
})

document.getElementById('users-filter')?.addEventListener('change', loadUsers)
document.getElementById('invites-refresh-btn').onclick = loadInvites
document.getElementById('invites-filter').onchange = loadInvites

loadUsers()
loadInvites()

