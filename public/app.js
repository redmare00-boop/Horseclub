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

function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && e1 > s2
}

function getBookingsForSlot(venue, date, time) {
  const startM = toMins(time)
  return bookings.filter(b => {
    if (b.venue !== venue || b.date !== date) return false
    return overlaps(startM, startM + 30, toMins(b.time), toMins(b.time) + b.duration)
  })
}

function renderGrid() {
  const grid = document.getElementById('schedule-grid')
  grid.innerHTML = ''
  document.getElementById('current-date').textContent = formatDate(currentDate)

  const timeSlots = getTimeSlots()
  const dateStr = dateToString(currentDate)

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

      const slotBookings = getBookingsForSlot(venue, dateStr, time)
      if (slotBookings.length > 0) {
        const b = slotBookings[0]
        const card = document.createElement('div')
        card.className = 'booking'
        card.textContent = `${b.horse} · ${b.discipline}`
        slot.appendChild(card)
      }

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

function saveBooking() {
  const venue = document.getElementById('f-venue').value
  const date = document.getElementById('f-date').value
  const time = document.getElementById('f-time').value
  const duration = parseInt(document.getElementById('f-dur').value)
  const horse = document.getElementById('f-horse').value.trim()
  const discipline = document.getElementById('f-disc').value

  if (!horse) {
    alert('Введите кличку лошади')
    return
  }

  if (venue === 'Манеж') {
    const myBookings = bookings.filter(b => {
      if (b.venue !== 'Манеж' || b.date !== date) return false
      return overlaps(toMins(time), toMins(time) + duration, toMins(b.time), toMins(b.time) + b.duration)
    })
    if (myBookings.length >= 3) {
      alert('Вы уже записали 3 лошади в манеж на это время')
      return
    }
  }

  bookings.push({ venue, date, time, duration, horse, discipline })
  closeModal()
  renderGrid()
}

document.getElementById('prev-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() - 1)
  renderGrid()
}

document.getElementById('next-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() + 1)
  renderGrid()
}

document.getElementById('modal-close').onclick = closeModal
document.getElementById('modal-cancel').onclick = closeModal
document.getElementById('modal-save').onclick = saveBooking

document.getElementById('modal-bg') 
document.getElementById('modal').onclick = function(e) {
  if (e.target === this) closeModal()
}

fillTimeSelect()
renderGrid()