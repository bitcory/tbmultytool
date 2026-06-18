// 이미지 편집기 — image-editor.html(자체 캔버스 편집기)을 임베드.
// 기능: 업로드/갤러리 이미지 불러오기 → 드로잉으로 일부 지우기(투명) → 텍스트 올리기
//       (폰트/색상/크기는 카드뉴스와 동일한 FAMILIES) → 갤러리 저장 / PNG 다운로드.
// 갤러리/저장은 카드뉴스(CardNews.tsx)와 동일한 postMessage 브릿지 패턴.
import { useEffect, useRef, useState } from 'react'

// 갤러리 썸네일 (원본 dataURL → 168px JPEG) — iframe 피커 그리드용
const makeThumb = (dataUrl: string): Promise<string> =>
  new Promise((res) => {
    const im = new Image()
    im.onload = () => {
      const sc = 168 / Math.max(im.width, im.height, 1)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(im.width * sc))
      c.height = Math.max(1, Math.round(im.height * sc))
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
      res(c.toDataURL('image/jpeg', 0.75))
    }
    im.onerror = () => res(dataUrl)
    im.src = dataUrl
  })

const isImagePath = (p: string): boolean => !/\.(mp4|webm|mov|mp3|wav)$/i.test(p)

export default function ImageEditor() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const lastDlDir = useRef('') // 마지막 PNG 다운로드 폴더 (폴더 열기용)
  const [msg, setMsg] = useState('')

  const post = (data: unknown): void => frameRef.current?.contentWindow?.postMessage(data, '*')

  useEffect(() => {
    const onMsg = async (e: MessageEvent): Promise<void> => {
      const d = e.data as {
        type?: string
        id?: string
        dataUrl?: string
        filename?: string
        message?: string
      }
      try {
        if (d?.type === 'imgedit:status' && d.message) {
          setMsg(d.message)
        } else if (d?.type === 'imgedit:request-gallery') {
          // 앱 갤러리(확장으로 받아둔/생성된 이미지) 최근 36장을 썸네일로 피커에 전달
          const all = await window.electronAPI.bridge.list()
          const imgs = all.filter((i) => isImagePath(i.path)).slice(0, 36)
          const items = (
            await Promise.all(
              imgs.map(async (i) => {
                try {
                  const full = await window.electronAPI.fs.readImage(i.path)
                  return { id: i.id, thumb: await makeThumb(full) }
                } catch {
                  return null
                }
              })
            )
          ).filter(Boolean)
          post({ type: 'imgedit:gallery-list', items })
        } else if (d?.type === 'imgedit:gallery-pick' && d.id) {
          const img = (await window.electronAPI.bridge.list()).find((x) => x.id === d.id)
          if (img) {
            const dataUrl = await window.electronAPI.fs.readImage(img.path)
            post({ type: 'imgedit:gallery-image', dataUrl })
          }
        } else if (d?.type === 'imgedit:save' && d.dataUrl) {
          // 편집 결과를 갤러리에 저장 (다른 기능에서 바로 재사용 가능)
          setMsg('갤러리에 저장 중…')
          const saved = await window.electronAPI.bridge.importImage({
            source: 'edit',
            dataUrl: d.dataUrl,
            filename: d.filename || 'edited.png'
          })
          setMsg('갤러리에 저장됨 ✓')
          post({ type: 'imgedit:saved', ok: true, id: saved?.id })
        } else if (d?.type === 'imgedit:download' && d.dataUrl) {
          // PNG 다운로드: 갤러리에 저장해 경로를 얻은 뒤 저장 다이얼로그로 내보내기
          setMsg('다운로드 준비 중…')
          const saved = await window.electronAPI.bridge.importImage({
            source: 'edit',
            dataUrl: d.dataUrl,
            filename: d.filename || 'edited.png'
          })
          if (saved?.path) {
            const r = await window.electronAPI.fs.saveFileAs(saved.path, d.filename || 'edited.png')
            if (r.ok && r.path) {
              lastDlDir.current = r.path.replace(/[/\\][^/\\]*$/, '') // 파일명 제거 → 폴더 경로
              setMsg(`저장 완료: ${r.path}`)
            } else {
              setMsg('다운로드 취소')
            }
          } else {
            setMsg('다운로드 실패 — 저장 경로를 얻지 못함')
          }
        } else if (d?.type === 'imgedit:open-folder') {
          // 마지막 다운로드 폴더, 없으면 시스템 다운로드 폴더
          await window.electronAPI.fs.openPath(lastDlDir.current || '@downloads')
        }
      } catch (err) {
        setMsg('오류: ' + ((err as Error)?.message || String(err)))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <iframe
        ref={frameRef}
        src="image-editor.html"
        title="이미지 편집기"
        style={{ width: '100%', flex: 1, border: 'none', display: 'block', minHeight: 0 }}
      />
      {msg && (
        <div style={{ padding: '6px 14px', fontSize: 12.5, color: '#8c93a6', background: '#15171f', borderTop: '1px solid #2a2e3a', flexShrink: 0 }}>
          {msg}
        </div>
      )}
    </div>
  )
}
