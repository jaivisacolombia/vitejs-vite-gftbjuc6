
import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

export default function InstallPWA() {
  const [promptEvent, setPromptEvent] =
    useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [showIOS, setShowIOS] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator &&
        (navigator as Navigator & { standalone?: boolean })
          .standalone === true)

    if (standalone) setInstalled(true)

    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
    }

    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!promptEvent) {
      setShowIOS(true)
      return
    }

    await promptEvent.prompt()
    const choice = await promptEvent.userChoice

    if (choice.outcome === 'accepted') {
      setPromptEvent(null)
    }
  }

  if (installed) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 85,
        left: 16,
        zIndex: 9998,
        maxWidth: 290,
      }}
    >
      {promptEvent ? (
        <button
          onClick={install}
          style={{
            background: 'linear-gradient(135deg, #7629b9, #45136b)',
            color: '#fff',
            border: '1px solid #c58aff',
            padding: '12px 17px',
            borderRadius: 14,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 24px #230b3866',
          }}
        >
          📲 Instalar JAIVISA Mayorista
        </button>
      ) : (
        <button
          onClick={() => setShowIOS(!showIOS)}
          style={{
            background: '#45136b',
            color: '#fff',
            border: '1px solid #a873da',
            padding: '10px 14px',
            borderRadius: 12,
            cursor: 'pointer',
          }}
        >
          📲 Cómo instalar JAIVISA
        </button>
      )}

      {showIOS && (
        <div
          style={{
            marginTop: 8,
            padding: 14,
            borderRadius: 12,
            background: '#230b38',
            color: '#fff',
            fontSize: 13,
            boxShadow: '0 8px 24px #0005',
          }}
        >
          <button
            onClick={() => setShowIOS(false)}
            aria-label="Cerrar instrucciones"
            style={{
              float: 'right',
              color: 'white',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>

          <strong>Instalar JAIVISA</strong>
          <p>
            En iPhone: abre esta página en Safari,
            pulsa Compartir y selecciona
            «Añadir a pantalla de inicio».
          </p>
          <p>
            En Android o computador: abre el menú
            del navegador y busca «Instalar aplicación».
          </p>
        </div>
      )}
    </div>
  )
}
