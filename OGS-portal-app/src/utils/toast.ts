/**
 * src/utils/toast.ts
 *
 * Minimal programmatic toast using a simple browser alert fallback.
 * Replace with a proper toast library (sonner, react-hot-toast) when needed.
 */

type ToastFn = (message: string) => void

function show(message: string, type: 'info' | 'error' | 'success') {
  // Dispatch a custom DOM event — pages/layouts can listen and render toasts
  const event = new CustomEvent('ogs:toast', { detail: { message, type } })
  window.dispatchEvent(event)
  // Fallback: console
  if (type === 'error') console.error(`[toast] ${message}`)
  else console.log(`[toast] ${message}`)
}

export const toast = {
  info:    ((msg) => show(msg, 'info'))    as ToastFn,
  success: ((msg) => show(msg, 'success')) as ToastFn,
  error:   ((msg) => show(msg, 'error'))   as ToastFn,
}
