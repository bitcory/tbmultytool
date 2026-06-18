import { useEffect, useRef, useState } from 'react'
import {
  Scissors, Film, Loader2, Download, Trash2, RefreshCw, Archive, ChevronLeft, ChevronRight, Crop
} from 'lucide-react'
import { usePersistedForm } from '../persist'

// 추출된 프레임 한 장 (임시 PNG 파일 경로 + 추출 시각)
type Frame = { id: string; path: string; timeSec: number }

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = rej
    fr.readAsDataURL(f)
  })

const dataURLToBlob = (d: string): Blob => {
  const [head, b64] = d.split(',')
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'
  const bin = atob(b64 || '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// 초 → mm:ss.mmm
const fmt = (s: number): string => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

// 추출된 프레임 썸네일 (경로 → dataURL 읽어 표시)
function FrameTile({
  frame,
  index,
  onDownload,
  onRemove
}: {
  frame: Frame
  index: number
  onDownload: () => void
  onRemove: () => void
}) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    window.electronAPI.fs
      .readImage(frame.path)
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(''))
    return () => {
      alive = false
    }
  }, [frame.path])
  return (
    <div className="igen-tile" title={`${index + 1}번 · ${fmt(frame.timeSec)}`}>
      {src ? <img src={src} alt="" /> : <div className="igen-tile-empty">로딩…</div>}
      <span className="igen-tile-badge">{fmt(frame.timeSec)}</span>
      <div className="frm-tile-actions">
        <button title="PNG로 저장" onClick={onDownload}>
          <Download size={14} />
        </button>
        <button title="삭제" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function Frames() {
  // previewUrl = 미리보기용 blob/data, workPath = ffmpeg 에 넘길 실제 파일 경로
  const [media, setMedia] = useState<{ previewUrl: string; workPath: string; name: string } | null>(
    null
  )
  const [info, setInfo] = useState<{ duration: number; width: number; height: number } | null>(null)
  const [cur, setCur] = useState(0) // 현재 재생 위치(초)
  const [dur, setDur] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const [evenCount, setEvenCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaTouched = useRef(false)

  // 입력(영상)과 추출된 프레임 목록을 페이지 이동 후에도 유지.
  // previewUrl 은 휘발성 blob 이라 저장에서 빼고, 복원 때 workPath 로 재생성한다.
  usePersistedForm(
    'frames',
    {
      workPath: media?.workPath || null,
      name: media?.name || '',
      frames: frames.map((f) => ({ id: f.id, path: f.path, timeSec: f.timeSec }))
    },
    (v) => {
      if (Array.isArray(v.frames)) setFrames(v.frames as Frame[])
      const wp = v.workPath as string | null
      const nm = (v.name as string) || ''
      if (wp) {
        window.electronAPI.fs
          .readImage(wp)
          .then((d) => {
            if (!d || mediaTouched.current) return
            const url = URL.createObjectURL(dataURLToBlob(d))
            setMedia({ previewUrl: url, workPath: wp, name: nm })
          })
          .catch(() => {
            /* 원본이 사라졌으면 비운 채로 둔다 */
          })
        window.electronAPI.frames.probe(wp).then(setInfo).catch(() => {})
      }
    }
  )

  useEffect(() => {
    return () => {
      // 언마운트 시 blob 해제
      if (media?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(media.previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadFile = async (f: File) => {
    if (!f.type.startsWith('video/')) {
      setMsg('영상 파일을 올려주세요 (mp4 · webm · mov)')
      return
    }
    mediaTouched.current = true
    setMsg('영상 분석 중…')
    // 경로가 잡히면(데스크톱) 그대로, 아니면 dataURL 을 임시 파일로 떨궈 경로 확보.
    let workPath = ''
    try {
      workPath = window.electronAPI.fs.getPathForFile(f) || ''
    } catch {
      /* 폴백 아래에서 처리 */
    }
    const previewUrl = URL.createObjectURL(f)
    if (!workPath) {
      try {
        const dataUrl = await fileToDataUrl(f)
        workPath = await window.electronAPI.frames.prepare(dataUrl)
      } catch {
        setMsg('영상을 불러오지 못했습니다.')
        return
      }
    }
    setMedia((m) => {
      if (m?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl)
      return { previewUrl, workPath, name: f.name }
    })
    setCur(0)
    try {
      const i = await window.electronAPI.frames.probe(workPath)
      setInfo(i)
      setMsg(i.width ? `${i.width}×${i.height} · ${fmt(i.duration)}` : '')
    } catch {
      setInfo(null)
      setMsg('')
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('video/'))
    if (f) loadFile(f)
  }

  const seek = (t: number) => {
    const v = videoRef.current
    const clamped = Math.max(0, Math.min(dur || info?.duration || 0, t))
    if (v) v.currentTime = clamped
    setCur(clamped)
  }

  const addFrame = (fr: { path: string; timeSec: number }) =>
    setFrames((prev) =>
      [...prev, { id: `${fr.path}`, path: fr.path, timeSec: fr.timeSec }].sort(
        (a, b) => a.timeSec - b.timeSec
      )
    )

  // 현재 위치 프레임 1장 추출
  const extractCurrent = async () => {
    if (!media || busy) return
    setBusy(true)
    setMsg('프레임 추출 중…')
    try {
      const r = await window.electronAPI.frames.extract(media.workPath, cur)
      addFrame(r)
      setMsg('프레임을 추출했어요')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '추출 실패')
    } finally {
      setBusy(false)
    }
  }

  // 영상 전체를 N등분해 균등 추출
  const extractEven = async () => {
    if (!media || busy) return
    const total = dur || info?.duration || 0
    const n = Math.max(1, Math.min(60, Math.round(evenCount)))
    if (total <= 0) {
      setMsg('영상 길이를 읽지 못했습니다.')
      return
    }
    setBusy(true)
    try {
      for (let i = 0; i < n; i++) {
        const t = (total * (i + 0.5)) / n // 각 구간의 가운데 지점
        setMsg(`균등 추출 중… ${i + 1}/${n}`)
        const r = await window.electronAPI.frames.extract(media.workPath, t)
        addFrame(r)
      }
      setMsg(`${n}장 추출 완료`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '추출 실패')
    } finally {
      setBusy(false)
    }
  }

  const downloadOne = async (fr: Frame, index: number) => {
    const base = (media?.name || 'video').replace(/\.[^.]+$/, '')
    const name = `${base}_${String(index + 1).padStart(2, '0')}_${fmt(fr.timeSec).replace(/[:.]/g, '-')}.png`
    await window.electronAPI.fs.saveFileAs(fr.path, name)
  }

  const downloadZip = async () => {
    if (!frames.length) return
    const base = (media?.name || 'frames').replace(/\.[^.]+$/, '')
    const items = frames.map((f, i) => ({
      path: f.path,
      name: `${String(i + 1).padStart(2, '0')}_${fmt(f.timeSec).replace(/[:.]/g, '-')}.png`
    }))
    const r = await window.electronAPI.bridge.exportZip(items, `${base}-frames`)
    if (r.ok) setMsg('ZIP으로 저장했어요')
  }

  const removeFrame = (id: string) => setFrames((prev) => prev.filter((f) => f.id !== id))
  const clearFrames = () => {
    if (frames.length && window.confirm('추출한 프레임을 모두 비울까요?')) setFrames([])
  }

  const resetAll = () => {
    mediaTouched.current = true
    setMedia((m) => {
      if (m?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl)
      return null
    })
    setInfo(null)
    setCur(0)
    setDur(0)
    setFrames([])
    setMsg('')
  }

  const total = dur || info?.duration || 0
  const fps = 30 // 프레임 단위 이동용 근사값(정확 fps 없이도 미세 이동 제공)

  return (
    <div className="igen">
      {/* 좌측: 원본 영상 + 추출 위치 선택 */}
      <div className="igen-left" style={{ overflow: 'auto' }}>
        <div className="igen-left-head">
          <Film size={15} /> 원본 영상
          {info && (
            <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
              {info.width ? `${info.width}×${info.height} · ` : ''}
              {fmt(info.duration)}
            </span>
          )}
          {media && (
            <button
              onClick={resetAll}
              title="영상 비우기"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 7,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>

        <div style={{ padding: 16 }}>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) loadFile(f)
              e.currentTarget.value = ''
            }}
          />

          {!media ? (
            <div
              className="igen-drop"
              style={{
                minHeight: 320,
                flexDirection: 'column',
                gap: 12,
                borderColor: dragOver ? 'var(--primary)' : undefined,
                background: dragOver ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined
              }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <Scissors size={30} style={{ opacity: 0.6 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                영상을 여기로 끌어다 놓거나 클릭해서 선택
              </div>
              <div style={{ fontSize: 12 }}>mp4 · webm · mov · 고화질 PNG 프레임으로 추출</div>
            </div>
          ) : (
            <>
              <div
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: '#000',
                  border: '1px solid var(--border)'
                }}
              >
                <video
                  ref={videoRef}
                  src={media.previewUrl}
                  controls
                  playsInline
                  onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
                  onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
                  style={{ width: '100%', maxHeight: 460, display: 'block', background: '#000' }}
                />
              </div>

              {/* 추출 위치 스크러버 */}
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    marginBottom: 6
                  }}
                >
                  <span>추출 위치</span>
                  <span style={{ color: 'var(--primary)' }}>
                    {fmt(cur)} <span style={{ opacity: 0.5 }}>/ {fmt(total)}</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={total || 0}
                  step={0.01}
                  value={cur}
                  onChange={(e) => seek(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--primary)', height: 4, margin: 0 }}
                />
                {/* 미세 이동 */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="igen-act" onClick={() => seek(cur - 1)}>
                    <ChevronLeft size={13} /> 1초
                  </button>
                  <button className="igen-act" onClick={() => seek(cur - 1 / fps)}>
                    <ChevronLeft size={13} /> 1프레임
                  </button>
                  <button className="igen-act" onClick={() => seek(cur + 1 / fps)}>
                    1프레임 <ChevronRight size={13} />
                  </button>
                  <button className="igen-act" onClick={() => seek(cur + 1)}>
                    1초 <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              {/* 현재 위치 추출 */}
              <button className="igen-go" disabled={busy} onClick={extractCurrent}>
                {busy ? <Loader2 size={16} className="igen-spin" /> : <Crop size={16} />}
                이 위치 프레임 추출
              </button>

              {/* 균등 추출 */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>균등 분할</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={evenCount}
                  onChange={(e) => setEvenCount(Number(e.target.value))}
                  style={{
                    width: 64,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '7px 9px',
                    color: 'var(--text)',
                    fontSize: 13
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>장</span>
                <button
                  className="igen-act"
                  disabled={busy}
                  onClick={extractEven}
                  style={{ marginLeft: 'auto' }}
                >
                  <Scissors size={13} /> 균등 추출
                </button>
              </div>

              {msg && <div className={`igen-msg ${busy ? '' : 'ok'}`}>{msg}</div>}
            </>
          )}
        </div>
      </div>

      {/* 우측: 추출된 프레임 */}
      <div className="igen-left" style={{ flex: 'none', width: 420 }}>
        <div className="igen-left-head">
          <Scissors size={15} /> 추출된 프레임
          {frames.length > 0 && <span className="igen-count">{frames.length}</span>}
          {frames.length > 0 && (
            <div className="igen-left-actions">
              <button className="igen-act" onClick={downloadZip}>
                <Archive size={13} /> ZIP 저장
              </button>
              <button className="igen-act danger" onClick={clearFrames}>
                <Trash2 size={13} /> 비우기
              </button>
            </div>
          )}
        </div>

        {frames.length === 0 ? (
          <div className="igen-empty">
            {media
              ? '왼쪽에서 위치를 고르고 프레임을 추출하면 여기에 모입니다.'
              : '영상을 먼저 올려주세요.'}
          </div>
        ) : (
          <div
            className="igen-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
          >
            {frames.map((f, i) => (
              <FrameTile
                key={f.id}
                frame={f}
                index={i}
                onDownload={() => downloadOne(f, i)}
                onRemove={() => removeFrame(f.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
