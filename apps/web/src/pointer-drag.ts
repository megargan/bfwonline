export function trackPointerDrag(event: PointerEvent, move: (event: PointerEvent) => void, end: (event: PointerEvent) => void) {
  const source = event.currentTarget as HTMLElement
  const pointerId = event.pointerId
  event.preventDefault()
  source.setPointerCapture(pointerId)
  const onMove = (next: PointerEvent) => { if (next.pointerId === pointerId) move(next) }
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', cancel)
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId)
  }
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return
    stop()
    end(next)
  }
  const cancel = () => finish(new PointerEvent('pointercancel', { pointerId }))
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
  window.addEventListener('blur', cancel)
  return stop
}
