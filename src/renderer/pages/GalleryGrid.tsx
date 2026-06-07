import { useEffect, useState } from 'react'
import { Music, Trash2, CheckSquare, Check, X } from 'lucide-react'
import { useStore } from '../store'
import type { BridgeInfo, ImageSource, ImportedImage } from '@shared/types'

const SOURCE_BADGE: Record<ImageSource, string> = {
  chatgpt: 'ChatGPT',
  flow: 'Flow',
  grok: 'Grok',
  suno: 'SUNO',
  other: '기타'
}
const isVideoPath = (p: string) => /\.(mp4|webm|mov)$/i.test(p)
const isAudioPath = (p: string) => /\.(mp3|wav)$/i.test(p)

export default function GalleryGrid() {
  const { images, setImages, addImage, removeImages, clearImages } = useStore()
  const [info, setInfo] = useState<BridgeInfo | null>(null)
  const [gtab, setGtab] = useState<'all' | 'image' | 'video' | 'audio'>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.electronAPI.bridge.getInfo().then(setInfo)
    window.electronAPI.bridge.list().then(setImages)
    const off = window.electronAPI.bridge.onImported((img) => addImage(img))
    return off
  }, [])

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const removeOne = async (id: string) => {
    await window.electronAPI.bridge.remove([id])
    removeImages([id])
    setSelected((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
  }
  const deleteSelected = async () => {
    const ids = [...selected]
    if (!ids.length) return
    await window.electronAPI.bridge.remove(ids)
    removeImages(ids)
    setSelected(new Set())
    setSelectMode(false)
  }

  const vidCount = images.filter((i) => isVideoPath(i.path)).length
  const audCount = images.filter((i) => isAudioPath(i.path)).length
  const imgCount = images.length - vidCount - audCount
  const shown =
    gtab === 'video'
      ? images.filter((i) => isVideoPath(i.path))
      : gtab === 'audio'
        ? images.filter((i) => isAudioPath(i.path))
        : gtab === 'image'
          ? images.filter((i) => !isVideoPath(i.path) && !isAudioPath(i.path))
          : images
  const TABS: { id: 'all' | 'image' | 'video' | 'audio'; label: string }[] = [
    { id: 'all', label: `전체 ${images.length}` },
    { id: 'image', label: `이미지 ${imgCount}` },
    { id: 'video', label: `영상 ${vidCount}` },
    { id: 'audio', label: `음악 ${audCount}` }
  ]

  return (
    <div>
      <h1 className="h1">갤러리</h1>
      <p className="sub">생성·수집한 이미지, 영상, 음악을 한곳에서 봅니다.</p>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div className="gtabs">
            {TABS.map((t) => (
              <button key={t.id} className={`gtab ${gtab === t.id ? 'active' : ''}`} onClick={() => setGtab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {images.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectMode ? (
                <>
                  <button className="btn danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={selected.size === 0} onClick={deleteSelected}>
                    <Trash2 size={14} /> 선택 삭제 {selected.size > 0 ? `(${selected.size})` : ''}
                  </button>
                  <button className="btn secondary" onClick={() => setSelected(new Set(shown.map((i) => i.id)))}>
                    전체 선택
                  </button>
                  <button className="btn ghost" onClick={() => { setSelectMode(false); setSelected(new Set()) }}>
                    취소
                  </button>
                </>
              ) : (
                <>
                  <button className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setSelectMode(true)}>
                    <CheckSquare size={14} /> 선택
                  </button>
                  <button
                    className="btn danger"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    onClick={async () => {
                      await window.electronAPI.bridge.clear()
                      clearImages()
                    }}
                  >
                    <Trash2 size={14} /> 전체 비우기
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="hint">
            {images.length === 0
              ? '아직 항목이 없습니다. "이미지 생성기"나 "이미지 가져오기"에서 만들어 보세요.'
              : '이 탭에 표시할 항목이 없습니다.'}
          </p>
        ) : (
          <div className="gallery-grid">
            {shown.map((img) => (
              <Thumb
                key={img.id}
                img={img}
                port={info?.port}
                selectMode={selectMode}
                selected={selected.has(img.id)}
                onToggle={() => toggleSelect(img.id)}
                onDelete={() => removeOne(img.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Thumb({
  img,
  port,
  selectMode,
  selected,
  onToggle,
  onDelete
}: {
  img: ImportedImage
  port?: number
  selectMode?: boolean
  selected?: boolean
  onToggle?: () => void
  onDelete?: () => void
}) {
  const video = isVideoPath(img.path)
  const audio = isAudioPath(img.path)
  const [imgSrc, setImgSrc] = useState<string>('')
  const mediaSrc = port ? `http://127.0.0.1:${port}/media/${encodeURIComponent(img.path.split('/').pop() || '')}` : ''
  useEffect(() => {
    if (!video && !audio) window.electronAPI.fs.readImage(img.path).then(setImgSrc).catch(() => setImgSrc(''))
  }, [img.path, video, audio])

  const onClick = () => {
    if (selectMode) onToggle?.()
    else if (!audio) window.electronAPI.fs.openPath(img.path)
  }

  if (audio) {
    return (
      <div className={`gtile gtile-audio ${selectMode && selected ? 'gtile-selected' : ''}`} title={img.filename} onClick={() => selectMode && onToggle?.()}>
        <div className="gtile-audio-inner">
          <Music size={22} className="gtile-audio-icon" />
          <span className="gtile-audio-name">{img.filename}</span>
          {mediaSrc && <audio controls preload="none" src={mediaSrc} onClick={(e) => e.stopPropagation()} />}
        </div>
        <span className="gtile-badge">{SOURCE_BADGE[img.source]}</span>
        {selectMode && <span className={`gtile-check ${selected ? 'on' : ''}`}>{selected && <Check size={14} />}</span>}
        {!selectMode && (
          <button className="gtile-del" title="삭제" onClick={(e) => { e.stopPropagation(); onDelete?.() }}>
            <X size={13} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`gtile ${selectMode && selected ? 'gtile-selected' : ''}`} title={img.filename} onClick={onClick}>
      {video ? (
        mediaSrc ? (
          <video
            src={mediaSrc}
            ref={(el) => { if (el) el.muted = true }}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.1 } catch { /* noop */ } }}
            onMouseOver={(e) => { e.currentTarget.muted = true; e.currentTarget.play().catch(() => {}) }}
            onMouseOut={(e) => { e.currentTarget.pause() }}
          />
        ) : (
          <div className="gtile-empty">로딩…</div>
        )
      ) : imgSrc ? (
        <img src={imgSrc} alt={img.filename} />
      ) : (
        <div className="gtile-empty">로딩…</div>
      )}
      {video && <span className="gtile-play">▶</span>}
      <span className="gtile-badge">{SOURCE_BADGE[img.source]}</span>
      {selectMode && <span className={`gtile-check ${selected ? 'on' : ''}`}>{selected && <Check size={14} />}</span>}
      {!selectMode && (
        <button className="gtile-del" title="삭제" onClick={(e) => { e.stopPropagation(); onDelete?.() }}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}
