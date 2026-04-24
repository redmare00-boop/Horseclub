const START_HOUR = 7
const END_HOUR = 22

const token = localStorage.getItem('token')
const user = JSON.parse(localStorage.getItem('user') || 'null')

if (!token || !user) window.location.href = '/login.html'
if (user?.must_change_password) window.location.href = '/change-password.html'

function qs(name) {
  return new URL(window.location.href).searchParams.get(name)
}

let currentVenue = null

document.getElementById('user-name').textContent = user ? user.full_name : ''
if (user?.role === 'admin') {
  const link = document.getElementById('admin-users-link')
  if (link) link.style.display = 'inline-block'
  const vlink = document.getElementById('admin-venues-link')
  if (vlink) vlink.style.display = 'inline-block'
}
document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.location.href = '/login.html'
}

let selectedDate = new Date()
let calMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
let bookings = []

let toastTimer = null
function showToast(message) {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = message
  el.style.display = 'block'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.style.display = 'none'
  }, 2600)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function dateToString(date) {
  return date.toISOString().split('T')[0]
}

function formatDayTitle(date) {
  const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек']
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

function toMins(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
}

function getTimeSlots() {
  const slots = []
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`)
    slots.push(`${String(h).padStart(2,'0')}:30`)
  }
  return slots
}

async function loadBookings() {
  if (!currentVenue) return []
  const date = dateToString(selectedDate)
  const res = await fetch(`/api/bookings?date=${date}&venue_id=${currentVenue.id}`)
  const json = await res.json().catch(() => ({}))
  bookings = json.data || []
  renderDay()
  return bookings
}

function getBookingsForSlot(time) {
  const startM = toMins(time)
  const endM = startM + 30
  return bookings.filter(b => {
    const bStart = toMins(b.start_time.slice(0,5))
    const bEnd = toMins(b.end_time.slice(0,5))
    return startM < bEnd && endM > bStart
  })
}

function canAddBookingToSlot(slotBookings) {
  if (!currentVenue) return false
  const maxT = currentVenue.max_total_per_slot
  const maxU = currentVenue.max_per_user_per_slot
  if (maxT != null && slotBookings.length >= maxT) return false
  if (maxU != null) {
    const mine = slotBookings.filter((b) => b.user_id === user?.id).length
    if (mine >= maxU) return false
  }
  return true
}

function renderCalendar() {
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
  document.getElementById('cal-title').textContent = `${months[calMonth.getMonth()]} ${calMonth.getFullYear()}`

  const cal = document.getElementById('calendar')
  cal.innerHTML = ''

  const week = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
  const header = document.createElement('div')
  header.className = 'calendar-head'
  week.forEach(w => {
    const cell = document.createElement('div')
    cell.className = 'calendar-wday'
    cell.textContent = w
    header.appendChild(cell)
  })
  cal.appendChild(header)

  const grid = document.createElement('div')
  grid.className = 'calendar-grid'

  const firstDay = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1)
  const start = new Date(firstDay)
  const jsDay = (firstDay.getDay() + 6) % 7 // monday=0
  start.setDate(start.getDate() - jsDay)

  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'calendar-day' +
      (d.getMonth() === calMonth.getMonth() ? '' : ' calendar-day--muted') +
      (dateToString(d) === dateToString(selectedDate) ? ' calendar-day--active' : '')

    btn.textContent = String(d.getDate())
    btn.onclick = () => {
      selectedDate = d
      renderCalendar()
      loadBookings()
    }
    grid.appendChild(btn)
  }

  cal.appendChild(grid)
}

function renderDay() {
  document.getElementById('day-title').textContent = formatDayTitle(selectedDate)

  const wrap = document.getElementById('day-grid')
  wrap.innerHTML = ''

  const slots = getTimeSlots()
  const table = document.createElement('div')
  table.className = 'day-table'

  slots.forEach(time => {
    const row = document.createElement('div')
    row.className = 'day-row'
    const left = document.createElement('div')
    left.className = 'day-time'
    left.textContent = time.endsWith(':00') ? time : ''

    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'day-cell'

    const slotBookings = getBookingsForSlot(time)
    const count = slotBookings.length
    cell.innerHTML = count > 0
      ? `<span class="count-pill">${count}</span><span class="count-text">лошад${count === 1 ? 'ь' : (count < 5 ? 'и' : 'ей')}</span>`
      : `<span class="count-empty">свободно</span>`

    cell.onclick = () => openDetails(time)
    row.appendChild(left)
    row.appendChild(cell)
    table.appendChild(row)
  })

  wrap.appendChild(table)
}

function fillTimeSelect() {
  const select = document.getElementById('f-time')
  select.innerHTML = ''
  getTimeSlots().forEach(t => {
    const opt = document.createElement('option')
    opt.value = t
    opt.textContent = t
    select.appendChild(opt)
  })
}

function openModal(time, existingBooking) {
  // Safety: if details modal is open, hide it before opening edit/create modal.
  const detailsModal = document.getElementById('details-modal')
  if (detailsModal) detailsModal.style.display = 'none'

  document.getElementById('modal-title').textContent = existingBooking ? 'Редактировать запись' : 'Новая запись'
  document.getElementById('f-date').value = dateToString(selectedDate)
  document.getElementById('f-time').value = time
  document.getElementById('f-horse').value = existingBooking ? existingBooking.horse_name : ''
  document.getElementById('f-disc').value = existingBooking ? existingBooking.discipline : 'Конкур'
  document.getElementById('modal').dataset.editId = existingBooking ? String(existingBooking.id) : ''
  document.getElementById('modal').style.display = 'flex'
}

function closeModal() {
  document.getElementById('modal').style.display = 'none'
  document.getElementById('modal').dataset.editId = ''
}

async function saveBooking() {
  const time = document.getElementById('f-time').value
  const duration = parseInt(document.getElementById('f-dur').value)
  const horse_name = document.getElementById('f-horse').value.trim()
  const discipline = document.getElementById('f-disc').value
  const booking_date = document.getElementById('f-date').value

  if (!horse_name) {
    showToast('Введите кличку лошади')
    return
  }

  const end_time = addMinutes(time, duration)
  const editId = document.getElementById('modal').dataset.editId

  const url = editId ? `/api/bookings/${editId}` : '/api/bookings'
  const method = editId ? 'PUT' : 'POST'
  const body = editId
    ? { horse_name, discipline }
    : { horse_name, venue_id: currentVenue.id, discipline, booking_date, start_time: time, end_time }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    // UX: don't block with alert; return user to schedule.
    closeModal()
    const detailsModal = document.getElementById('details-modal')
    if (detailsModal) detailsModal.style.display = 'none'
    showToast(json.error || 'Ошибка')
    return
  }

  closeModal()
  loadBookings()
}

async function deleteBooking(id) {
  if (!confirm('Удалить эту запись?')) return
  const res = await fetch(`/api/bookings/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    alert(json.error || 'Ошибка при удалении')
    return
  }
  await loadBookings()

  // If details modal is open, refresh its list immediately.
  const detailsModal = document.getElementById('details-modal')
  const lastTime = detailsModal?.dataset?.time
  if (detailsModal && detailsModal.style.display !== 'none' && lastTime) {
    openDetails(lastTime)
  }
}

