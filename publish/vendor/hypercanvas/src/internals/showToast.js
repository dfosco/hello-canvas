/**
 * Bottom-center toast for transient feedback. Lives in document.body so it
 * floats above workspace surfaces (including dialogs). Multiple toasts stack:
 * each new one is inserted above any existing ones.
 */
export function showToast(message, { duration = 3200 } = {}) {
  if (typeof document === 'undefined') return null
  const attribute = 'data-storyboard-toast'
  const stack = document.querySelectorAll(`[${attribute}]`)
  const el = document.createElement('div')
  el.setAttribute(attribute, '')
  const bottomOffset = 24 + stack.length * 44
  Object.assign(el.style, {
    position: 'fixed',
    bottom: `${bottomOffset}px`,
    left: '50%',
    transform: 'translateX(-50%) translateY(8px)',
    zIndex: '10060',
    padding: '0.5rem 0.875rem',
    borderRadius: '0.5rem',
    background: 'var(--bgColor-emphasis, #1f2328)',
    color: 'var(--fgColor-onEmphasis, #ffffff)',
    fontSize: '0.8125rem',
    fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
    opacity: '0',
    transition: 'opacity 0.15s ease, transform 0.15s ease',
    pointerEvents: 'none',
    maxWidth: '32rem',
    textAlign: 'center',
  })
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    el.style.opacity = '1'
    el.style.transform = 'translateX(-50%) translateY(0)'
  })
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(-50%) translateY(8px)'
    setTimeout(() => el.remove(), 200)
  }, duration)
  return el
}
