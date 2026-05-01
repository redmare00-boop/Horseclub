const token = localStorage.getItem('token')
const me = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !me) window.location.href = '/login.html'
if (me?.must_change_password) window.location.href = '/change-password.html'

function resetViewportScale() {
  // iOS: after focusing inputs, Safari can keep zoom. Force scale back to 1.
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  const base = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0'
  try {
    meta.setAttribute('content', base)
    setTimeout(() => meta.setAttribute('content', base), 50)
  } catch {}
}

function showError(msg) {
  const el = document.getElementById('err')
  if (!el) return alert(msg)
  el.textContent = String(msg || 'Ошибка')
  el.style.display = 'block'
  const ok = document.getElementById('ok')
  if (ok) ok.style.display = 'none'
}

function showOk(msg) {
  const el = document.getElementById('ok')
  if (!el) return alert(msg)
  el.textContent = String(msg || 'Готово')
  el.style.display = 'block'
  const err = document.getElementById('err')
  if (err) err.style.display = 'none'
  setTimeout(() => {
    try { el.style.display = 'none' } catch {}
  }, 2500)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function initials(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  const parts = s.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] || '?'
  const b = (parts[1]?.[0] || '')
  return (a + b).toUpperCase()
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

async function openUserCard(userId) {
  // Prefer in-chat card (rich UX). If user is not in chat page, do a quick direct chat open.
  try {
    // If chat modal exists on this page (future reuse), call it.
    if (typeof window.openUserCard === 'function') return await window.openUserCard(userId)
  } catch {}
  // fallback: just open direct chat with the user
  const p = await fetch(`/api/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, status: r.status, j })))
  if (!p.ok) throw new Error(p?.j?.error || `HTTP ${p.status}`)
  const u = p.j.data
  const name = String(u?.full_name || u?.nickname || u?.login || '').trim()
  await ensureDirectChatWith(Number(userId), name)
}

const TYPE_LABELS = {
  vaccination: 'Вакцинации',
  deworming: 'Дегельминтизация',
  hoof_care: 'Расчистка / ковка'
}

const TYPE_ICONS = {
  vaccination: '💉',
  deworming: '🔬',
  hoof_care: '🔧'
}

let horses = []
let myHorseIds = new Set()
let activeScope = 'active'
let allActiveUsers = []

// ---- crop state ----
let cropState = null

function openCropModal() {
  document.getElementById('crop-modal')?.classList.add('open')
}

function closeCropModal() {
  document.getElementById('crop-modal')?.classList.remove('open')
  cropState = null
}

function cropRender() {
  if (!cropState) return
  const canvas = document.getElementById('crop-canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const { img, cx, cy, scale } = cropState

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  // background
  ctx.fillStyle = '#f6f6f6'
  ctx.fillRect(0, 0, w, h)

  // draw image: keep crop square fully covered
  const base = Math.max(w / img.width, h / img.height)
  const s = base * scale
  const dw = img.width * s
  const dh = img.height * s
  const dx = cx - dw / 2
  const dy = cy - dh / 2
  ctx.drawImage(img, dx, dy, dw, dh)

  // subtle border
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
}

function cropClamp() {
  if (!cropState) return
  const canvas = document.getElementById('crop-canvas')
  if (!canvas) return
  const { img } = cropState
  const w = canvas.width
  const h = canvas.height
  const base = Math.max(w / img.width, h / img.height)
  const s = base * cropState.scale
  const dw = img.width * s
  const dh = img.height * s
  // ensure image covers the canvas
  const minCx = w - dw / 2
  const maxCx = dw / 2
  const minCy = h - dh / 2
  const maxCy = dh / 2
  cropState.cx = Math.min(Math.max(cropState.cx, minCx), maxCx)
  cropState.cy = Math.min(Math.max(cropState.cy, minCy), maxCy)
}

function cropApplySquareBase64() {
  if (!cropState) return null
  const srcCanvas = document.getElementById('crop-canvas')
  if (!srcCanvas) return null

  const OUT = 900
  const out = document.createElement('canvas')
  out.width = OUT
  out.height = OUT
  const ctx = out.getContext('2d')

  // Re-render into OUT for better quality
  const { img, cx, cy, scale } = cropState
  const base = Math.max(OUT / img.width, OUT / img.height)
  const s = base * scale
  const dw = img.width * s
  const dh = img.height * s
  const dx = cx * (OUT / srcCanvas.width) - dw / 2
  const dy = cy * (OUT / srcCanvas.height) - dh / 2
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, OUT, OUT)
  ctx.drawImage(img, dx, dy, dw, dh)
  return out.toDataURL('image/jpeg', 0.86)
}

function qs() {
  const p = new URLSearchParams(window.location.search)
  return {
    scope: String(p.get('scope') || '').toLowerCase()
  }
}

function setScope(scope) {
  activeScope = scope
  document.querySelectorAll('[data-scope]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-scope') === scope)
  })
  renderGrid()
}

async function loadMyHorses() {
  const res = await fetch('/api/horses/mine', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  myHorseIds = new Set((json.data || []).map((h) => Number(h.id)))
}

async function loadActiveUsers() {
  // we use /api/users; archived users should not be horse owners in directory
  const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  allActiveUsers = (json.data || []).filter((u) => !u.deleted)
}

async function loadHorses() {
  const res = await fetch('/api/horses', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  horses = json
}

function isMine(h) {
  return myHorseIds.has(Number(h?.id))
}

function horseSubtitle(h) {
  const parts = []
  if (h.sex) parts.push(h.sex)
  if (h.color) parts.push(h.color)
  if (h.birth_year) parts.push(String(h.birth_year))
  return parts.filter(Boolean).join(' · ')
}

function getBadges(medical) {
  const types = ['vaccination', 'deworming', 'teeth_filing', 'hoof_trimming', 'shoeing']
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const soon = new Date(today); soon.setDate(today.getDate() + 30)
  return types.map((type) => {
    const last = (medical || []).filter((m) => m.record_type === type)[0]
    const label = TYPE_LABELS[type] || type
    if (!last) return `<span class="badge none">${TYPE_ICONS[type] || ''} ${escapeHtml(label)}</span>`
    if (!last.next_date) return `<span class="badge ok">${TYPE_ICONS[type] || ''} ${escapeHtml(label)}</span>`
    const next = new Date(last.next_date)
    if (next < today) return `<span class="badge due">${TYPE_ICONS[type] || ''} ${escapeHtml(label)} ⚠</span>`
    if (next <= soon) return `<span class="badge soon">${TYPE_ICONS[type] || ''} ${escapeHtml(label)} !</span>`
    return `<span class="badge ok">${TYPE_ICONS[type] || ''} ${escapeHtml(label)}</span>`
  }).join('')
}

function filteredHorses() {
  if (activeScope === 'mine') return horses.filter(isMine)
  return horses
}

function renderGrid() {
  const listEl = document.getElementById('horses-list')
  if (!listEl) return
  const list = filteredHorses()
  if (!list.length) {
    listEl.innerHTML = `<div style="color:#999;padding:18px 0">Лошадей нет</div>`
    return
  }

  listEl.innerHTML = list
    .map((h) => {
      const mine = isMine(h)
      const title = escapeHtml(h.name || '—')
      const photo = String(h.photo_url || '').trim()
      const ownerId = Number(h.owner_user_id)
      const ownerNameRaw = String(h.owner_full_name || h.owner || '').trim()
      const ownerLoginRaw = String(h.owner_login || '').trim()
      const ownerLabel = escapeHtml(ownerNameRaw || (ownerLoginRaw ? `@${ownerLoginRaw}` : '—'))
      const ownerClickable = Number.isFinite(ownerId) && ownerId > 0 && Number(ownerId) !== Number(me.id)

      return `
        <div class="person-row horse-row" data-id="${h.id}">
          <div class="person-left">
            <div class="person-ava">
              ${photo ? `<img src="${escapeHtml(photo)}" alt="${title}" onerror="this.remove();this.parentElement.textContent='🐴'">` : '🐴'}
            </div>
            <div class="person-main">
              <div class="person-name">${title}${mine ? ` <span style="color:#085041;font-weight:700">· моя</span>` : ''}</div>
              <div class="person-meta">
                Владелец:
                ${
                  ownerClickable
                    ? `<a href="#" class="horse-owner-link" data-owner="${ownerId}">${ownerLabel}</a>`
                    : `<span style="color:#666">${ownerLabel}</span>`
                }
              </div>
            </div>
          </div>
        </div>
      `
    })
    .join('')

  listEl.querySelectorAll('.horse-owner-link[data-owner]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      const ownerId = Number(el.getAttribute('data-owner'))
      if (!Number.isFinite(ownerId) || ownerId <= 0) return
      try {
        await openUserCard(ownerId)
      } catch (err) {
        showError(err?.message || 'Не удалось открыть владельца')
      }
    })
  })

  listEl.querySelectorAll('.horse-row[data-id]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = Number(el.getAttribute('data-id'))
      if (!Number.isFinite(id)) return
      await openHorse(id)
    })
  })
}

function fillOwnerSelect(value) {
  const sel = document.getElementById('f-owner-user')
  if (!sel) return
  sel.innerHTML = allActiveUsers
    .map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)} (@${escapeHtml(u.login)})</option>`)
    .join('')
  sel.value = value ? String(value) : String(me.id)
}

function openModal() {
  document.getElementById('horse-modal')?.classList.add('open')
}

function closeModal() {
  document.getElementById('horse-modal')?.classList.remove('open')
  document.getElementById('add-med-form').style.display = 'none'
  resetViewportScale()
}

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'))
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
  document.getElementById('tab-' + name)?.classList.add('active')
  document.querySelector(`[data-tab="${name}"]`)?.classList.add('active')
}

