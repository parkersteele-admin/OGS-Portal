/**
 * src/components/onboarding/PwaInstallCard.tsx
 *
 * Progressive Web App install prompt card.
 * - Wires up the beforeinstallprompt event for Chrome/Edge/Android
 * - Falls back to platform-specific manual instructions for iOS Safari
 * - Dismissible; sets pwaInstallPrompted on users/{uid} after install or dismiss
 */

import React, { useState, useEffect, useRef } from 'react'
import { Smartphone } from 'lucide-react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'

interface Props {
  uid: string
  companyId: string
}

type Platform = 'android_chrome' | 'ios_safari' | 'desktop' | 'other'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios_safari'
  if (/Android/.test(ua)) return 'android_chrome'
  if (/Win|Mac|Linux/.test(navigator.platform ?? '')) return 'desktop'
  return 'other'
}

export const PwaInstallCard: React.FC<Props> = ({ uid }) => {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [canNativeInstall, setCanNativeInstall] = useState(false)
  const platform = detectPlatform()

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setCanNativeInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const markPrompted = async () => {
    try {
      await updateDoc(doc(db, 'users', uid), { pwaInstallPrompted: true })
    } catch {
      // Non-critical
    }
  }

  const handleNativeInstall = async () => {
    if (!deferredPrompt.current) return
    await deferredPrompt.current.prompt()
    const choice = await deferredPrompt.current.userChoice
    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }
    deferredPrompt.current = null
    await markPrompted()
    setDismissed(true)
  }

  const handleDismiss = async () => {
    setDismissed(true)
    await markPrompted()
  }

  if (dismissed || installed) return null

  return (
    <div className="pwa-card">
      <button
        type="button"
        className="pwa-card__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="pwa-card__title"><Smartphone size={16} aria-hidden="true" /> Add app to your phone</span>
        <span className="pwa-card__chevron" aria-hidden="true">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="pwa-card__body">
          {canNativeInstall ? (
            <div className="pwa-card__native">
              <p className="pwa-card__desc">
                Install the OGS Portal app for quick access from your home screen.
              </p>
              <button
                type="button"
                className="ui-btn ui-btn--primary ui-btn--md"
                onClick={() => void handleNativeInstall()}
              >
                Install App
              </button>
            </div>
          ) : (
            <div className="pwa-card__manual">
              <p className="pwa-card__desc">
                Follow these steps to add OGS Portal to your home screen:
              </p>
              {platform === 'ios_safari' && (
                <ol className="pwa-card__steps">
                  <li>Tap the <strong>Share</strong> button (box with arrow) at the bottom of Safari.</li>
                  <li>Scroll down and tap <strong>&ldquo;Add to Home Screen.&rdquo;</strong></li>
                  <li>Tap <strong>&ldquo;Add&rdquo;</strong> in the top-right corner.</li>
                </ol>
              )}
              {platform === 'android_chrome' && (
                <ol className="pwa-card__steps">
                  <li>Tap the <strong>three-dot menu</strong> in the top-right of Chrome.</li>
                  <li>Tap <strong>&ldquo;Add to Home screen&rdquo;</strong> or <strong>&ldquo;Install app.&rdquo;</strong></li>
                  <li>Tap <strong>&ldquo;Add&rdquo;</strong> to confirm.</li>
                </ol>
              )}
              {platform === 'desktop' && (
                <ol className="pwa-card__steps">
                  <li>Look for the <strong>install icon</strong> (⊕) in the address bar.</li>
                  <li>Click <strong>&ldquo;Install.&rdquo;</strong></li>
                </ol>
              )}
              {platform === 'other' && (
                <p className="pwa-card__desc">
                  Use your browser&apos;s menu to add OGS Portal to your home screen or bookmark it.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className="pwa-card__dismiss"
            onClick={() => void handleDismiss()}
          >
            Maybe later
          </button>
        </div>
      )}
    </div>
  )
}
