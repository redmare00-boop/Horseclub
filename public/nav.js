function navBackFallback() {
  try {
    if (window.history.length > 1) {
      window.history.back()
      return
    }
  } catch {}
  window.location.href = '/'
}

document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('[data-nav-back]')
  if (!btn) return
  e.preventDefault()
  navBackFallback()
})