function clearForm() {
  ;['f-name', 'f-color', 'f-year', 'f-chip', 'f-passport', 'f-notes'].forEach((id) => {
    const el = document.getElementById(id)
    if (el) el.value = ''
  })
  document.getElementById('f-sex').value = ''
  fillOwnerSelect(String(me.id))
  document.getElementById('horse-id').value = ''
  document.getElementById('photo-img').style.display = 'none'
  document.getElementById('photo-img').src = ''
  document.getElementById('photo-placeholder').style.display = 'block'
  document.getElementById('med-list').innerHTML = '<div style="color:#aaa;font-size:.85rem;">Сначала сохраните лошадь</div>'
  window._pendingPhotoBase64 = null
}

function previewPhoto(input) {
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    showError('Фото слишком большое (макс 5 МБ)')
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      // Open cropper (1:1)
      const canvas = document.getElementById('crop-canvas')
      cropState = {
        img,
        cx: (canvas?.width || 320) / 2,
        cy: (canvas?.height || 320) / 2,
        scale: 1,
        drag: null
      }
      const zoom = document.getElementById('crop-zoom')
      if (zoom) zoom.value = '1'
      cropClamp()
      cropRender()
      openCropModal()
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('ru-RU')
}

function normalizeMedItem(m) {
  const type = String(m?.record_type || '').trim()
  const subtype = String(m?.record_subtype || '').trim()
  // Back-compat mapping from older types
  if (type === 'hoof_trimming') return { ...m, record_type: 'hoof_care', record_subtype: 'trim' }
  if (type === 'shoeing') return { ...m, record_type: 'hoof_care', record_subtype: 'shoeing' }
  if (type === 'teeth_filing') return null // no longer used in UI
  return m
}

