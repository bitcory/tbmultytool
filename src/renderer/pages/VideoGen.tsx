import { useEffect, useRef, useState } from 'react'
import { Film, Sparkles, Loader2, X, Square, Trash2, CheckSquare, Download } from 'lucide-react'
import type { ImportedImage } from '@shared/types'

const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const DURATIONS = [
  { v: '6', label: '6초' },
  { v: '10', label: '10초' }
]
const RESOLUTIONS = [
  { v: '480p', label: '480p' },
  { v: '480p-upscale', label: '480p→720p' },
  { v: '720p', label: '720p' }
]
const isVideoPath = (p: string) => /\.(mp4|webm|mov)$/i.test(p)

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = rej
    fr.readAsDataURL(f)
  })

function VideoTile({
  img,
  selMode,
  selected,
  onToggleSel
}: {
  img: ImportedImage
  selMode: boolean
  selected: boolean
  onToggleSel: () => void
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    window.electronAPI.fs.readImage(img.path).then(setSrc).catch(() => setSrc(''))
  }, [img.path])
  return (
    <div
      className={`igen-tile ${selMode && selected ? 'sel' : ''}`}
      title={img.filename}
      onClick={() => (selMode ? onToggleSel() : window.electronAPI.fs.openPath(img.path))}
    >
      {src ? (
        <video src={src} muted loop playsInline onMouseOver={(e) => e.currentTarget.play()} onMouseOut={(e) => e.currentTarget.pause()} />
      ) : (
        <div className="igen-tile-empty">로딩…</div>
      )}
      <span className="igen-tile-badge">{img.source}</span>
    </div>
  )
}

