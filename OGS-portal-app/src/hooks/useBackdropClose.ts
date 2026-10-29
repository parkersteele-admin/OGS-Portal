import { useRef } from 'react'
import type React from 'react'

/**
 * Click-outside-to-close handlers for a modal backdrop.
 *
 * A plain `onClick={onClose}` on the backdrop also fires when a press starts
 * inside the dialog and is released over the backdrop (e.g. drag-selecting
 * text in an input), which silently discards whatever the user was typing.
 * These handlers only close when the press both starts and ends on the
 * backdrop itself.
 *
 * @example
 * const backdrop = useBackdropClose(onClose)
 * <div className="overlay" {...backdrop}>…</div>
 */
export function useBackdropClose(onClose: () => void) {
  const pressStartedOnBackdrop = useRef(false)

  return {
    onMouseDown: (e: React.MouseEvent) => {
      pressStartedOnBackdrop.current = e.target === e.currentTarget
    },
    onClick: (e: React.MouseEvent) => {
      const shouldClose = pressStartedOnBackdrop.current && e.target === e.currentTarget
      pressStartedOnBackdrop.current = false
      if (shouldClose) onClose()
    },
  }
}
