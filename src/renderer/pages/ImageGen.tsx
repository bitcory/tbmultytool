import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Clapperboard, Sparkles, ImageIcon, Loader2, Type, Images as ImagesIcon, X, RotateCw, Download, Check, CheckSquare, Trash2, Square } from 'lucide-react'
import type { ImageSource, ImportedImage } from '@shared/types'

const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const isImagePath = (p: string) => !/\.(mp4|webm|mov|mp3|wav)$/i.test(p)
type GenMode = 'text-to-image' | 'image-to-image'

// 빈 줄(엔터 2번)로 프롬프트 분리
const splitPrompts = (t: string): string[] =>
  t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = rej
    fr.readAsDataURL(f)
  })

function Tile({
  img,
  onReuse,
  selMode,
  selected,
  onToggleSel
}: {
  img: ImportedImage
  onReuse: (dataUrl: string) => void
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
      draggable={!selMode && !!src}
      onDragStart={(e) => {
        if (src) {
          e.dataTransfer.setData('text/avs-dataurl', src)
          e.dataTransfer.effectAllowed = 'copy'
        }
      }}
      onClick={() => (selMode ? onToggleSel() : window.electronAPI.fs.openPath(img.path))}
    >
      {src ? <img src={src} alt={img.filename} /> : <div className="igen-tile-empty">로딩…</div>}
      <span className="igen-tile-badge">{img.source}</span>
      {selMode && <span className={`igen-tile-check ${selected ? 'on' : ''}`}>{selected && <Check size={14} />}</span>}
      {!selMode && src && (
        <button
          className="igen-tile-reuse"
          title="I2I 참조 이미지로 사용"
          onClick={(e) => {
            e.stopPropagation()
            onReuse(src)
          }}
        >
          <RotateCw size={14} />
        </button>
      )}
    </div>
  )
}