function medTitle(m) {
  const type = String(m?.record_type || '').trim()
  if (type === 'hoof_care') {
    const s = String(m?.record_subtype || '').trim()
    return s === 'shoeing' ? '🐴 Ковка' : '🔧 Расчистка'
  }
  return `${TYPE_ICONS[type] || ''} ${TYPE_LABELS[type] || type}`.trim()
}

function renderMedSection(title, items) {
  if (!items.length) return `
    <div style="margin-top:10px">
      <div style="font-weight:600;color:#333;margin-bottom:6px">${escapeHtml(title)}</div>
      <div style="color:#999;font-size:12px">Записей нет</div>
    </div>
  `
  return `
    <div style="margin-top:10px">
      <div style="font-weight:600;color:#333;margin-bottom:6px">${escapeHtml(title)}</div>
      <div class="med-list">
        ${items
          .map((m) => `
            <div class="med-item">
              <div class="med-item-info">
                <div class="med-type">${escapeHtml(medTitle(m))}</div>
                <div class="med-dates">${fmtDate(m.event_date)}</div>
                ${m.description ? `<div class="med-sub">${escapeHtml(m.description)}</div>` : ''}
              </div>
              <button class="btn-del-med" type="button" data-med="${m.id}">✕</button>
            </div>
          `)
          .join('')}
      </div>
    </div>
  `
}

