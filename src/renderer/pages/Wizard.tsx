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
      if (m.type === 'stop') {
        // 진행/대기 중인 생성 작업 전체 취소 (이미지·영상·음악)
        pending.current = null
        musicActive.current = false
        await window.electronAPI.bridge.cancel().catch(() => {})
        post({ source: 'avs-app', type: 'stopped', boardLabel: m.boardLabel })
        return
      }
      if (m.type === 'generate') {
        pending.current = { label: m.boardLabel, kind: 'image' }
        const r = await window.electronAPI.bridge.generate(m.imgSource || 'chatgpt', m.prompt, m.referenceImages, m.aspect)
        pending.current = null
        // 이미지는 작업이 돌려준 imageId 로 "그 작업이 만든 이미지"를 정확히 요청 보드에 전달한다.
        // (onImported 의 전역 pending 경로는 Board A·B 동시 생성 시 라벨이 섞여 보드에 안 꽂힌다 —
        //  갤러리는 별도 리스너라 항상 받지만 보드는 누락된다.)
        if (!r.ok) {
          post({ source: 'avs-app', type: 'error', boardLabel: m.boardLabel, message: r.message })
        } else if (r.imageId) {
          try {
            const list = await window.electronAPI.bridge.list()
            const hit = list.find((x) => x.id === r.imageId)
            const dataUrl = hit ? await window.electronAPI.fs.readImage(hit.path) : ''
            if (dataUrl) post({ source: 'avs-app', type: 'image', boardLabel: m.boardLabel, dataUrl })
            else post({ source: 'avs-app', type: 'error', boardLabel: m.boardLabel, message: '생성된 이미지를 찾지 못했습니다' })
          } catch {
            post({ source: 'avs-app', type: 'error', boardLabel: m.boardLabel, message: '미디어 읽기 실패' })
          }
        } else {
          post({ source: 'avs-app', type: 'error', boardLabel: m.boardLabel, message: '이미지 생성 결과가 없습니다' })
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
      // 이미지는 generate 응답(imageId)으로 직접 전달하므로 여기선 영상만 처리한다.
      const p = pending.current
      if (!p || p.kind !== 'video') return
      pending.current = null
      // 영상은 base64 dataURL(수 MB) 대신 미디어 서버 URL로 전달한다.
      // 보드가 이 작은 URL만 IndexedDB에 저장하므로, 큰 dataURL 저장 실패/중단 없이
      // 페이지(사이드바)를 이동했다 돌아와도 영상이 그대로 복원된다.
      // (음악 트랙과 동일한 /media 경로 — Range 스트리밍으로 seek 도 지원)
      const name = img.path.split(/[\\/]/).pop() || ''
      if (name) {
        post({ source: 'avs-app', type: 'video', boardLabel: p.label, dataUrl: `http://127.0.0.1:${portRef.current}/media/${encodeURIComponent(name)}` })
      } else {
        post({ source: 'avs-app', type: 'video-error', boardLabel: p.label, message: '미디어 경로 확인 실패' })
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