export default function ImageGen() {
  const [source, setSource] = useState<ImageSource>('chatgpt')
  const [genMode, setGenMode] = useState<GenMode>('text-to-image')
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [refs, setRefs] = useState<string[]>([]) // I2I 첨부 이미지(dataUrl)
  const [refMode, setRefMode] = useState<'single' | 'all' | 'select'>('single') // 1:1 / 전체 / 선택
  const [selections, setSelections] = useState<number[][]>([]) // select 모드: 프롬프트별 선택 이미지 인덱스
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [images, setImages] = useState<ImportedImage[]>([])
  const [loadingN, setLoadingN] = useState(0)
  const [selMode, setSelMode] = useState(false)
  const [selIds, setSelIds] = useState<Set<string>>(new Set())
  const pendingCount = useRef(0)

  const prompts = splitPrompts(prompt)

  const savedIds = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem('igen-ids') || '[]')
    } catch {
      return []
    }
  }

  useEffect(() => {
    const ids = new Set(savedIds())
    if (ids.size === 0) return
    window.electronAPI.bridge.list().then((all) => {
      setImages(all.filter((i) => ids.has(i.id) && isImagePath(i.path)))
    })
  }, [])

  useEffect(() => {
    const off = window.electronAPI.bridge.onImported((img) => {
      if (pendingCount.current <= 0 || !isImagePath(img.path)) return
      setImages((prev) => [img, ...prev.filter((p) => p.id !== img.id)])
      localStorage.setItem('igen-ids', JSON.stringify([img.id, ...savedIds()].slice(0, 300)))
      pendingCount.current = Math.max(0, pendingCount.current - 1)
      setLoadingN(pendingCount.current)
      if (pendingCount.current <= 0) {
        setGenerating(false)
        setMsg('완료')
      } else {
        setMsg(`이미지 받는 중… (남은 ${pendingCount.current})`)
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

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'))
    const urls = await Promise.all(arr.map(fileToDataUrl))
    setRefs((prev) => [...prev, ...urls])
  }

  // 생성된 이미지를 I2I 참조로 재사용 (버튼/드롭) → I2I 모드로 전환
  const addReuse = (dataUrl: string) => {
    setRefs((prev) => (prev.includes(dataUrl) ? prev : [...prev, dataUrl]))
    setGenMode('image-to-image')
  }

  // 생성 순서(오래된→최신) = 표시 배열의 역순
  const inGenOrder = [...images].reverse()
  const exportZip = async (chosen: ImportedImage[], name: string) => {
    if (!chosen.length) return
    const r = await window.electronAPI.bridge.exportZip(
      chosen.map((i) => ({ path: i.path, name: i.filename })),
      name
    )
    if (r.ok) setMsg('zip 저장 완료')
    else if (r.message) setMsg(r.message)
  }
  const downloadAll = () => exportZip(inGenOrder, 'generated-images')
  const downloadSelected = () => exportZip(inGenOrder.filter((i) => selIds.has(i.id)), 'selected-images')
  const deleteSelected = async () => {
    const ids = [...selIds]
    if (!ids.length) return
    if (!confirm(`선택한 ${ids.length}장을 삭제할까요?`)) return
    await window.electronAPI.bridge.remove(ids)
    setImages((prev) => prev.filter((i) => !selIds.has(i.id)))
    localStorage.setItem('igen-ids', JSON.stringify(savedIds().filter((id) => !selIds.has(id))))
    setSelIds(new Set())
    setSelMode(false)
  }
  const toggleSelId = (id: string) =>
    setSelIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const toggleSel = (pi: number, idx: number) => {
    setSelections((prev) => {
      const next = prev.map((a) => [...(a || [])])
      while (next.length <= pi) next.push([])
      const set = new Set(next[pi])
      if (set.has(idx)) set.delete(idx)
      else set.add(idx)
      next[pi] = [...set].sort((a, b) => a - b)
      return next
    })
  }

  // 참조 모드별 이미지→프롬프트 할당 (chatimg 방식)
  const imagesFor = (i: number): string[] => {
    if (genMode !== 'image-to-image' || refs.length === 0) return []
    if (refMode === 'all') return [...refs]
    if (refMode === 'select') return (selections[i] || []).filter((idx) => idx < refs.length).map((idx) => refs[idx])
    const im = refs[i] // single (1:1)
    return im ? [im] : []
  }

  const run = async () => {
    if (prompts.length === 0) {
      setMsg('프롬프트를 입력하세요 (여러 개는 빈 줄로 구분)')
      return
    }
    if (genMode === 'image-to-image' && refs.length === 0) {
      setMsg('I2I 모드: 참조 이미지를 첨부하세요')
      return
    }
    const items = prompts.map((p, i) => {
      const imgs = imagesFor(i)
      return { prompt: p, images: imgs.length ? imgs : undefined }
    })
    setGenerating(true)
    pendingCount.current = items.length
    setLoadingN(items.length)
    setMsg(`${items.length}개 프롬프트 생성 시작… (창 ${items.length}개)`)
    const r = await window.electronAPI.bridge.generateBatch(source, items, aspect)
    if (!r.ok) {
      pendingCount.current = 0
      setGenerating(false)
      setMsg(r.message || '생성 실패')
    }
  }

  // 정지: 진행/대기 중인 모든 확장 작업 취소 (반복 시도로 봇 오인 방지)
  const stop = async () => {
    await window.electronAPI.bridge.cancel()
    pendingCount.current = 0
    setGenerating(false)
    setLoadingN(0)
    setMsg('정지했습니다.')
  }

  return (
    <div className="igen">
      {/* 좌측: 생성된 이미지 */}
      <div className="igen-left">
        <div className="igen-left-head">
          <ImageIcon size={15} /> 생성된 이미지
          <span className="igen-count">{images.length}</span>
          {images.length > 0 && (
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
                <>
                  <button className="igen-act" onClick={downloadAll} title="전체를 생성 순서대로 zip 저장">
                    <Download size={13} /> 전체 zip
                  </button>
                  <button className="igen-act" onClick={() => setSelMode(true)} title="선택해서 다운로드">
                    <CheckSquare size={13} /> 선택
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {images.length === 0 && !generating ? (
          <div className="igen-empty">오른쪽에서 프롬프트를 입력하고 생성하세요</div>
        ) : (
          <div className="igen-grid">
            {Array.from({ length: loadingN }).map((_, i) => (
              <div key={'load' + i} className="igen-tile igen-tile-loading">
                <Loader2 size={20} className="igen-spin" />
              </div>
            ))}
            {images.map((img) => (
              <Tile
                key={img.id}
                img={img}
                onReuse={addReuse}
                selMode={selMode}
                selected={selIds.has(img.id)}
                onToggleSel={() => toggleSelId(img.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 우측: 입력 + 설정 + 생성 */}
      <div className="igen-right">
        <div className="igen-panel">
          {/* T2I / I2I */}
          <div className="igen-seg">
            {[
              { id: 'text-to-image' as GenMode, label: 'T2I', Icon: Type },
              { id: 'image-to-image' as GenMode, label: 'I2I', Icon: ImagesIcon }
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`igen-seg-btn ${genMode === id ? 'active' : ''}`}
                onClick={() => setGenMode(id)}
                title={id === 'text-to-image' ? '프롬프트만으로 생성' : '첨부 이미지 기반 생성'}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          <div className="igen-label" style={{ marginTop: 16 }}>
            생성 엔진
          </div>
          <div className="igen-seg">
            {[
              { id: 'chatgpt' as ImageSource, label: 'ChatGPT', Icon: MessageSquare },
              { id: 'flow' as ImageSource, label: 'Flow', Icon: Clapperboard }
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`igen-seg-btn ${source === id ? 'active' : ''}`}
                onClick={() => setSource(id)}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {/* I2I 첨부 */}
          {genMode === 'image-to-image' && (
            <>
              <div className="igen-label" style={{ marginTop: 16 }}>
                참조 이미지
              </div>
              <div
                className="igen-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const internal = e.dataTransfer.getData('text/avs-dataurl')
                  if (internal) {
                    setRefs((prev) => (prev.includes(internal) ? prev : [...prev, internal]))
                    return
                  }
                  if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
                }}
                onClick={() => document.getElementById('igen-file')?.click()}
              >
                {refs.length === 0 ? (
                  <span>이미지를 드래그하거나 클릭해서 첨부</span>
                ) : (
                  <div className="igen-refs">
                    {refs.map((u, i) => (
                      <div key={i} className="igen-ref" onClick={(e) => e.stopPropagation()}>
                        <img src={u} alt={'ref' + i} />
                        <span className="igen-ref-idx">{i + 1}</span>
                        <button
                          className="igen-ref-x"
                          onClick={() => setRefs((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <input
                id="igen-file"
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />

              {/* 참조 매칭 모드 */}
              {refs.length > 0 && (
                <>
                  <div className="igen-label" style={{ marginTop: 14 }}>
                    참조 매칭
                  </div>
                  <div className="igen-seg">
                    {[
                      { id: 'single' as const, label: '1:1', tip: '프롬프트 i ↔ 이미지 i' },
                      { id: 'all' as const, label: '전체', tip: '모든 프롬프트에 모든 이미지' },
                      { id: 'select' as const, label: '선택', tip: '프롬프트별로 직접 선택' }
                    ].map(({ id, label, tip }) => (
                      <button
                        key={id}
                        className={`igen-seg-btn ${refMode === id ? 'active' : ''}`}
                        onClick={() => setRefMode(id)}
                        title={tip}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* 프롬프트별 이미지 매칭 시각화 (선택 모드만 클릭 가능) */}
                  {prompts.length > 0 && (
                    <div className="igen-selbox">
                      {prompts.map((p, i) => {
                        const matched = new Set(imagesFor(i).map((u) => refs.indexOf(u)))
                        return (
                          <div key={i} className="igen-selrow" title={p.split('\n')[0]}>
                            <div className="igen-selrow-head">
                              <span className="igen-selrow-num">{i + 1}</span>
                              <span className="igen-selrow-label">이미지 매칭</span>
                              {matched.size === 0 && <span className="igen-selrow-none">텍스트만</span>}
                            </div>
                            <div className="igen-selrow-imgs">
                              {refs.map((u, idx) => {
                                const on = matched.has(idx)
                                const clickable = refMode === 'select'
                                return (
                                  <button
                                    key={idx}
                                    className={`igen-selchip ${on ? 'on' : ''} ${clickable ? '' : 'ro'}`}
                                    onClick={() => clickable && toggleSel(i, idx)}
                                    title={`이미지 ${idx + 1}`}
                                  >
                                    <img src={u} alt={'r' + idx} />
                                    <span className="igen-selchip-no">{idx + 1}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="igen-refmode-hint">
                    {refMode === 'single'
                      ? '프롬프트 순서대로 이미지 1장씩 매칭 (이미지 수 초과 프롬프트는 텍스트만).'
                      : refMode === 'all'
                        ? '첨부한 모든 이미지를 각 프롬프트에 함께 사용.'
                        : '각 프롬프트에 사용할 이미지를 직접 선택.'}
                  </p>
                </>
              )}
            </>
          )}

          <div className="igen-label" style={{ marginTop: 16 }}>
            프롬프트 {prompts.length > 1 && <span className="igen-tag">{prompts.length}개 · {prompts.length}장</span>}
          </div>
          <textarea
            className="igen-textarea"
            rows={9}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={'프롬프트를 입력하세요.\n\n여러 장을 만들려면 빈 줄(엔터 2번)로 구분하면\n각각 별도의 창에서 생성됩니다.'}
          />

          <div className="igen-label" style={{ marginTop: 16 }}>
            화면 비율
          </div>
          <div className="igen-ratios">
            {ASPECTS.map((r) => (
              <button
                key={r}
                className={`igen-ratio ${aspect === r ? 'active' : ''}`}
                onClick={() => setAspect(r)}
              >
                {r}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="igen-go"
              onClick={run}
              disabled={generating}
              style={{ flex: 1, width: 'auto', whiteSpace: 'nowrap' }}
            >
              {generating ? (
                <>
                  <Loader2 size={16} className="igen-spin" /> 생성 중…
                </>
              ) : (
                <>
                  <Sparkles size={16} /> 이미지 생성 {prompts.length > 1 ? `(${prompts.length}장)` : ''}
                </>
              )}
            </button>
            <button
              className="igen-go danger"
              onClick={stop}
              disabled={!generating}
              style={{ flex: '0 0 auto', width: 'auto', whiteSpace: 'nowrap', padding: '12px 18px' }}
              title="진행 중인 생성을 모두 정지"
            >
              <Square size={15} /> 정지
            </button>
          </div>
          {msg && <div className={`igen-msg ${msg === '완료' ? 'ok' : ''}`}>{msg}</div>}
          <p className="igen-note">
            ※ {source === 'chatgpt' ? 'ChatGPT' : 'Google Flow'} 로그인 필요. 프롬프트 {prompts.length || 0}개 → 창 {prompts.length || 0}개로 병렬 생성됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