function renderMedList(medical) {
  const list = document.getElementById('med-list')
  if (!list) return
  const normalized = (medical || [])
    .map(normalizeMedItem)
    .filter(Boolean)

  const vacc = normalized.filter((m) => m.record_type === 'vaccination')
  const deworm = normalized.filter((m) => m.record_type === 'deworming')
  const hoof = normalized.filter((m) => m.record_type === 'hoof_care')

  list.innerHTML =
    renderMedSection('Вакцинации', vacc) +
    renderMedSection('Дегельминтизация', deworm) +
    renderMedSection('Расчистка / ковка', hoof)

  list.querySelectorAll('button[data-med]').forEach((btn) => {
    btn.onclick = async () => {
      const medId = Number(btn.getAttribute('data-med'))
      if (!Number.isFinite(medId)) return
      await deleteMed(medId)
    }
  })
}

let currentHorseId = null

async function openAddHorse() {
  currentHorseId = null
  document.getElementById('modal-title').textContent = 'Новая лошадь'
  document.getElementById('btn-delete').style.display = 'none'
  document.getElementById('btn-toggle-med').style.display = 'none'
  clearForm()
  switchTab('info')
  openModal()
}

async function openHorse(id) {
  const res = await fetch(`/api/horses/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  const h = json
  currentHorseId = id

  document.getElementById('modal-title').textContent = h.name || 'Лошадь'
  document.getElementById('horse-id').value = id

  document.getElementById('f-name').value = h.name || ''
  document.getElementById('f-color').value = h.color || ''
  document.getElementById('f-sex').value = h.sex || ''
  document.getElementById('f-year').value = h.birth_year || ''
  document.getElementById('f-chip').value = h.chip_number || ''
  document.getElementById('f-passport').value = h.passport_number || ''
  document.getElementById('f-notes').value = h.notes || ''
  fillOwnerSelect(h.owner_user_id || me.id)

  window._pendingPhotoBase64 = null
  if (h.photo_url) {
    document.getElementById('photo-img').src = h.photo_url
    document.getElementById('photo-img').style.display = 'block'
    document.getElementById('photo-placeholder').style.display = 'none'
  } else {
    document.getElementById('photo-img').style.display = 'none'
    document.getElementById('photo-placeholder').style.display = 'block'
  }

  const isOwner = Number(h.owner_user_id) === Number(me.id) || me.role === 'admin'
  document.getElementById('btn-delete').style.display = isOwner ? 'inline-flex' : 'none'
  document.getElementById('btn-toggle-med').style.display = isOwner ? 'inline-flex' : 'none'
  document.getElementById('save-btn').style.display = isOwner ? 'inline-flex' : 'none'

  // owner link
  const ownerWrap = document.getElementById('horse-owner-link')
  if (ownerWrap) {
    const ownerId = Number(h.owner_user_id)
    const ownerName = h.owner_full_name || h.owner || ''
    const ownerLogin = h.owner_login || ''
    if (Number.isFinite(ownerId) && ownerId && !h.owner_deleted && !h.owner_archived) {
      ownerWrap.innerHTML = `<a href="#" class="user-card-phone" id="owner-open">${escapeHtml(ownerName || ownerLogin || 'Владелец')}</a>`
      ownerWrap.querySelector('#owner-open')?.addEventListener('click', async (e) => {
        e.preventDefault()
        if (Number(ownerId) === Number(me.id)) return
        await openUserCard(ownerId)
      })
    } else {
      ownerWrap.innerHTML = `<span style="color:#666">${escapeHtml(ownerName || '—')}</span>`
    }
  }

  renderMedList(h.medical || [])
  switchTab('info')
  openModal()
}

async function saveHorse() {
  const id = document.getElementById('horse-id').value
  const payload = {
    name: document.getElementById('f-name').value.trim(),
    color: document.getElementById('f-color').value.trim(),
    sex: document.getElementById('f-sex').value.trim(),
    birth_year: document.getElementById('f-year').value || null,
    chip_number: document.getElementById('f-chip').value.trim(),
    passport_number: document.getElementById('f-passport').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    owner_user_id: Number(document.getElementById('f-owner-user')?.value || me.id) || me.id,
    photo_url: window._pendingPhotoBase64 || document.getElementById('photo-img').src || null
  }
  if (!payload.name) return alert('Укажите кличку')
  if (!payload.color) return alert('Укажите масть')
  if (!payload.sex) return alert('Укажите пол')
  if (!payload.birth_year) return alert('Укажите год рождения')
  if (payload.photo_url === '') payload.photo_url = null

  const url = id ? `/api/horses/${id}` : '/api/horses'
  const method = id ? 'PUT' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return showError(json?.error || `Не удалось сохранить (HTTP ${res.status})`)

  if (!id) {
    currentHorseId = json.id
    document.getElementById('horse-id').value = json.id
    document.getElementById('modal-title').textContent = json.name
    document.getElementById('btn-delete').style.display = 'inline-flex'
    document.getElementById('btn-toggle-med').style.display = 'inline-flex'
  }
  window._pendingPhotoBase64 = null
  await Promise.all([loadHorses(), loadMyHorses()])
  renderGrid()
  closeModal()
  setScope('mine')
  showOk('Сохранено')
  resetViewportScale()
}

async function deleteHorse() {
  if (!currentHorseId) return
  if (!confirm('Удалить лошадь и все записи ветпроцедур?')) return
  const res = await fetch(`/api/horses/${currentHorseId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return alert(json?.error || `Не удалось удалить (HTTP ${res.status})`)
  closeModal()
  await Promise.all([loadHorses(), loadMyHorses()])
  renderGrid()
}

function toggleAddMed() {
  const f = document.getElementById('add-med-form')
  if (!f) return
  f.style.display = f.style.display === 'none' ? 'block' : 'none'
}

async function saveMedRecord() {
  if (!currentHorseId) return alert('Сначала сохраните лошадь')
  const type = document.getElementById('m-type').value
  const payload = {
    record_type: type,
    record_subtype: null,
    event_date: document.getElementById('m-date').value,
    description: document.getElementById('m-desc').value.trim()
  }
  if (!payload.event_date) return alert('Укажите дату')
  if (type === 'vaccination') {
    if (!payload.description) return alert('Укажите: от чего прививка')
  }
  if (type === 'deworming') {
    if (!payload.description) return alert('Укажите препарат')
  }
  if (type === 'hoof_care') {
    payload.record_subtype = document.getElementById('m-hoof-kind')?.value || 'trim'
    payload.description = '' // optional
  }
  const res = await fetch(`/api/horses/${currentHorseId}/medical`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  })
  if (!res.ok) return alert('Не удалось добавить запись')
  const updated = await fetch(`/api/horses/${currentHorseId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())
  renderMedList(updated.medical || [])
  document.getElementById('add-med-form').style.display = 'none'
  ;['m-date', 'm-desc'].forEach((id) => (document.getElementById(id).value = ''))
  await loadHorses()
  renderGrid()
  resetViewportScale()
}

async function deleteMed(medId) {
  if (!currentHorseId) return
  if (!confirm('Удалить эту запись?')) return
  await fetch(`/api/horses/${currentHorseId}/medical/${medId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  const updated = await fetch(`/api/horses/${currentHorseId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())
  renderMedList(updated.medical || [])
  await loadHorses()
  renderGrid()
}

function bindUi() {
  document.getElementById('horse-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal()
  })

  document.getElementById('add-horse-btn')?.addEventListener('click', openAddHorse)
  document.getElementById('modal-close')?.addEventListener('click', closeModal)
  document.getElementById('save-btn')?.addEventListener('click', saveHorse)
  document.getElementById('btn-delete')?.addEventListener('click', deleteHorse)

  document.getElementById('tab-info-btn')?.addEventListener('click', () => switchTab('info'))
  document.getElementById('tab-med-btn')?.addEventListener('click', () => switchTab('medical'))

  document.getElementById('btn-toggle-med')?.addEventListener('click', toggleAddMed)
  document.getElementById('btn-med-cancel')?.addEventListener('click', toggleAddMed)
  document.getElementById('btn-med-save')?.addEventListener('click', saveMedRecord)

  // med form dynamic fields
  function syncMedForm() {
    const type = document.getElementById('m-type')?.value || 'vaccination'
    const label = document.getElementById('m-desc-label')
    const hoofRow = document.getElementById('m-hoof-row')
    const descRow = document.getElementById('m-desc-row')
    if (type === 'vaccination') {
      if (label) label.textContent = 'От чего (название прививки) *'
      if (descRow) descRow.style.display = ''
      if (hoofRow) hoofRow.style.display = 'none'
    } else if (type === 'deworming') {
      if (label) label.textContent = 'Препарат *'
      if (descRow) descRow.style.display = ''
      if (hoofRow) hoofRow.style.display = 'none'
    } else {
      if (descRow) descRow.style.display = 'none'
      if (hoofRow) hoofRow.style.display = ''
    }
  }
  document.getElementById('m-type')?.addEventListener('change', syncMedForm)
  syncMedForm()

  document.querySelectorAll('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => setScope(btn.getAttribute('data-scope')))
  })

  document.getElementById('f-photo')?.addEventListener('change', function () { previewPhoto(this) })
  document.getElementById('photo-pick')?.addEventListener('click', () => document.getElementById('f-photo')?.click())

  // crop modal
  const cropCanvas = document.getElementById('crop-canvas')
  if (cropCanvas) {
    const pointerDown = (e) => {
      if (!cropState) return
      const rect = cropCanvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (cropCanvas.width / rect.width)
      const y = (e.clientY - rect.top) * (cropCanvas.height / rect.height)
      cropState.drag = { x, y, cx: cropState.cx, cy: cropState.cy }
      cropCanvas.setPointerCapture?.(e.pointerId)
    }
    const pointerMove = (e) => {
      if (!cropState?.drag) return
      const rect = cropCanvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (cropCanvas.width / rect.width)
      const y = (e.clientY - rect.top) * (cropCanvas.height / rect.height)
      const dx = x - cropState.drag.x
      const dy = y - cropState.drag.y
      cropState.cx = cropState.drag.cx + dx
      cropState.cy = cropState.drag.cy + dy
      cropClamp()
      cropRender()
    }
    const pointerUp = () => {
      if (!cropState) return
      cropState.drag = null
    }
    cropCanvas.addEventListener('pointerdown', pointerDown)
    cropCanvas.addEventListener('pointermove', pointerMove)
    cropCanvas.addEventListener('pointerup', pointerUp)
    cropCanvas.addEventListener('pointercancel', pointerUp)
  }

  document.getElementById('crop-close')?.addEventListener('click', () => closeCropModal())
  document.getElementById('crop-cancel')?.addEventListener('click', () => closeCropModal())
  document.getElementById('crop-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCropModal()
  })
  document.getElementById('crop-zoom')?.addEventListener('input', (e) => {
    if (!cropState) return
    cropState.scale = Number(e.target.value) || 1
    cropClamp()
    cropRender()
  })
  document.getElementById('crop-apply')?.addEventListener('click', () => {
    const base64 = cropApplySquareBase64()
    if (!base64) return
    window._pendingPhotoBase64 = base64
    document.getElementById('photo-img').src = base64
    document.getElementById('photo-img').style.display = 'block'
    document.getElementById('photo-placeholder').style.display = 'none'
    closeCropModal()
    // reset file input so selecting same photo again works
    const file = document.getElementById('f-photo')
    if (file) file.value = ''
  })
}

async function init() {
  bindUi()
  await Promise.all([loadActiveUsers(), loadHorses(), loadMyHorses()])
  fillOwnerSelect(String(me.id))
  const { scope } = qs()
  setScope(scope === 'mine' ? 'mine' : 'active')
}

init().catch((e) => {
  const list = document.getElementById('horses-list')
  if (list) list.innerHTML = `<div class="login-error">Не удалось загрузить (${escapeHtml(e?.message || 'ошибка')})</div>`
  showError(e?.message || 'Не удалось загрузить')
})