function openDetails(time) {
  // If edit/create modal was left open, close it so we don't stack modals.
  closeModal()

  const detailsModal = document.getElementById('details-modal')
  if (detailsModal) detailsModal.dataset.time = time

  const slotBookings = getBookingsForSlot(time)
  document.getElementById('details-title').textContent = `${currentVenue.name} — ${formatDayTitle(selectedDate)} — ${time}`

  const list = document.getElementById('details-list')
  if (slotBookings.length === 0) {
    list.innerHTML = '<div class="details-empty">Никого — время свободно</div>'
  } else {
    const isAdmin = user?.role === 'admin'
    list.innerHTML = `<div class="details-count">${slotBookings.length} записей на это время</div>` +
      slotBookings.map(b => {
        const mine = b.user_id === user?.id
        const canDelete = mine || isAdmin
        const canEdit = mine
        const canChat = !mine && b.user_id
        return `
          <div class="details-horse">
            <div class="details-dot ${mine ? 'details-dot-mine' : 'details-dot-other'}"></div>
            <div style="flex:1">
              <div class="details-horse-name">${b.horse_name}</div>
              <div class="details-horse-meta">${b.discipline}</div>
              ${b.user_name ? `<div class="details-horse-meta" style="margin-top:2px">автор: ${b.user_name}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px">
              ${canChat ? `<button class="mini-btn" data-chat="${b.user_id}" data-chat-name="${escapeHtml(b.user_name || '')}">Чат</button>` : ''}
              ${canEdit ? `<button class="mini-btn" data-edit="${b.id}">Ред.</button>` : ''}
              ${canDelete ? `<button class="mini-btn mini-btn-danger" data-del="${b.id}">Удал.</button>` : ''}
            </div>
          </div>
        `
      }).join('')

    list.querySelectorAll('[data-chat]').forEach(btn => {
      btn.onclick = async (e) => {
        e.preventDefault()
        e.stopPropagation()

        const otherUserId = Number(btn.getAttribute('data-chat'))
        const otherName = btn.getAttribute('data-chat-name') || 'Личный чат'
        if (!otherUserId) return

        const res = await fetch('/api/chat/channels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ user_id: otherUserId })
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          showToast(json.error || 'Ошибка открытия чата')
          return
        }

        sessionStorage.setItem('open_chat_channel', JSON.stringify({ id: json.data.id, name: otherName }))
        window.location.href = '/chat.html'
      }
    })

    list.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        deleteBooking(btn.getAttribute('data-del'))
      }
    })
    list.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const id = Number(btn.getAttribute('data-edit'))
        const b = slotBookings.find(x => x.id === id)
        if (!b) return
        detailsModal.style.display = 'none'
        openModal(time, b)
      }
    })
  }

  detailsModal.style.display = 'flex'
  const addBtn = document.getElementById('details-add-btn')
  const allowedToAdd = canAddBookingToSlot(slotBookings)
  addBtn.style.display = allowedToAdd ? 'block' : 'none'
  addBtn.onclick = () => {
    if (!allowedToAdd) {
      // This is normally hidden; keep as a safety fallback.
      showToast('В это время нельзя добавить запись на этой площадке')
      return
    }
    detailsModal.style.display = 'none'
    openModal(time)
  }

  // Optional: when slot is occupied and adding is forbidden, inform user once.
  if (!allowedToAdd && slotBookings.length > 0) {
    showToast('В это время нельзя добавить запись: смотрите список или напишите автору в чат')
  }
}

document.getElementById('cal-prev').onclick = () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1)
  renderCalendar()
}
document.getElementById('cal-next').onclick = () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1)
  renderCalendar()
}
document.getElementById('today-btn').onclick = () => {
  selectedDate = new Date()
  calMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  renderCalendar()
  loadBookings()
}

document.getElementById('modal-close').onclick = closeModal
document.getElementById('modal-cancel').onclick = closeModal
document.getElementById('modal-save').onclick = saveBooking
document.getElementById('modal').onclick = function (e) {
  if (e.target === this) closeModal()
}
document.getElementById('details-close').onclick = () => {
  document.getElementById('details-modal').style.display = 'none'
}
document.getElementById('details-modal').onclick = function (e) {
  if (e.target === this) this.style.display = 'none'
}

async function initVenue() {
  const res = await fetch('/api/venues')
  const json = await res.json().catch(() => ({}))
  const list = json.data || []
  const byId = qs('venueId')
  const byName = qs('venue')
  let v = null
  if (byId) v = list.find((x) => x.id === Number(byId))
  if (!v && byName) v = list.find((x) => x.name === byName)
  if (!v) {
    window.location.href = '/'
    return
  }
  currentVenue = v
  document.getElementById('venue-title').textContent = v.name
  document.title = `${v.name} — Horseclub`
  fillTimeSelect()
  renderCalendar()
  loadBookings()
}
initVenue()

