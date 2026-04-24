const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'
if (user?.role !== 'admin') window.location.href = '/'

document.getElementById('user-name').textContent = user ? user.full_name : ''
document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login.html'
}

function showErr(msg) {
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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

/** Снимок формы «Создать» для сравнения */
function getCreateSnapshot() {
  return JSON.stringify({
    name: document.getElementById('v-name').value.trim(),
    mxt: document.getElementById('v-max-t').value,
    mxu: document.getElementById('v-max-u').value,
    gran: document.getElementById('v-gran').value,
    active: document.getElementById('v-active').checked
  })
}

function getCreateDefaultSnapshot() {
  return JSON.stringify({ name: '', mxt: '', mxu: '', gran: '30', active: true })
}

// Важно: baseline = дефолт формы, а не «что сейчас в инпутах при загрузке».
// Иначе восстановленные браузером значения будут считаться «неизменёнными»,
// и кнопка «Создать» останется серой.
let createBaseline = getCreateDefaultSnapshot()

function isCreateDirty() {
  return getCreateSnapshot() !== createBaseline
}

function updateCreateButton() {
  document.getElementById('v-add').classList.toggle('admin-venues-btn--ready', isCreateDirty())
}

function syncCreateBaseline() {
  createBaseline = getCreateSnapshot()
  updateCreateButton()
}

/** Состояние строки списка (серверное) */
const rowBaselines = new Map()

function readRowStateFromWrap(wrap) {
  if (!wrap) return null
  return JSON.stringify({
    name: (wrap.querySelector('.e-name')?.value || '').trim(),
    mxt: wrap.querySelector('.e-mxt')?.value ?? '',
    mxu: wrap.querySelector('.e-mxu')?.value ?? '',
    act: !!wrap.querySelector('.e-act')?.checked
  })
}

function rowWrap(id) {
  return document.querySelector(`#venues-list [data-id="${id}"]`)
}

function isRowDirty(id) {
  const wrap = rowWrap(id)
  if (!wrap) return false
  return readRowStateFromWrap(wrap) !== rowBaselines.get(id)
}

function updateSaveButton(id) {
  const wrap = rowWrap(id)
  if (!wrap) return
  const btn = wrap.querySelector('.btn-save')
  if (!btn) return
  btn.classList.toggle('admin-venues-btn--ready', isRowDirty(id))
}

function initRowsFromServer(rows) {
  rowBaselines.clear()
  rows.forEach((v) => {
    const wrap = rowWrap(v.id)
    if (wrap) rowBaselines.set(v.id, readRowStateFromWrap(wrap))
  })
  rows.forEach((v) => updateSaveButton(v.id))
}

const venuesList = document.getElementById('venues-list')
if (venuesList) {
  venuesList.addEventListener('input', (e) => {
    const wrap = e.target.closest('[data-id]')
    if (wrap) updateSaveButton(Number(wrap.getAttribute('data-id')))
  })
  venuesList.addEventListener('change', (e) => {
    const wrap = e.target.closest('[data-id]')
    if (wrap) updateSaveButton(Number(wrap.getAttribute('data-id')))
  })
}

;['v-name', 'v-max-t', 'v-max-u', 'v-gran'].forEach((id) => {
  const el = document.getElementById(id)
  if (el) el.addEventListener('input', updateCreateButton)
})
const vAct = document.getElementById('v-active')
if (vAct) vAct.addEventListener('change', updateCreateButton)

async function loadVenues() {
  const res = await fetch('/api/admin/venues', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  const list = document.getElementById('venues-list')
  if (!res.ok) {
    list.innerHTML = `<div class="login-error">${json.error || 'Ошибка'}</div>`
    return
  }
  const rows = json.data || []
  if (rows.length === 0) {
    list.innerHTML = '<div class="login-sub">Пока нет площадок</div>'
    return
  }
  list.innerHTML = rows
    .map(
      (v) => `
    <div style="border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:10px;background:#fff">
      <div style="font-weight:500;margin-bottom:8px">${escapeHtml(v.name)}${v.is_active ? '' : ' <span style="color:#999">(скрыта)</span>'}</div>
      <div style="font-size:12px;color:#666;margin-bottom:8px">всего: ${v.max_total_per_slot == null ? '—' : v.max_total_per_slot} &nbsp;·&nbsp; на одного: ${v.max_per_user_per_slot == null ? '—' : v.max_per_user_per_slot} &nbsp;·&nbsp; шаг: ${v.slot_granularity_minutes} мин</div>
      <div style="display:grid;gap:6px" data-id="${v.id}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <input type="text" class="e-name" value="${escapeHtml(v.name)}" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <input type="number" class="e-mxt" min="0" placeholder="макс. всего" value="${v.max_total_per_slot == null ? '' : v.max_total_per_slot}" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px">
          <input type="number" class="e-mxu" min="0" placeholder="макс. на user" value="${v.max_per_user_per_slot == null ? '' : v.max_per_user_per_slot}" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px">
        </div>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" class="e-act" ${v.is_active ? 'checked' : ''}> Активна</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn-save admin-venues-save" data-id="${v.id}">Сохранить</button>
          <button type="button" class="btn-del" data-id="${v.id}" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Убрать из списка</button>
        </div>
      </div>
    </div>
  `
    )
    .join('')

  list.querySelectorAll('.btn-save').forEach((btn) => {
    btn.onclick = () => saveRow(Number(btn.getAttribute('data-id')))
  })
  list.querySelectorAll('.btn-del').forEach((btn) => {
    btn.onclick = () => removeVenue(Number(btn.getAttribute('data-id')))
  })
  initRowsFromServer(rows)
}

async function saveRow(id) {
  if (!isRowDirty(id)) return
  const wrap = rowWrap(id)
  if (!wrap) return
  const name = wrap.querySelector('.e-name')?.value?.trim()
  const max_total_per_slot = numOrNull(wrap.querySelector('.e-mxt')?.value)
  const max_per_user_per_slot = numOrNull(wrap.querySelector('.e-mxu')?.value)
  const is_active = wrap.querySelector('.e-act')?.checked
  if (!name) {
    showErr('Укажите название')
    return
  }
  const res = await fetch(`/api/admin/venues/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, is_active, max_total_per_slot, max_per_user_per_slot })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showErr(json.error || 'Ошибка')
    return
  }
  showOk('Сохранено')
  loadVenues()
}

async function removeVenue(id) {
  if (!confirm('Убрать площадку? Если есть записи, она будет скрыта, а не удалена.')) return
  const res = await fetch(`/api/admin/venues/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 204) {
    showOk('Удалена')
  } else {
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      showErr(json.error || 'Ошибка')
      return
    }
    showOk(json.data?.soft ? 'Скрыта (есть записи)' : 'Готово')
  }
  loadVenues()
}

document.getElementById('v-add').onclick = async () => {
  if (!isCreateDirty()) return
  const name = document.getElementById('v-name').value.trim()
  const max_total_per_slot = numOrNull(document.getElementById('v-max-t').value)
  const max_per_user_per_slot = numOrNull(document.getElementById('v-max-u').value)
  const slot_granularity_minutes = parseInt(document.getElementById('v-gran').value, 10) || 30
  const is_active = document.getElementById('v-active').checked
  if (!name) {
    showErr('Введите название')
    return
  }
  const res = await fetch('/api/admin/venues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, max_total_per_slot, max_per_user_per_slot, slot_granularity_minutes, is_active })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    showErr(json.error || 'Ошибка')
    return
  }
  showOk('Создано')
  document.getElementById('v-name').value = ''
  document.getElementById('v-max-t').value = ''
  document.getElementById('v-max-u').value = ''
  document.getElementById('v-gran').value = '30'
  document.getElementById('v-active').checked = true
  syncCreateBaseline()
  loadVenues()
}

loadVenues()
// Если браузер восстановил поля (back/refresh), кнопка должна стать активной.
updateCreateButton()