export default function VideoGen() {
  const [image, setImage] = useState('') // 입력 이미지(dataUrl)
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [duration, setDuration] = useState('6')
  const [resolution, setResolution] = useState('720p')
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [videos, setVideos] = useState<ImportedImage[]>([])
  const [loadingN, setLoadingN] = useState(0)
  const [selMode, setSelMode] = useState(false)
  const [selIds, setSelIds] = useState<Set<string>>(new Set())
  const pendingCount = useRef(0)

  const savedIds = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem('vgen-ids') || '[]')
    } catch {
      return []
    }
  }

  useEffect(() => {
    const ids = new Set(savedIds())
    if (ids.size === 0) return
    window.electronAPI.bridge.list().then((all) => {
      setVideos(all.filter((i) => ids.has(i.id) && isVideoPath(i.path)))
    })
  }, [])

  useEffect(() => {
    const off = window.electronAPI.bridge.onImported((img) => {
      if (pendingCount.current <= 0 || !isVideoPath(img.path)) return
      setVideos((prev) => [img, ...prev.filter((p) => p.id !== img.id)])
      localStorage.setItem('vgen-ids', JSON.stringify([img.id, ...savedIds()].slice(0, 300)))
      pendingCount.current = Math.max(0, pendingCount.current - 1)
      setLoadingN(pendingCount.current)
      if (pendingCount.current <= 0) {
        setGenerating(false)
        setMsg('완료')
      } else {
        setMsg(`영상 받는 중… (남은 ${pendingCount.current})`)
      }
    })
    const offP = window.electronAPI.bridge.onProgress((m) => {
      if (pendingCount.current > 0) setMsg(m)
    })
    return () => {
      off()
      offP()
    }
  }, [])

  const attachFile = async (files: FileList | File[]) => {
    const f = Array.from(files).find((x) => x.type.startsWith('image/'))
    if (f) setImage(await fileToDataUrl(f))
  }

  const run = async () => {
    if (!image) {
      setMsg('입력 이미지를 첨부하세요 (Grok 은 이미지→영상)')
      return
    }
    setGenerating(true)
    pendingCount.current = 1
    setLoadingN(1)
    setMsg('영상 생성 시작…')
    const r = await window.electronAPI.bridge.generateVideo(prompt.trim(), image, {
      aspect,
      duration,
      resolution
    })
    if (!r.ok) {
      pendingCount.current = 0
      setGenerating(false)
      setLoadingN(0)
      setMsg(r.message || '생성 실패')
    }
  }

  const stop = async () => {
    await window.electronAPI.bridge.cancel()
    pendingCount.current = 0
    setGenerating(false)
    setLoadingN(0)
    setMsg('정지했습니다.')
  }

  const toggleSelId = (id: string) =>
    setSelIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const inGenOrder = [...videos].reverse()
  const deleteSelected = async () => {
    const ids = [...selIds]
    if (!ids.length) return
    if (!confirm(`선택한 ${ids.length}개 영상을 삭제할까요?`)) return
    await window.electronAPI.bridge.remove(ids)
    setVideos((prev) => prev.filter((i) => !selIds.has(i.id)))
    localStorage.setItem('vgen-ids', JSON.stringify(savedIds().filter((id) => !selIds.has(id))))
    setSelIds(new Set())
    setSelMode(false)
  }
  const downloadSelected = async () => {
    const chosen = inGenOrder.filter((i) => selIds.has(i.id))
    if (!chosen.length) return
    const r = await window.electronAPI.bridge.exportZip(
      chosen.map((i) => ({ path: i.path, name: i.filename })),
      'generated-videos'
    )
    if (r.ok) setMsg('zip 저장 완료')
    else if (r.message) setMsg(r.message)
  }

  return (
    <div className="igen">
      {/* 좌측: 생성된 영상 */}
      <div className="igen-left">
        <div className="igen-left-head">
          <Film size={15} /> 생성된 영상
          <span className="igen-count">{videos.length}</span>
          {videos.length > 0 && (
            <div className="igen-left-actions">
              {selMode ? (
                <>
                  <button className="igen-act" onClick={downloadSelected} disabled={selIds.size === 0}>
                    <Download size={13} /> 선택 받기 ({selIds.size})
                  </button>
                  <button className="igen-act danger" onClick={deleteSelected} disabled={selIds.size === 0}>
                    <Trash2 size={13} /> 선택 삭제 ({selIds.size})
                  </button>
                  <button className="igen-act" onClick={() => { setSelMode(false); setSelIds(new Set()) }}>
                    취소
                  </button>
                </>
              ) : (
                <button className="igen-act" onClick={() => setSelMode(true)} title="선택해서 다운로드/삭제">
                  <CheckSquare size={13} /> 선택
                </button>
              )}
            </div>
          )}
        </div>
        {videos.length === 0 && !generating ? (
          <div className="igen-empty">오른쪽에서 이미지를 넣고 영상을 생성하세요</div>
        ) : (
          <div className="igen-grid">
            {Array.from({ length: loadingN }).map((_, i) => (
              <div key={'load' + i} className="igen-tile igen-tile-loading">
                <Loader2 size={20} className="igen-spin" />
              </div>
            ))}
            {videos.map((v) => (
              <VideoTile
                key={v.id}
                img={v}
                selMode={selMode}
                selected={selIds.has(v.id)}
                onToggleSel={() => toggleSelId(v.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 우측: 입력 + 설정 + 생성 */}
      <div className="igen-right">
        <div className="igen-panel">
          <div className="igen-label">생성 엔진</div>
          <div className="igen-seg">
            <button className="igen-seg-btn active">
              <Film size={15} /> Grok
            </button>
          </div>

          {/* 입력 이미지 */}
          <div className="igen-label" style={{ marginTop: 16 }}>
            입력 이미지
          </div>
          <div
            className="igen-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const internal = e.dataTransfer.getData('text/avs-dataurl')
              if (internal) {
                setImage(internal)
                return
              }
              if (e.dataTransfer.files?.length) attachFile(e.dataTransfer.files)
            }}
            onClick={() => document.getElementById('vgen-file')?.click()}
          >
            {!image ? (
              <span>이미지를 드래그하거나 클릭해서 첨부</span>
            ) : (
              <div className="igen-refs">
                <div className="igen-ref" onClick={(e) => e.stopPropagation()}>
                  <img src={image} alt="입력" />
                  <button className="igen-ref-x" onClick={() => setImage('')} title="제거">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <input
            id="vgen-file"
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files && attachFile(e.target.files)}
          />

          {/* 모션 프롬프트 */}
          <div className="igen-label" style={{ marginTop: 16 }}>
            모션 프롬프트 <span style={{ opacity: 0.6 }}>(선택)</span>
          </div>
          <textarea
            className="igen-textarea"
            placeholder="예: 카메라가 천천히 줌인, 인물이 미소짓는다"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />

          {/* 화면 비율 */}
          <div className="igen-label" style={{ marginTop: 16 }}>
            화면 비율
          </div>
          <div className="igen-ratios">
            {ASPECTS.map((a) => (
              <button
                key={a}
                className={`igen-ratio ${aspect === a ? 'active' : ''}`}
                onClick={() => setAspect(a)}
              >
                {a}
              </button>
            ))}
          </div>

          {/* 길이 */}
          <div className="igen-label" style={{ marginTop: 16 }}>
            영상 길이
          </div>
          <div className="igen-ratios">
            {DURATIONS.map((d) => (
              <button
                key={d.v}
                className={`igen-ratio ${duration === d.v ? 'active' : ''}`}
                onClick={() => setDuration(d.v)}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* 화질 */}
          <div className="igen-label" style={{ marginTop: 16 }}>
            화질
          </div>
          <div className="igen-ratios">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.v}
                className={`igen-ratio ${resolution === r.v ? 'active' : ''}`}
                onClick={() => setResolution(r.v)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button
              className="igen-go"
              onClick={run}
              disabled={generating}
              style={{ flex: 1, width: 'auto', marginTop: 0, whiteSpace: 'nowrap' }}
            >
              {generating ? (
                <>
                  <Loader2 size={16} className="igen-spin" /> 생성 중…
                </>
              ) : (
                <>
                  <Sparkles size={16} /> 영상 생성
                </>
              )}
            </button>
            <button
              className="igen-go danger"
              onClick={stop}
              disabled={!generating}
              style={{ flex: '0 0 auto', width: 'auto', marginTop: 0, whiteSpace: 'nowrap', padding: '12px 18px' }}
              title="진행 중인 생성을 모두 정지"
            >
              <Square size={15} /> 정지
            </button>
          </div>
          {msg && <div className={`igen-msg ${msg === '완료' ? 'ok' : ''}`}>{msg}</div>}
          <p className="igen-note">
            ※ Grok 로그인 필요 (크롬). 이미지→영상 한 편 생성됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
