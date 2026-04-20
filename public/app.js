const VENUES = ['Манеж', 'Предманежник', 'Бочка', 'Верхний плац', 'Нижний плац']
const START_HOUR = 7
const END_HOUR = 22

let currentDate = new Date()
let bookings = []

function formatDate(date) {
  const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек']
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

function dateToString(date) {
  return date.toISOString().split('T')[0]
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

function toMins(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

async function loadBookings() {
  const date = dateToString(currentDate)
  const res = await fetch(`/api/bookings?date=${date}`)
  const json = await res.json()
  bookings = json.data || []
  renderGrid()
}

function getBookingsForSlot(venue, time) {
  const startM = toMins(time)
  const endM = startM + 30
  return bookings.filter(b => {
    if (b.venue !== venue) return false
    const bStart = toMins(b.start_time.slice(0,5))
    const bEnd = toMins(b.end_time.slice(0,5))
    return startM < bEnd && endM > bStart
  })
}

function renderGrid() {
  const grid = document.getElementById('schedule-grid')
  grid.innerHTML = ''
  document.getElementById('current-date').textContent = formatDate(currentDate)

  const timeSlots = getTimeSlots()

  const emptyHeader = document.createElement('div')
  emptyHeader.className = 'col-header'
  grid.appendChild(emptyHeader)

  VENUES.forEach(venue => {
    const header = document.createElement('div')
    header.className = 'col-header'
    header.textContent = venue
    grid.appendChild(header)
  })

  timeSlots.forEach(time => {
    const timeCell = document.createElement('div')
    timeCell.className = 'time-cell'
    timeCell.textContent = time.endsWith(':00') ? time : ''
    grid.appendChild(timeCell)

    VENUES.forEach(venue => {
      const slot = document.createElement('div')
      slot.className = 'slot'

      const slotBookings = getBookingsForSlot(venue, time)
      slotBookings.forEach(b => {
        const card = document.createElement('div')
        card.className = 'booking'
        card.textContent = `${b.horse_name} · ${b.discipline}`
        slot.appendChild(card)
      })

      slot.onclick = () => openModal(venue, time)
      grid.appendChild(slot)
    })
  })
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

function openModal(venue, time) {
  document.getElementById('f-venue').value = venue
  document.getElementById('f-date').value = dateToString(currentDate)
  document.getElementById('f-time').value = time
  document.getElementById('f-horse').value = ''
  document.getElementById('modal').style.display = 'flex'
}

function closeModal() {
  document.getElementById('modal').style.display = 'none'
}

async function saveBooking() {
  const venue = document.getElementById('f-venue').value
  const date = document.getElementById('f-date').value
  const time = document.getElementById('f-time').value
  const duration = parseInt(document.getElementById('f-dur').value)
  const horse_name = document.getElementById('f-horse').value.trim()
  const discipline = document.getElementById('f-disc').value

  if (!horse_name) {
    alert('Введите кличку лошади')
    return
  }

  const end_time = addMinutes(time, duration)

  const res = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ horse_name, venue, discipline, booking_date: date, start_time: time, end_time })
  })

  const json = await res.json()

  if (!res.ok) {
    alert(json.error)
    return
  }

  closeModal()
  loadBookings()
}

document.getElementById('prev-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() - 1)
  loadBookings()
}

document.getElementById('next-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() + 1)
  loadBookings()
}

document.getElementById('modal-close').onclick = closeModal
document.getElementById('modal-cancel').onclick = closeModal
document.getElementById('modal-save').onclick = saveBooking

document.getElementById('modal').onclick = function(e) {
  if (e.target === this) closeModal()
}

fillTimeSelect()
loadBookings()