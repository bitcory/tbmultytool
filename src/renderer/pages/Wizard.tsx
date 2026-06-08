// "새 영상 만들기" 본문 — KT 영상제안서 페이지(proposal.html)를 임베드.
// iframe(제안서) ↔ 앱 사이 postMessage 브릿지:
//   - iframe → 앱: { source:'avs-proposal', type:'generate', boardLabel, prompt }
//   - 앱 → iframe: { source:'avs-app', type:'image'|'error', boardLabel, dataUrl|message }
// 앱은 ChatGPT 자동생성(bridge.generate)을 호출하고, 회수된 이미지를 요청한 보드로 돌려준다.
import { useEffect, useRef } from 'react'

export default function Wizard() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // 진행 중인 생성 작업: 어떤 보드의 image/video 요청인지
  const pending = useRef<{ label: string; kind: 'image' | 'video' } | null>(null)
  const musicActive = useRef(false)
  // 음악(suno)은 확장 경로에서 mp3 가 onImported(오디오)로 도착 → 여기 모았다가 결과로 전달
  const musicTracks = useRef<{ id: string; url: string; filename: string }[]>([])
  const portRef = useRef(0)

  useEffect(() => {
    window.electronAPI.bridge.getInfo().then((i) => (portRef.current = i.port)).catch(() => {})
    const post = (msg: unknown) => iframeRef.current?.contentWindow?.postMessage(msg, '*')

    // iframe → 앱: 생성 요청 (이미지 / 영상)
    const onMsg = async (e: MessageEvent) => {
      const m = e.data
      if (m?.source !== 'avs-proposal') return
      if (m.type === 'generate') {
        pending.current = { label: m.boardLabel, kind: 'image' }
        const r = await window.electronAPI.bridge.generate(m.imgSource || 'chatgpt', m.prompt, m.referenceImages, m.aspect)
        if (!r.ok) {
          pending.current = null
          post({ source: 'avs-app', type: 'error', boardLabel: m.boardLabel, message: r.message })
        }
      } else if (m.type === 'generate-video') {
        pending.current = { label: m.boardLabel, kind: 'video' }
        const r = await window.electronAPI.bridge.generateVideo(m.prompt, m.image, m.settings)
        if (!r.ok) {
          pending.current = null
          post({ source: 'avs-app', type: 'video-error', boardLabel: m.boardLabel, message: r.message })
        }
      } else if (m.type === 'generate-music') {
        musicActive.current = true
        musicTracks.current = []
        const r = await window.electronAPI.bridge.generateMusic({
          mode: m.mode,
          description: m.description,
          instrumental: m.instrumental,
          style: m.style,
          lyrics: m.lyrics,
          title: m.title
        })
        musicActive.current = false
        // 확장 경로: 트랙은 onImported 로 모은 것. (구 경로 호환: r.tracks 있으면 그것도)
        const tracks = r.tracks && r.tracks.length ? r.tracks : musicTracks.current
        post({ source: 'avs-app', type: 'music-result', ok: r.ok && tracks.length > 0, tracks, message: r.message })
      }
    }
    window.addEventListener('message', onMsg)

    // 앱 → iframe: 진행 상황 (image/video 구분)
    const offProgress = window.electronAPI.bridge.onProgress((message) => {
      if (musicActive.current) {
        post({ source: 'avs-app', type: 'music-progress', message })
        return
      }
      const p = pending.current
      if (!p) return
      post({ source: 'avs-app', type: p.kind === 'video' ? 'video-progress' : 'progress', boardLabel: p.label, message })
    })

    // 앱 → iframe: 새 미디어 도착 → 요청한 보드의 image/video 슬롯으로
    const off = window.electronAPI.bridge.onImported(async (img) => {
      // 음악(suno) mp3 도착 → 트랙 목록에 모음 (미디어 서버 URL)
      if (musicActive.current && /\.(mp3|wav)$/i.test(img.path)) {
        const name = img.path.split(/[\\/]/).pop() || ''
        musicTracks.current.push({ id: img.id, url: `http://127.0.0.1:${portRef.current}/media/${name}`, filename: img.filename })
        return
      }
      const p = pending.current
      if (!p) return
      pending.current = null
      try {
        const dataUrl = await window.electronAPI.fs.readImage(img.path)
        post({ source: 'avs-app', type: p.kind === 'video' ? 'video' : 'image', boardLabel: p.label, dataUrl })
      } catch {
        post({
          source: 'avs-app',
          type: p.kind === 'video' ? 'video-error' : 'error',
          boardLabel: p.label,
          message: '미디어 읽기 실패'
        })
      }
    })

    return () => {
      window.removeEventListener('message', onMsg)
      off()
      offProgress()
    }
  }, [])

  return (
    <iframe
      ref={iframeRef}
      src="proposal.html"
      title="영상제안서 만들기"
      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
    />
  )
}
