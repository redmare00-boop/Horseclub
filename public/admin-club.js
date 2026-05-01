const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'
if (user?.role !== 'admin') window.location.href = '/'

document.getElementById('user-name').textContent = user ? user.full_name : ''

function showError(msg) {
  const el = document.getElementById('err')
  el.textContent = String(msg || 'Ошибка')
  el.style.display = 'block'
  document.getElementById('ok').style.display = 'none'
}

function showOk(msg) {
  const el = document.getElementById('ok')
  el.textContent = String(msg || 'Готово')
  el.style.display = 'block'
  document.getElementById('err').style.display = 'none'
}

let currentLogoBase64 = ''
let logoCropState = null

function setLogoPreview(base64) {
  const wrap = document.getElementById('logo-preview')
  const img = document.getElementById('logo-img')
  if (!wrap || !img) return
  if (!base64) {
    wrap.style.display = 'none'
    img.src = ''
    return
  }
  img.src = base64
  wrap.style.display = 'flex'
}

function openLogoCropModal() {
  document.getElementById('logo-crop-modal')?.classList.add('open')
}
function closeLogoCropModal() {
  document.getElementById('logo-crop-modal')?.classList.remove('open')
  logoCropState = null
}

function logoCropClamp() {
  if (!logoCropState) return
  const canvas = document.getElementById('logo-crop-canvas')
  if (!canvas) return
  const { img } = logoCropState
  const w = canvas.width
  const h = canvas.height
  const base = Math.max(w / img.width, h / img.height)
  const s = base * logoCropState.scale
  const dw = img.width * s
  const dh = img.height * s
  const minCx = w - dw / 2
  const maxCx = dw / 2
  const minCy = h - dh / 2
  const maxCy = dh / 2
  logoCropState.cx = Math.min(Math.max(logoCropState.cx, minCx), maxCx)
  logoCropState.cy = Math.min(Math.max(logoCropState.cy, minCy), maxCy)
}

function logoCropRender() {
  if (!logoCropState) return
  const canvas = document.getElementById('logo-crop-canvas')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const { img, cx, cy, scale } = logoCropState
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#f6f6f6'
  ctx.fillRect(0, 0, w, h)
  const base = Math.max(w / img.width, h / img.height)
  const s = base * scale
  const dw = img.width * s
  const dh = img.height * s
  const dx = cx - dw / 2
  const dy = cy - dh / 2
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
}

function logoCropApplySquareBase64() {
  if (!logoCropState) return ''
  const srcCanvas = document.getElementById('logo-crop-canvas')
  if (!srcCanvas) return ''

  const OUT = 512
  const out = document.createElement('canvas')
  out.width = OUT
  out.height = OUT
  const ctx = out.getContext('2d')

  const { img, cx, cy, scale } = logoCropState
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

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('Не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
}

async function pickLogoWithCrop(file) {
  if (!file) return
  if (file.size > 2 * 1024 * 1024) throw new Error('Логотип слишком большой (макс 2 МБ)')
  const dataUrl = await fileToDataUrl(file)
  const img = await new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('Не удалось загрузить изображение'))
    im.src = dataUrl
  })
  const canvas = document.getElementById('logo-crop-canvas')
  logoCropState = {
    img,
    cx: (canvas?.width || 320) / 2,
    cy: (canvas?.height || 320) / 2,
    scale: 1,
    drag: null
  }
  const zoom = document.getElementById('logo-crop-zoom')
  if (zoom) zoom.value = '1'
  logoCropClamp()
  logoCropRender()
  openLogoCropModal()
}

async function loadClub() {
  const res = await fetch('/api/admin/club', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json.data
}

async function saveClub(payload) {
  const res = await fetch('/api/admin/club', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json.data
}

async function refresh() {
  const c = await loadClub()
  document.getElementById('club-name').value = c.name || ''
  document.getElementById('club-address').value = c.address || ''
  document.getElementById('club-coords').value = c.coords || ''
  document.getElementById('club-mercury').value = c.mercury_id || ''
  currentLogoBase64 = c.logo_url || ''
  setLogoPreview(currentLogoBase64)
}

document.getElementById('club-logo')?.addEventListener('change', async function () {
  const file = this.files?.[0]
  if (!file) return
  try {
    await pickLogoWithCrop(file)
  } catch (e) {
    showError(e?.message || 'Не удалось обработать логотип')
  } finally {
    this.value = ''
  }
})

// crop modal bindings
;(function bindLogoCropper() {
  const modal = document.getElementById('logo-crop-modal')
  const canvas = document.getElementById('logo-crop-canvas')
  if (!modal || !canvas) return

  const pointerDown = (e) => {
    if (!logoCropState) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)
    logoCropState.drag = { x, y, cx: logoCropState.cx, cy: logoCropState.cy }
    canvas.setPointerCapture?.(e.pointerId)
  }
  const pointerMove = (e) => {
    if (!logoCropState?.drag) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)
    const dx = x - logoCropState.drag.x
    const dy = y - logoCropState.drag.y
    logoCropState.cx = logoCropState.drag.cx + dx
    logoCropState.cy = logoCropState.drag.cy + dy
    logoCropClamp()
    logoCropRender()
  }
  const pointerUp = () => {
    if (!logoCropState) return
    logoCropState.drag = null
  }
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerUp)
  canvas.addEventListener('pointercancel', pointerUp)

  document.getElementById('logo-crop-close')?.addEventListener('click', closeLogoCropModal)
  document.getElementById('logo-crop-cancel')?.addEventListener('click', closeLogoCropModal)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLogoCropModal()
  })
  document.getElementById('logo-crop-zoom')?.addEventListener('input', (e) => {
    if (!logoCropState) return
    logoCropState.scale = Number(e.target.value) || 1
    logoCropClamp()
    logoCropRender()
  })
  document.getElementById('logo-crop-apply')?.addEventListener('click', () => {
    const base64 = logoCropApplySquareBase64()
    if (!base64) return
    currentLogoBase64 = base64
    setLogoPreview(currentLogoBase64)
    closeLogoCropModal()
    showOk('Логотип выбран')
  })
})()

document.getElementById('logo-clear')?.addEventListener('click', () => {
  currentLogoBase64 = ''
  setLogoPreview('')
})

document.getElementById('save-btn')?.addEventListener('click', async () => {
  const payload = {
    name: document.getElementById('club-name').value.trim(),
    logo_url: currentLogoBase64,
    address: document.getElementById('club-address').value.trim(),
    coords: document.getElementById('club-coords').value.trim(),
    mercury_id: document.getElementById('club-mercury').value.trim()
  }
  try {
    await saveClub(payload)
    // After save return to admin root
    window.location.href = '/admin.html'
  } catch (e) {
    showError(e?.message || 'Не удалось сохранить')
  }
})

document.getElementById('cancel-btn')?.addEventListener('click', () => {
  window.location.href = '/admin.html'
})

refresh().catch((e) => showError(e?.message || 'Не удалось загрузить'))

