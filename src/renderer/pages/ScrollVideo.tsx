import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ScrollText, Sparkles, Loader2, X, Trash2, RotateCcw, AlignLeft, ImagePlus, Type, Video as VideoIcon, Image as ImageIcon, Download, Pipette, RefreshCw, Bookmark, BookmarkX, Home, FolderOpen } from 'lucide-react'
import type { ImportedImage } from '@shared/types'
import {
  autoLayout,
  rescaleLayout,
  innerSection,
  renderSpecFromLayout,
  getMediaAspect,
  FONTS,
  type Aspect,
  type Align,
  type ScrollLayout,
  type Box
} from '../scrollRender'
import { usePersistedForm, isToday } from '../persist'

const ASPECT_OPTS: { v: Aspect; label: string }[] = [
  { v: '9:16', label: '9:16 세로' },
  { v: '16:9', label: '16:9 가로' },
  { v: '1:1', label: '1:1 정사각' }
]
const SPEEDS: { v: number; label: string }[] = [
  { v: 55, label: '느리게' },
  { v: 80, label: '보통' },
  { v: 115, label: '빠르게' }
]
const isVideoPath = (p: string) => /\.(mp4|webm|mov)$/i.test(p)

// 3분할 사용자 템플릿 저장 키 — 현재 배치(레이아웃 전체)를 통째로 저장해 재사용.
const SPLIT3_TPL_KEY = 'scrollvideo:tpl:split3'

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = rej
    fr.readAsDataURL(f)
  })

// base64 dataURL → Blob (복원 시 영상 미리보기를 blob URL 로 재생성하는 데 사용)
const dataURLToBlob = (d: string): Blob => {
  const [head, b64] = d.split(',')
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'
  const bin = atob(b64 || '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// 색상 팔레트(카드뉴스와 동일) + 헥스 입력 + 스포이드 피커
const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#ffffff',
  '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba6',
  '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79',
  '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47',
  '#0b0c10', '#1d2029', '#2c1d10', '#3d5afe', '#ffe600', '#ff3b30', '#c6ff00', '#ff2d95'
]

const isHex = (c: string) => /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(c)

function ColorField({
  label,
  title,
  value,
  onChange
}: {
  label: string
  title: string
  value: string
  onChange: (c: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)
  useEffect(() => setHex(value), [value])
  // 유효한 헥스만 반영 (입력 중 부분 문자열은 무시)
  const apply = (c: string) => {
    let v = (c || '').trim()
    if (v && v[0] !== '#') v = '#' + v
    if (isHex(v)) onChange(v)
  }
  const eyedrop = async () => {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!ED) return
    try {
      const r = await new ED().open()
      setHex(r.sRGBHex)
      apply(r.sRGBHex)
    } catch {
      /* 사용자 취소 */
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12,
          color: 'var(--muted)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer'
        }}
      >
        {label}
        <span
          style={{
            width: 28,
            height: 22,
            borderRadius: 5,
            background: value,
            border: '1px solid var(--border)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)'
          }}
        />
      </button>
      {open &&
        createPortal(
          <div
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
          >
            <div
              style={{
                width: 300,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: 16,
                boxShadow: '0 18px 50px rgba(0,0,0,.5)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <b style={{ fontSize: 14, color: 'var(--text)' }}>{title}</b>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', lineHeight: 1, padding: 0 }}
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>기본 팔레트</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => {
                      setHex(c)
                      apply(c)
                    }}
                    style={{
                      aspectRatio: '1 / 1',
                      borderRadius: 6,
                      background: c,
                      cursor: 'pointer',
                      border:
                        value.toLowerCase() === c.toLowerCase()
                          ? '2px solid var(--primary)'
                          : '1px solid rgba(255,255,255,.12)'
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    background: isHex(hex) ? hex : value,
                    border: '1px solid var(--border)',
                    flex: '0 0 auto'
                  }}
                />
                <input
                  value={hex}
                  placeholder="#000000"
                  onChange={(e) => {
                    setHex(e.target.value)
                    apply(e.target.value)
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={eyedrop}
                  title="화면에서 색 추출"
                  style={{
                    flex: '0 0 auto',
                    width: 36,
                    height: 36,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    cursor: 'pointer'
                  }}
                >
                  <Pipette size={15} />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

// 우측 슬라이더 한 칸 (컴팩트)
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--muted)',
          marginBottom: 3
        }}
      >
        <span>{label}</span>
        <span style={{ opacity: 0.7 }}>
          {step < 1 ? value.toFixed(1) : Math.round(value)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--primary)', height: 4, margin: 0 }}
      />
    </div>
  )
}

type DragMode = 'move' | 'resize'
type DragTarget = 'video' | 'image' | 'section' | 'title' | 'safeTop'

type Sel = 'home' | 'video' | 'image' | 'section' | 'title'

// 상단 탭 순서: 홈 → 제목 → 영상 → 이미지 → 텍스트 (Object.keys 삽입 순서대로 렌더)
const SEL_META: Record<Sel, { label: string; Icon: typeof Type }> = {
  home: { label: '홈', Icon: Home },
  title: { label: '제목', Icon: Type },
  video: { label: '영상', Icon: VideoIcon },
  image: { label: '이미지', Icon: ImageIcon },
  section: { label: '텍스트', Icon: AlignLeft }
}

export default function ScrollVideo() {
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [text, setText] = useState('')
  // previewUrl = 미리보기용(blob/data), path/dataUrl = 렌더 전달용. 큰 영상은 path 로 다뤄 base64 회피.
  const [media, setMedia] = useState<{
    previewUrl: string
    path?: string
    dataUrl?: string
    isVideo: boolean
  } | null>(null)
  const [image, setImage] = useState<{ dataUrl: string } | null>(null)
  const [mediaAR, setMediaAR] = useState(16 / 9) // 상단 미디어 가로:세로 비율
  const [selected, setSelected] = useState<Sel>('home') // 상단 탭(편집 패널)
  const [picked, setPicked] = useState<Sel | null>(null) // 미리보기에서 클릭해 선택한 요소(녹색 테두리)
  const [tmpl, setTmpl] = useState<'default' | 'split2' | 'split3'>('default') // 현재 빠른배치 모드
  const [layout, setLayout] = useState<ScrollLayout>(() => autoLayout('9:16', false, false))
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [videos, setVideos] = useState<ImportedImage[]>([])
  const [port, setPort] = useState(0)
  const [saveDir, setSaveDir] = useState('') // 생성된 스크롤영상이 저장되는 폴더
  const pending = useRef(false)
  // 사용자가 미디어를 직접 바꿨는지 — 복원(비동기 파일읽기)이 새 영상을 덮어쓰지 않게 가드
  const mediaTouched = useRef(false)

  // 입력 폼 영구 저장 (제목/본문·레이아웃·첨부 미디어/이미지) — 페이지 이동 후에도 유지.
  // media.previewUrl 은 blob: URL(휘발성)이라 저장에서 빼고, 복원 때 path/dataUrl 로 재생성한다.
  usePersistedForm(
    'scrollvideo',
    {
      aspect, title, subtitle, text, image, mediaAR, tmpl, layout,
      media: media ? { path: media.path, dataUrl: media.dataUrl, isVideo: media.isVideo } : null
    },
    (v) => {
      if (v.aspect) setAspect(v.aspect as Aspect)
      if (typeof v.title === 'string') setTitle(v.title)
      if (typeof v.subtitle === 'string') setSubtitle(v.subtitle)
      if (typeof v.text === 'string') setText(v.text)
      if (v.image) setImage(v.image as { dataUrl: string })
      if (typeof v.mediaAR === 'number') setMediaAR(v.mediaAR)
      if (v.tmpl) setTmpl(v.tmpl as 'default' | 'split2' | 'split3')
      if (v.layout) setLayout(v.layout as ScrollLayout)
      // 진입 시 항상 홈 탭에서 시작 (저장된 탭은 복원하지 않음)
      const sm = v.media as { path?: string; dataUrl?: string; isVideo: boolean } | null
      if (sm) {
        if (sm.dataUrl) {
          // 이미지/소형 폴백: dataUrl 을 그대로 미리보기로 사용
          setMedia({ previewUrl: sm.dataUrl, dataUrl: sm.dataUrl, isVideo: sm.isVideo })
        } else if (sm.path) {
          // 데스크톱 영상: 원본 파일을 다시 읽어 blob URL 로 미리보기 재생성 (CSP 가 video data: 차단)
          window.electronAPI.fs
            .readImage(sm.path)
            .then((d) => {
              // 읽는 동안 사용자가 영상을 바꿨다면 덮어쓰지 않는다
              if (!d || mediaTouched.current) return
              const url = URL.createObjectURL(dataURLToBlob(d))
              setMedia({ previewUrl: url, path: sm.path, isVideo: sm.isVideo })
            })
            .catch(() => {
              /* 원본 파일이 이동/삭제됐으면 미디어는 비운 채로 둔다 */
            })
        }
      }
    }
  )

  const stageRef = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(0)
  const scale = stageW > 0 ? stageW / layout.W : 0
  // 드래그 중 중앙선 스냅 가이드(녹색): v=세로중앙선, h=가로중앙선
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  // 미리보기 새로고침: 증가시키면 스크롤 애니 재시작 + 영상 리로드
  const [previewKey, setPreviewKey] = useState(0)

  // 스테이지 실제 픽셀 폭 추적 → 스케일 계산
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageW(el.clientWidth))
    ro.observe(el)
    setStageW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    window.electronAPI.bridge.getInfo().then((i) => { setPort(i.port); setSaveDir(i.dir) }).catch(() => {})
  }, [])

  // 페이지 진입(마운트) 시 항상 홈 탭에서 시작
  useEffect(() => {
    setSelected('home')
    setPicked(null)
  }, [])

  // 갤러리(디스크)를 신뢰 소스로 "오늘 생성한 스크롤영상"만 표시 (source='scroll').
  useEffect(() => {
    window.electronAPI.bridge.list().then((all) => {
      setVideos(all.filter((i) => i.source === 'scroll' && isVideoPath(i.path) && isToday(i.importedAt)))
    })
  }, [])
  useEffect(() => {
    const off = window.electronAPI.bridge.onImported((img) => {
      // 오늘 도착한 스크롤영상이면 화면에 추가 — 생성 중 플래그와 무관하게 받아 누락을 막는다.
      if (img.source !== 'scroll' || !isVideoPath(img.path) || !isToday(img.importedAt)) return
      setVideos((prev) => [img, ...prev.filter((p) => p.id !== img.id)])
    })
    const offP = window.electronAPI.bridge.onProgress((m) => {
      if (pending.current) setMsg(m)
    })
    return () => {
      off()
      offP()
    }
  }, [])

  // 비율 변경: 편집값 보존하며 비례 변환
  const changeAspect = (a: Aspect) => {
    setAspect(a)
    setLayout((L) => rescaleLayout(L, a))
  }

  // 영상을 처음 올렸을 때의 '기본' 배치: 제목 아래에 좌우 여백을 두고 4:3 창,
  // 영상은 창을 꽉 채우고 가장자리를 자름(cover). 섹션은 그 아래로 이어진다.
  // 업로드 시점과 '4:3 기본' 버튼에서 공통으로 쓴다 → 영상 크기와 무관하게 항상 같은 프레임.
  const defaultVideoLayout = (L: ScrollLayout): Partial<ScrollLayout> => {
    const { W, H } = L
    const margin = Math.round(0.028 * W)
    const gap = Math.round(0.018 * H)
    const contentW = W - 2 * margin
    const hasT = title.trim() !== ''
    const hasS = subtitle.trim() !== ''
    const blockH =
      Math.ceil(L.titleSize * 0.22) * 2 +
      (hasT ? Math.round(L.titleSize * 1.25) : 0) +
      (hasS ? Math.round(L.subtitleSize * 1.4) + (hasT ? Math.round(L.titleGap ?? L.subtitleSize * 0.55) : 0) : 0)
    const top = hasT || hasS ? L.titleY + blockH + gap : margin
    const bottom = H - margin
    // 영상 = 4:3 (전체폭). 너무 크면 높이 한계(0.72H)로 줄이고 폭도 4:3에 맞춰 가로 중앙.
    let vw = contentW
    let vh = Math.round((vw * 3) / 4)
    const maxVH = Math.round(0.72 * H)
    if (vh > maxVH) {
      vh = maxVH
      vw = Math.round((vh * 4) / 3)
    }
    const vX = Math.round((W - vw) / 2)
    const vY = top
    const base: Partial<ScrollLayout> = {
      hasMedia: true,
      videoFit: 'cover',
      videoZoom: 1,
      vPadX: 0,
      vPadY: 0,
      video: { x: vX, y: vY, w: vw, h: vh }
    }
    // 이미지가 있으면 영상 아래에 '16:9 절반' 크기로 끼우고 텍스트를 그 아래로,
    // 없으면 텍스트를 영상 바로 아래로 — 항상 영상→(이미지)→텍스트 세로 스택.
    if (L.hasImage) {
      // 이미지 = 16:4.5 (16:9에서 세로너비 절반) — 영상과 같은 전체폭, 높이만 절반.
      const iw = contentW
      const ih = Math.round((iw * 9) / 32)
      const iY = vY + vh + gap
      const iX = margin
      const sY = iY + ih + gap
      return {
        ...base,
        imageZoom: 1,
        image: { x: iX, y: iY, w: iw, h: ih },
        section: { x: margin, y: sY, w: contentW, h: Math.max(160, bottom - sY) }
      }
    }
    const secY = vY + vh + gap
    return {
      ...base,
      section: { x: margin, y: secY, w: contentW, h: Math.max(200, bottom - secY) }
    }
  }

  // 비율 변경: 편집값 보존하며 비례 변환 (위에 정의됨) — 배치 통합 함수
  // 'default' = 영상(원본비율) + 텍스트, 'split2/3' = 가용영역 균등 분할.
  // 미디어를 나중에 첨부해도 같은 모드를 다시 적용해 배치가 어긋나지 않게 한다.
  const arrange = (
    kind: 'default' | 'split2' | 'split3',
    opts?: { vAR?: number; hasMedia?: boolean; applyDefaults?: boolean; iAR?: number }
  ) => {
    setTmpl(kind)
    setLayout((L) => {
      const { W, H } = L
      const margin = Math.round(0.028 * W)
      const gap = Math.round(0.018 * H)
      const contentW = W - 2 * margin
      // 제목 블록(제목+부제목) 높이 추정 → 영상 윗선을 그 아래에 배치
      const hasT = title.trim() !== ''
      const hasS = subtitle.trim() !== ''
      const blockH =
        Math.ceil(L.titleSize * 0.22) * 2 +
        (hasT ? Math.round(L.titleSize * 1.25) : 0) +
        (hasS ? Math.round(L.subtitleSize * 1.4) + (hasT ? Math.round(L.titleGap ?? L.subtitleSize * 0.55) : 0) : 0)
      const top = hasT || hasS ? L.titleY + blockH + gap : margin
      const bottom = H - margin
      const avail = bottom - top
      const mk = (y: number, h: number): Box => ({ x: margin, y, w: contentW, h: Math.round(h) })
      const hasMedia = opts?.hasMedia ?? L.hasMedia

      if (kind === 'split2') {
        const each = (avail - gap) / 2
        return { ...L, hasMedia: true, hasImage: false, video: mk(top, each), section: mk(top + each + gap, each) }
      }
      if (kind === 'split3') {
        // 3분할: 가이드(9:16) 비율에 맞춤 —
        //  상단 데드존(더 내림) · 제목/부제목 밴드 · 영상(4:3)+이미지(16:9) 미디어 밴드 · 텍스트 밴드 · 하단 데드존.
        // 빠른배치 드롭다운에서 고를 때만(useDef) 폰트·정렬 등 스타일도 기본값으로 리셋한다.
        const useDef = !!opts?.applyDefaults
        const g = Math.round(0.012 * H) // 박스 사이 간격
        // 실측(이미지 #5, 9:16) 비율: 데드존 → 제목 → 영상(전체폭 4:3) → 이미지(16:4.5) → 텍스트
        const safe = Math.round(0.135 * H) // 상단 데드존(노란 밴드)
        const titleTop = Math.round(0.15 * H) // 제목 윗선(데드존 바로 아래)
        // 영상: 전체폭 4:3 (가장 큰 요소)
        const vX = margin
        const vw = contentW
        const vY = Math.round(0.275 * H) // 영상 윗선(제목 밴드 아래)
        const vh = Math.round((vw * 3) / 4)
        // 이미지: 16:4.5(16:9 세로 절반) 전체폭, 영상 아래
        const iX = margin
        const iw = contentW
        const ih = Math.round((iw * 9) / 32)
        const iY = vY + vh + g
        // 텍스트: 이미지 아래 ~ 화면 맨 아래(하단 데드존 무시)
        const sY = iY + ih + g
        const sBottom = H - margin
        const sH = Math.max(120, sBottom - sY)
        const style = useDef
          ? {
              titleFont: 'Paperlogy',
              titleSize: 90,
              subtitleSize: 60,
              titleGap: 5,
              titleColor: '#ffffff',
              textSize: 46,
              lineSpacing: 1.5,
              speedPx: 80,
              align: 'left' as Align,
              padX: Math.round(0.03 * W),
              vPadX: 0,
              vPadY: 0,
              sectionBordered: false,
              imageBordered: false
            }
          : {}
        return {
          ...L,
          ...style,
          hasMedia: true,
          hasImage: true,
          safeTop: safe,
          titleY: titleTop,
          videoFit: 'cover',
          videoZoom: 1,
          imageZoom: 1,
          video: { x: vX, y: vY, w: vw, h: vh },
          image: { x: iX, y: iY, w: iw, h: ih },
          section: { x: margin, y: sY, w: contentW, h: sH }
        }
      }
      // default: 영상(16:9 고정 프레임, cover) + 텍스트 (영상 없으면 텍스트 전용)
      // 업로드한 영상 비율과 무관하게 항상 같은 16:9 창 → 섹션 크기가 들쭉날쭉하지 않음.
      if (hasMedia) {
        // 이미지 유무는 유지 — defaultVideoLayout 이 이미지가 있으면 영상→이미지→텍스트로 스택.
        return { ...L, ...defaultVideoLayout(L) }
      }
      return { ...L, hasMedia: false, section: mk(top, avail) }
    })
  }

  // 자동정렬 리셋 / 제목 토글 시 현재 모드 재적용
  const reLayout = () => arrange('default', { hasMedia: !!media })

  // ── 3분할 사용자 템플릿 ───────────────────────────────────────────
  // 현재 배치(영상/이미지/텍스트 박스 위치·크기, 제목/부제목 크기·간격·색 등)를 통째로 저장하고,
  // 3분할을 고르면 그대로 복원한다. 새 영상/이미지를 첨부해도 박스 위치는 유지(템플릿 우선).
  const hasSplit3Tpl = () => {
    try {
      return !!localStorage.getItem(SPLIT3_TPL_KEY)
    } catch {
      return false
    }
  }
  const saveSplit3Tpl = () => {
    try {
      localStorage.setItem(SPLIT3_TPL_KEY, JSON.stringify(layout))
      setTmpl('split3')
      setMsg('현재 배치를 3분할 템플릿으로 저장했어요')
    } catch {
      setMsg('템플릿 저장 실패')
    }
  }
  const clearSplit3Tpl = () => {
    try {
      localStorage.removeItem(SPLIT3_TPL_KEY)
    } catch {
      /* 무시 */
    }
    setMsg('3분할 템플릿을 삭제했어요 (기본 3분할로 동작)')
  }
  // 저장된 템플릿을 현재 화면 비율에 맞춰 적용. 없으면 false.
  const applySplit3Tpl = (): boolean => {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(SPLIT3_TPL_KEY)
    } catch {
      raw = null
    }
    if (!raw) return false
    try {
      const tpl = JSON.parse(raw) as ScrollLayout
      setTmpl('split3')
      setLayout(tpl.aspect === aspect ? { ...tpl } : rescaleLayout(tpl, aspect))
      return true
    } catch {
      return false
    }
  }

  const attachFile = async (files: FileList | File[]) => {
    const f = Array.from(files).find(
      (x) => x.type.startsWith('image/') || x.type.startsWith('video/')
    )
    if (!f) return
    const isVideo = f.type.startsWith('video/')
    // 경로가 잡히면(데스크톱) base64 없이 경로로 다루고 미리보기는 blob URL. (CSP 가 media data: 를 막음)
    let path = ''
    try {
      path = window.electronAPI.fs.getPathForFile(f) || ''
    } catch {
      /* 경로 불가 시 dataUrl 폴백 */
    }
    mediaTouched.current = true
    const m = path
      ? { previewUrl: URL.createObjectURL(f), path, isVideo }
      : { previewUrl: await fileToDataUrl(f), dataUrl: await fileToDataUrl(f), isVideo }
    // 먼저 미디어를 반영해 미리보기가 즉시 갱신되게 한다 (비율 계산이 늦어져도 영상이 보임).
    setMedia(m)
    setSelected('video')
    setPicked('video')
    // 3분할 템플릿 사용 중이면 박스 위치를 그대로 두고 영상만 채운다(위치 고정).
    const useTpl = tmpl === 'split3' && hasSplit3Tpl()
    if (useTpl) setLayout((L) => ({ ...L, hasMedia: true }))
    else arrange(tmpl, { hasMedia: true })
    // 비율은 메타데이터 로드 후 보정 — 실패/지연돼도 위에서 이미 영상은 표시됨.
    const ar = await getMediaAspect(m.previewUrl, isVideo)
    setMediaAR(ar)
    if (!useTpl) arrange(tmpl, { vAR: ar, hasMedia: true }) // 새 영상 비율로 박스 재정렬
  }
  const removeMedia = () => {
    mediaTouched.current = true
    setMedia((m) => {
      if (m?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl)
      return null
    })
    setLayout((L) => ({ ...L, hasMedia: false }))
  }

  const attachImage = async (files: FileList | File[]) => {
    const f = Array.from(files).find((x) => x.type.startsWith('image/'))
    if (!f) return
    const dataUrl = await fileToDataUrl(f)
    // 먼저 이미지를 반영해 미리보기가 즉시 갱신되게 한다 (비율 계산이 늦어져도 이미지가 보임).
    setImage({ dataUrl })
    setSelected('image')
    setPicked('image')
    if (tmpl === 'split3') {
      // 3분할: 영상(4:3 고정)·이미지(16:4.5)·텍스트 박스는 이미 프리셋이 잡아둠 → 이미지만 채운다.
      setLayout((L) => ({ ...L, hasImage: true, imageZoom: 1 }))
    } else {
      // 기본/2분할: 영상은 4:3 기본 그대로(우선순위), 이미지를 그 아래 16:4.5로 끼우고
      // 텍스트를 이미지 아래로 — defaultVideoLayout 으로 영상→이미지→텍스트 일괄 재정렬.
      setLayout((L) => {
        const L2 = { ...L, hasImage: true }
        return { ...L2, ...defaultVideoLayout(L2) }
      })
    }
  }
  const removeImage = () => {
    setImage(null)
    // 이미지를 빼면 영상→텍스트로 다시 정렬(영상 없으면 hasImage만 끔).
    setLayout((L) => {
      const L2 = { ...L, hasImage: false }
      return L2.hasMedia ? { ...L2, ...defaultVideoLayout(L2) } : L2
    })
  }

  const patch = (p: Partial<ScrollLayout>) => setLayout((L) => ({ ...L, ...p }))
  const patchBox = (key: 'video' | 'section' | 'image', b: Partial<Box>) =>
    setLayout((L) => ({ ...L, [key]: { ...L[key], ...b } }))

  // 제목/부제목 추가·삭제 시 자리 확보를 위해 자동 재배치 (텍스트 입력 중엔 동작 안 함)
  const hasHeader = title.trim() !== '' || subtitle.trim() !== ''
  const prevHasHeader = useRef(hasHeader)
  useEffect(() => {
    if (prevHasHeader.current !== hasHeader) {
      prevHasHeader.current = hasHeader
      // 3분할 템플릿 사용 중엔 위치를 고정(재배치 안 함)
      if (!(tmpl === 'split3' && hasSplit3Tpl())) {
        arrange(tmpl, { hasMedia: !!media }) // 제목/부제목 유무 바뀌면 현재 모드로 다시 정렬
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHeader])

  // ── 드래그/리사이즈 ──────────────────────────────────────────────
  const dragRef = useRef<{
    target: DragTarget
    mode: DragMode
    sx: number
    sy: number
    box: Box
    titleY: number
    safeTop: number
    W: number
    H: number
  } | null>(null)

  const onPointerDown = (
    e: React.PointerEvent,
    target: DragTarget,
    mode: DragMode
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (target !== 'safeTop') {
      setSelected(target) // 데드존 가이드는 선택 요소로 잡지 않음
      setPicked(target) // 클릭한 요소에 녹색 테두리 표시
    }
    dragRef.current = {
      target,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      box:
        target === 'video'
          ? { ...layout.video }
          : target === 'image'
            ? { ...layout.image }
            : { ...layout.section },
      titleY: layout.titleY,
      safeTop: layout.safeTop ?? layout.titleY,
      W: layout.W,
      H: layout.H
    }
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || scale === 0) return
      const dx = (e.clientX - d.sx) / scale
      const dy = (e.clientY - d.sy) / scale
      if (d.target === 'title') {
        setLayout((L) => ({ ...L, titleY: clamp(d.titleY + dy, 0, L.H - L.titleSize) }))
        return
      }
      if (d.target === 'safeTop') {
        // 쇼츠 상단 영역 아래 선을 드래그 → 데드존 높이만 조절(제목과 독립)
        setLayout((L) => ({ ...L, safeTop: clamp(d.safeTop + dy, 0, Math.round(L.H * 0.5)) }))
        return
      }
      const key = d.target
      const b = d.box
      if (d.mode === 'move') {
        // 화면 세로/가로 중앙선에 박스 중심을 스냅 (8px 임계) + 녹색 가이드선 표시
        const SNAP = 8 / scale
        const cx = d.W / 2
        const cy = d.H / 2
        let nx = clamp(b.x + dx, 0, d.W - b.w)
        let ny = clamp(b.y + dy, 0, d.H - b.h)
        let gv = false
        let gh = false
        if (Math.abs(nx + b.w / 2 - cx) <= SNAP) {
          nx = Math.round(cx - b.w / 2)
          gv = true
        }
        if (Math.abs(ny + b.h / 2 - cy) <= SNAP) {
          ny = Math.round(cy - b.h / 2)
          gh = true
        }
        setGuides((g) => (g.v === gv && g.h === gh ? g : { v: gv, h: gh }))
        setLayout((L) => ({ ...L, [key]: { ...L[key], x: nx, y: ny } }))
        return
      }
      setLayout((L) => {
        // resize (우하단 핸들)
        const minW = 120
        const minH = key === 'section' ? 200 : 80
        const w = clamp(b.w + dx, minW, L.W - b.x)
        // 원본 비율 영상은 리사이즈 시 비율 고정(레터박스 방지) — 높이를 영상 비율로 자동
        const h =
          key === 'video' && L.videoFit === 'contain'
            ? clamp(Math.round(w / mediaAR), minH, L.H - b.y)
            : clamp(b.h + dy, minH, L.H - b.y)
        return { ...L, [key]: { ...L[key], w, h } }
      })
    }
    const up = () => {
      dragRef.current = null
      setGuides((g) => (g.v || g.h ? { v: false, h: false } : g))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [scale, mediaAR])

  // ── 미리보기 스크롤 애니메이션 ───────────────────────────────────
  const textRef = useRef<HTMLDivElement>(null)
  const inner = innerSection(layout)
  useEffect(() => {
    const el = textRef.current
    if (!el || scale === 0) return
    const innerHpx = inner.h * scale
    const textHpx = el.scrollHeight
    const travelPx = innerHpx + textHpx
    const durSec = travelPx / (layout.speedPx * scale)
    const anim = el.animate(
      [{ transform: `translateY(${innerHpx}px)` }, { transform: `translateY(${-textHpx}px)` }],
      { duration: Math.max(1000, durSec * 1000), iterations: Infinity, easing: 'linear' }
    )
    return () => anim.cancel()
  }, [
    scale,
    text,
    layout.textSize,
    layout.lineSpacing,
    layout.align,
    layout.padX,
    layout.padY,
    layout.speedPx,
    inner.h,
    inner.w,
    previewKey
  ])

  const run = async () => {
    if (!text.trim()) {
      setMsg('스크롤할 텍스트(대본)를 입력하세요')
      return
    }
    setGenerating(true)
    pending.current = true
    setMsg('스크롤영상 준비 중…')
    try {
      const spec = await renderSpecFromLayout(layout, {
        text,
        title,
        subtitle,
        media: media ? { path: media.path, dataUrl: media.dataUrl, isVideo: media.isVideo } : undefined,
        image: image ? { dataUrl: image.dataUrl } : undefined
      })
      const r = await window.electronAPI.bridge.generateScroll(spec)
      setMsg(r.ok ? '완료' : r.message || '생성 실패')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '생성 실패')
    } finally {
      pending.current = false
      setGenerating(false)
    }
  }

  // 전체 초기화: 제목/부제목/본문·첨부 영상·이미지·레이아웃을 기본값으로 되돌린다.
  // (저장된 폼은 상태가 비워지면 디바운스 저장으로 자동 갱신됨)
  const resetAll = () => {
    mediaTouched.current = true
    setMedia((m) => {
      if (m?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl)
      return null
    })
    setImage(null)
    setTitle('')
    setSubtitle('')
    setText('')
    setTmpl('default')
    setSelected('home')
    setPicked(null)
    setMediaAR(16 / 9)
    setLayout(autoLayout(aspect, false, false))
    setMsg('')
    setPreviewKey((k) => k + 1)
  }

  const deleteVideo = async (id: string) => {
    await window.electronAPI.bridge.remove([id])
    setVideos((prev) => prev.filter((i) => i.id !== id))
  }

  const fadeFrac = clamp(Math.round(0.05 * layout.H) / inner.h, 0.01, 0.45)
  const mediaUrl = media?.previewUrl || ''

  // 스테이지 위 박스 공통 스타일
  const px = (n: number) => `${n * scale}px`
  // 선택 표시(녹색 테두리)는 미리보기에서 실제로 '선택(클릭)'한 요소에만 그린다.
  // 빈 캔버스를 누르면 picked=null 이 되어 해제 → 실제 출력 화면처럼 보인다.
  const ring = (t: Sel): string | undefined =>
    picked === t ? '0 0 0 2px var(--primary)' : undefined
  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    right: -7,
    bottom: -7,
    width: 14,
    height: 14,
    borderRadius: 4,
    background: 'var(--primary)',
    border: '2px solid #fff',
    cursor: 'nwse-resize'
  }

  return (
    <div className="igen">
      {/* 좌측: 미리보기 + 결과 */}
      <div className="igen-left" style={{ overflow: 'auto' }}>
        <div className="igen-left-head">
          <ScrollText size={15} /> 미리보기
          <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
            박스를 드래그해 이동 · 모서리로 크기조절
          </span>
          <button
            onClick={() => {
              if (window.confirm('제목·영상·내용을 모두 비우고 처음 상태로 되돌릴까요?')) resetAll()
            }}
            title="전체 초기화 (제목·영상·내용 비우기)"
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
        </div>

        <div
          // 미리보기 바깥 여백을 눌러도 선택 해제 (요소 박스 클릭은 stopPropagation 되어 안 풀림)
          onPointerDown={(e) => { if (e.target === e.currentTarget) setPicked(null) }}
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 16,
            background: 'var(--surface-2)',
            borderRadius: 12,
            userSelect: dragRef.current ? 'none' : 'auto'
          }}
        >
          <div
            ref={stageRef}
            // 빈 캔버스(배경) 클릭 시 선택 해제 → 녹색 테두리 사라짐. 요소 박스 클릭은
            // onPointerDown 에서 stopPropagation 하므로 여기로 버블링되지 않음.
            onPointerDown={(e) => { if (e.target === e.currentTarget) setPicked(null) }}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: layout.aspect === '16:9' ? 560 : layout.aspect === '1:1' ? 420 : 320,
              aspectRatio: `${layout.W} / ${layout.H}`,
              background: layout.bg,
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: '0 8px 30px rgba(0,0,0,.4)'
            }}
          >
            {scale > 0 && (
              <>
                {/* 영상 박스 */}
                {layout.hasMedia && media && (
                  <div
                    onPointerDown={(e) => onPointerDown(e, 'video', 'move')}
                    style={{
                      position: 'absolute',
                      left: px(layout.video.x),
                      top: px(layout.video.y),
                      width: px(layout.video.w),
                      height: px(layout.video.h),
                      borderRadius: px(layout.radius),
                      border: `${Math.max(1, layout.border * scale)}px solid var(--border)`,
                      boxShadow: ring('video'),
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      cursor: 'grab',
                      background: 'transparent',
                      // 선택된 요소를 맨 위로 → 겹쳐 있어도 그 박스가 드래그를 잡음
                      zIndex: selected === 'video' ? 20 : 1
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: px(layout.vPadX),
                        top: px(layout.vPadY),
                        width: px(layout.video.w - 2 * layout.vPadX),
                        height: px(layout.video.h - 2 * layout.vPadY),
                        overflow: 'hidden'
                      }}
                    >
                      {media.isVideo ? (
                        <video key={previewKey} src={mediaUrl} muted loop autoPlay playsInline
                          style={{ width: '100%', height: '100%', objectFit: layout.videoFit, pointerEvents: 'none', transform: layout.videoFit === 'cover' && layout.videoZoom > 1 ? `scale(${layout.videoZoom})` : undefined }} />
                      ) : (
                        <img src={mediaUrl} alt=""
                          style={{ width: '100%', height: '100%', objectFit: layout.videoFit, pointerEvents: 'none', transform: layout.videoFit === 'cover' && layout.videoZoom > 1 ? `scale(${layout.videoZoom})` : undefined }} />
                      )}
                    </div>
                    <div onPointerDown={(e) => onPointerDown(e, 'video', 'resize')} style={handleStyle} />
                  </div>
                )}

                {/* 별도 이미지 박스 */}
                {layout.hasImage && image && (
                  <div
                    onPointerDown={(e) => onPointerDown(e, 'image', 'move')}
                    style={{
                      position: 'absolute',
                      left: px(layout.image.x),
                      top: px(layout.image.y),
                      width: px(layout.image.w),
                      height: px(layout.image.h),
                      borderRadius: layout.imageBordered ? px(layout.radius) : 0,
                      border: layout.imageBordered
                        ? `${Math.max(1, layout.border * scale)}px solid var(--border)`
                        : picked === 'image'
                          ? '1px dashed rgba(255,255,255,.25)'
                          : '1px dashed transparent',
                      boxShadow: ring('image'),
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      cursor: 'grab',
                      background: 'transparent',
                      zIndex: selected === 'image' ? 20 : 2
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: px(layout.imgPadX),
                        top: px(layout.imgPadY),
                        width: px(layout.image.w - 2 * layout.imgPadX),
                        height: px(layout.image.h - 2 * layout.imgPadY),
                        overflow: 'hidden'
                      }}
                    >
                      <img src={image.dataUrl} alt=""
                        style={{
                          width: '100%',
                          height: '100%',
                          // 박스를 꽉 채움(cover) + 중앙 확대 → 16:9 이미지를 16:4.5 박스에 넣으면 세로 절반만 보이고,
                          // '이미지 크기'로 가운데 기준 확대/축소. 1배에서 모드 전환 없이 매끄럽게.
                          objectFit: 'cover',
                          pointerEvents: 'none',
                          transformOrigin: 'center',
                          transform: (layout.imageZoom ?? 1) > 1 ? `scale(${layout.imageZoom})` : undefined
                        }} />
                    </div>
                    <div onPointerDown={(e) => onPointerDown(e, 'image', 'resize')} style={handleStyle} />
                  </div>
                )}

                {/* 텍스트 섹션 (hasText 일 때만) */}
                {layout.hasText !== false && (
                <div
                  onPointerDown={(e) => onPointerDown(e, 'section', 'move')}
                  style={{
                    position: 'absolute',
                    left: px(layout.section.x),
                    top: px(layout.section.y),
                    width: px(layout.section.w),
                    height: px(layout.section.h),
                    borderRadius: px(layout.radius),
                    border: layout.sectionBordered !== false
                      ? `${Math.max(1, layout.border * scale)}px solid var(--border)`
                      : '0 solid transparent',
                    boxShadow: ring('section'),
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    cursor: 'grab',
                    zIndex: selected === 'section' ? 20 : 3
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: px(layout.padX),
                      top: px(layout.padY),
                      width: px(inner.w),
                      height: px(inner.h),
                      overflow: 'hidden',
                      WebkitMaskImage: `linear-gradient(to bottom, transparent 0%, #000 ${fadeFrac * 100}%, #000 ${(1 - fadeFrac) * 100}%, transparent 100%)`,
                      maskImage: `linear-gradient(to bottom, transparent 0%, #000 ${fadeFrac * 100}%, #000 ${(1 - fadeFrac) * 100}%, transparent 100%)`
                    }}
                  >
                    <div
                      ref={textRef}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: px(inner.w),
                        color: 'var(--text)',
                        fontFamily: "'Paperlogy', sans-serif",
                        fontSize: px(layout.textSize),
                        lineHeight: layout.lineSpacing,
                        textAlign: layout.align,
                        whiteSpace: 'pre-wrap',
                        textShadow: '1px 1px 2px rgba(0,0,0,.6)'
                      }}
                    >
                      {text || '여기에 입력한 텍스트가\n아래에서 위로 스크롤됩니다.'}
                    </div>
                  </div>
                  <div onPointerDown={(e) => onPointerDown(e, 'section', 'resize')} style={handleStyle} />
                </div>
                )}

                {/* 제목 + 부제목 (맨 위 — ffmpeg 와 동일하게 최상단 합성) */}
                {(title.trim() !== '' || subtitle.trim() !== '') && (
                  <div
                    onPointerDown={(e) => onPointerDown(e, 'title', 'move')}
                    style={{
                      position: 'absolute',
                      left: px(layout.section.x),
                      top: px(layout.titleY),
                      width: px(layout.section.w),
                      textAlign: 'center',
                      fontFamily: `'${layout.titleFont}', 'Paperlogy', sans-serif`,
                      cursor: 'grab',
                      textShadow: '1px 1px 2px rgba(0,0,0,.55)',
                      boxShadow: ring('title'),
                      borderRadius: 4,
                      padding: `${Math.ceil(layout.titleSize * 0.22) * scale}px 0`,
                      zIndex: selected === 'title' ? 20 : 4
                    }}
                  >
                    {title.trim() !== '' && (
                      <div style={{ color: layout.titleColor, fontWeight: 700, fontSize: px(layout.titleSize), lineHeight: 1.25 }}>
                        {title}
                      </div>
                    )}
                    {subtitle.trim() !== '' && (
                      <div style={{ color: layout.subtitleColor, fontSize: px(layout.subtitleSize), lineHeight: 1.4, marginTop: title.trim() !== '' ? px(layout.titleGap ?? layout.subtitleSize * 0.55) : 0 }}>
                        {subtitle}
                      </div>
                    )}
                  </div>
                )}

                {/* 쇼츠 상단 데드존 가이드 (9:16) — 아래 선을 드래그해 높이 조절(제목과 독립) */}
                {layout.aspect === '9:16' && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: '100%',
                      height: px(layout.safeTop ?? layout.titleY),
                      background: 'rgba(255,170,40,.18)',
                      borderBottom: '2px solid rgba(255,170,40,.7)',
                      pointerEvents: 'none',
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center'
                    }}
                  >
                    <span style={{ fontSize: 9, color: 'rgba(255,190,90,.9)', paddingBottom: 5 }}>
                      쇼츠 상단 영역 (선을 드래그)
                    </span>
                    {/* 아래 경계선 위의 드래그 핸들 */}
                    <div
                      onPointerDown={(e) => onPointerDown(e, 'safeTop', 'move')}
                      title="드래그해서 쇼츠 상단 영역 높이 조절"
                      style={{
                        position: 'absolute',
                        left: 0,
                        bottom: -6,
                        width: '100%',
                        height: 12,
                        pointerEvents: 'auto',
                        cursor: 'ns-resize'
                      }}
                    />
                  </div>
                )}

                {/* 중앙선 스냅 가이드 (드래그 중 정렬되면 표시) */}
                {guides.v && (
                  <div
                    style={{
                      position: 'absolute',
                      left: px(layout.W / 2),
                      top: 0,
                      width: 1.5,
                      height: '100%',
                      transform: 'translateX(-50%)',
                      background: '#3ecf8e',
                      boxShadow: '0 0 4px rgba(62,207,142,.8)',
                      pointerEvents: 'none',
                      zIndex: 50
                    }}
                  />
                )}
                {guides.h && (
                  <div
                    style={{
                      position: 'absolute',
                      top: px(layout.H / 2),
                      left: 0,
                      height: 1.5,
                      width: '100%',
                      transform: 'translateY(-50%)',
                      background: '#3ecf8e',
                      boxShadow: '0 0 4px rgba(62,207,142,.8)',
                      pointerEvents: 'none',
                      zIndex: 50
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* 생성된 스크롤영상 */}
        {videos.length > 0 && (
          <>
            <div className="igen-left-head" style={{ marginTop: 18 }}>
              생성된 스크롤영상 <span className="igen-count">{videos.length}</span>
            </div>
            <div
              className="igen-grid"
              style={{ flex: 'none', overflow: 'visible', padding: '4px 0 16px' }}
            >
              {generating && (
                <div className="igen-tile igen-tile-loading">
                  <Loader2 size={20} className="igen-spin" />
                </div>
              )}
              {videos.map((v) => {
                const name = v.path.split(/[\\/]/).pop() || ''
                const src = port ? `http://127.0.0.1:${port}/media/${name}` : ''
                return (
                  <div
                    key={v.id}
                    className="igen-tile"
                    title={v.filename}
                    onClick={() => window.electronAPI.fs.openPath(v.path)}
                  >
                    {src ? (
                      <video
                        src={src}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          // 스크롤영상은 t=0 에 텍스트가 화면 밖이라 비어보임 → 중간 지점으로 시킹해 썸네일 표시
                          const d = e.currentTarget.duration
                          try {
                            e.currentTarget.currentTime = isFinite(d) && d > 0 ? d * 0.35 : 0.1
                          } catch {
                            /* 시킹 실패 무시 */
                          }
                        }}
                        onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
                        onMouseOut={(e) => e.currentTarget.pause()}
                      />
                    ) : (
                      <div className="igen-tile-empty">로딩…</div>
                    )}
                    <button
                      className="igen-ref-x"
                      style={{ right: 'auto', left: 6 }}
                      onClick={async (e) => {
                        e.stopPropagation()
                        const r = await window.electronAPI.fs.saveFileAs(v.path, v.filename || 'scroll.mp4')
                        if (r.ok) setMsg('저장 완료: ' + r.path)
                      }}
                      title="다른 위치에 저장"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      className="igen-ref-x"
                      onClick={(e) => { e.stopPropagation(); deleteVideo(v.id) }}
                      title="삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* 우측: 입력 + 조절 (섹션 + 하단 고정 생성바) */}
      <div
        className="igen-right"
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          overflow: 'hidden'
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 16px' }}>
          {/* ── 상단 탭: 홈 · 제목 · 영상 · 이미지 · 텍스트 ── */}
          <div style={{ paddingTop: 6 }}>
            <div className="igen-ratios" style={{ marginBottom: 14, flexWrap: 'nowrap', gap: 6 }}>
              {(Object.keys(SEL_META) as Sel[]).map((s) => {
                const { label, Icon } = SEL_META[s]
                return (
                  <button key={s} className={`igen-ratio ${selected === s ? 'active' : ''}`}
                    onClick={() => { setSelected(s); setPicked(s === 'home' ? null : s) }}
                    style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 4px', whiteSpace: 'nowrap' }}>
                    <Icon size={13} /> {label}
                  </button>
                )
              })}
            </div>

            {/* 홈: 화면 비율 · 빠른 배치 · 리셋 · 템플릿 (기본 설정) */}
            {selected === 'home' && (
              <>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="igen-label" style={{ marginBottom: 6 }}>화면 비율</div>
                    <select value={aspect} style={{ width: '100%' }}
                      onChange={(e) => changeAspect(e.target.value as Aspect)}>
                      {ASPECT_OPTS.map((a) => (
                        <option key={a.v} value={a.v}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="igen-label" style={{ marginBottom: 6 }}>빠른 배치</div>
                    <select value={tmpl} style={{ width: '100%' }}
                      onChange={(e) => {
                        const t = e.target.value as 'default' | 'split2' | 'split3'
                        if (t === 'split2') arrange('split2')
                        // 3분할: 항상 기본 프리셋 적용(저장 템플릿은 '불러오기' 버튼으로만 복원)
                        else if (t === 'split3') arrange('split3', { applyDefaults: true })
                        else arrange('default', { hasMedia: !!media })
                      }}>
                      <option value="default">기본</option>
                      <option value="split2">2분할</option>
                      <option value="split3">3분할</option>
                    </select>
                  </div>
                </div>
                <button className="igen-act" style={{ marginTop: 12 }} onClick={() => reLayout()}>
                  <RotateCcw size={13} /> 자동정렬로 리셋
                </button>

                {/* 사용자 템플릿: 지금 배치를 저장 → '불러오기'로 그대로 복원 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="igen-act" style={{ flex: 1 }} onClick={saveSplit3Tpl}
                    title="지금 화면의 영상·이미지·제목·텍스트 위치와 크기를 템플릿으로 저장합니다">
                    <Bookmark size={13} /> 템플릿 저장
                  </button>
                  {hasSplit3Tpl() && (
                    <>
                      <button className="igen-act" style={{ flex: 1 }}
                        onClick={() => { if (applySplit3Tpl()) setMsg('저장한 템플릿을 불러왔어요') }}
                        title="저장한 템플릿 배치를 그대로 불러옵니다">
                        <Bookmark size={13} /> 불러오기
                      </button>
                      <button className="igen-act" style={{ flex: '0 0 auto' }} onClick={clearSplit3Tpl}
                        title="저장한 템플릿 삭제">
                        <BookmarkX size={13} /> 삭제
                      </button>
                    </>
                  )}
                </div>
                <p className="igen-note" style={{ marginTop: 6 }}>
                  {hasSplit3Tpl()
                    ? '저장된 템플릿이 있어요. ‘불러오기’를 누르면 그 배치가 그대로 복원됩니다.'
                    : '여기서 화면 비율·기본 배치를 정하고, 제목·영상·이미지·텍스트 탭에서 내용을 채우세요.'}
                </p>
              </>
            )}

            {selected === 'section' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  {layout.hasText === false ? (
                    <button className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => patch({ hasText: true })}>＋ 텍스트 추가</button>
                  ) : (
                    <button className="btn ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => patch({ hasText: false })}>✕ 텍스트 제거</button>
                  )}
                </div>
                {layout.hasText === false ? (
                  <p className="igen-note" style={{ textAlign: 'center', padding: '24px 0' }}>
                    텍스트 없이 미디어(영상/이미지)만으로 영상을 만듭니다.<br />텍스트가 필요하면 위 ‘＋ 텍스트 추가’를 누르세요.
                  </p>
                ) : (
                <>
                <textarea
                  className="igen-textarea"
                  rows={5}
                  placeholder={'스크롤할 대본/가사/문구를 입력하세요.'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 14px', marginTop: 12 }}>
                  <Slider label="글자 크기" value={layout.textSize} min={20} max={120} suffix="px"
                    onChange={(v) => patch({ textSize: v })} />
                  <Slider label="줄 간격" value={layout.lineSpacing} min={1} max={2.6} step={0.1}
                    onChange={(v) => patch({ lineSpacing: v })} />
                  <Slider label="좌우 여백" value={layout.padX} min={0} max={Math.round(0.14 * layout.W)} suffix="px"
                    onChange={(v) => patch({ padX: v })} />
                  <Slider label="스크롤 창 높이" value={layout.section.h} min={200} max={layout.H - layout.section.y} suffix="px"
                    onChange={(v) => patchBox('section', { h: v })} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="igen-label" style={{ marginBottom: 6 }}>텍스트 정렬</div>
                    <select value={layout.align} style={{ width: '100%' }}
                      onChange={(e) => patch({ align: e.target.value as Align })}>
                      <option value="left">왼쪽</option>
                      <option value="center">가운데</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="igen-label" style={{ marginBottom: 6 }}>스크롤 속도</div>
                    <select value={String(layout.speedPx)} style={{ width: '100%' }}
                      onChange={(e) => patch({ speedPx: Number(e.target.value) })}>
                      {SPEEDS.map((s) => (
                        <option key={s.v} value={String(s.v)}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="igen-label" style={{ marginBottom: 6 }}>테두리선</div>
                    <select value={layout.sectionBordered === false ? '0' : '1'} style={{ width: '100%' }}
                      onChange={(e) => patch({ sectionBordered: e.target.value === '1' })}>
                      <option value="1">있음</option>
                      <option value="0">없음</option>
                    </select>
                  </div>
                </div>
                <p className="igen-note">미리보기에서 텍스트 박스를 드래그해 위치·크기를 조절할 수 있어요.</p>
                </>
                )}
              </>
            )}

            {selected === 'title' && (
              <>
                <input
                  className="igen-textarea"
                  style={{ minHeight: 0 }}
                  placeholder="제목 (선택) — 예) 오늘의 명언"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <input
                  className="igen-textarea"
                  style={{ minHeight: 0, marginTop: 8 }}
                  placeholder="부제목 (선택)"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                />
                {title.trim() !== '' || subtitle.trim() !== '' ? (
                  <div style={{ marginTop: 14 }}>
                  <div className="igen-label" style={{ marginBottom: 6 }}>폰트</div>
                  <select
                    value={layout.titleFont}
                    onChange={(e) => patch({ titleFont: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                      padding: '8px 10px',
                      fontFamily: 'inherit',
                      fontSize: 13
                    }}
                  >
                    {FONTS.map((f) => (
                      <option key={f.css} value={f.css}>{f.label}</option>
                    ))}
                  </select>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 14px', marginTop: 12 }}>
                    <Slider label="제목 크기" value={layout.titleSize} min={28} max={180} suffix="px"
                      onChange={(v) => patch({ titleSize: v })} />
                    <Slider label="부제목 크기" value={layout.subtitleSize} min={16} max={110} suffix="px"
                      onChange={(v) => patch({ subtitleSize: v })} />
                    <Slider label="제목·부제목 간격" value={layout.titleGap ?? Math.round(layout.subtitleSize * 0.55)} min={0} max={160} suffix="px"
                      onChange={(v) => patch({ titleGap: v })} />
                  </div>

                  <div style={{ display: 'flex', gap: 18, marginTop: 12, alignItems: 'center' }}>
                    <ColorField label="제목색" title="제목 글씨색" value={layout.titleColor}
                      onChange={(c) => patch({ titleColor: c })} />
                    <ColorField label="부제목색" title="부제목 글씨색" value={layout.subtitleColor}
                      onChange={(c) => patch({ subtitleColor: c })} />
                  </div>
                  <p className="igen-note">미리보기에서 제목을 드래그해 위치를 옮길 수 있어요. (9:16은 쇼츠 상단 영역 아래에 기본 배치됨)</p>
                  </div>
                ) : (
                  <p className="igen-note">제목·부제목을 입력하면 폰트·크기·색 옵션이 여기 나타나요.</p>
                )}
              </>
            )}

            {selected === 'video' && (
              <>
                <div className="igen-label" style={{ marginBottom: 5 }}>영상 업로드</div>
                <div
                  className="igen-drop"
                  style={{ minHeight: 84 }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) attachFile(e.dataTransfer.files) }}
                  onClick={() => document.getElementById('sgen-file')?.click()}
                >
                  {!media ? (
                    <span style={{ fontSize: 12 }}>영상/이미지 첨부</span>
                  ) : (
                    <div className="igen-refs">
                      <div className="igen-ref" onClick={(e) => e.stopPropagation()}>
                        {media.isVideo ? <video src={mediaUrl} muted playsInline /> : <img src={mediaUrl} alt="" />}
                        <button className="igen-ref-x" onClick={removeMedia} title="제거"><X size={12} /></button>
                      </div>
                    </div>
                  )}
                </div>
                <input id="sgen-file" type="file" accept="image/*,video/*" hidden
                  onChange={(e) => { const el = e.currentTarget; if (el.files?.length) attachFile(el.files); el.value = '' }} />
                {media ? (
                  <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="igen-act"
                      style={{ flex: 1 }}
                      title="제목 아래에 4:3 기본 크기로 되돌립니다"
                      onClick={() => setLayout((L) => ({ ...L, ...defaultVideoLayout(L) }))}
                    >
                      4:3 기본
                    </button>
                    <button
                      className="igen-act"
                      style={{ flex: 1 }}
                      title="영상 창을 화면 전체로 (여백 없이 꽉 채움)"
                      onClick={() =>
                        setLayout((L) => ({
                          ...L,
                          video: { x: 0, y: 0, w: L.W, h: L.H },
                          videoFit: 'cover',
                          videoZoom: 1,
                          vPadX: 0,
                          vPadY: 0
                        }))
                      }
                    >
                      <VideoIcon size={13} /> 화면 꽉 채우기
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 14px', marginTop: 14 }}>
                    {/* 창 크기: 4:3 비율 고정한 채 폭만 조절 (가로 중심 유지) */}
                    <Slider label="창 크기" value={layout.video.w} min={Math.round(0.3 * layout.W)} max={layout.W} suffix="px"
                      onChange={(v) => {
                        const cx = layout.video.x + layout.video.w / 2
                        const w = v
                        const h = Math.round((w * 3) / 4)
                        const x = clamp(Math.round(cx - w / 2), 0, layout.W - w)
                        patchBox('video', { w, h, x })
                      }} />
                    {/* 영상 크기: 창 안에서 영상 확대(가장자리 더 잘림) */}
                    <Slider label="영상 크기" value={layout.videoZoom} min={1} max={2.5} step={0.05}
                      onChange={(v) => patch({ videoZoom: v })} />
                    {/* 모서리 둥글기: 영상 창의 모서리 라운드 */}
                    <Slider label="모서리 둥글기" value={layout.radius} min={0} max={Math.round(0.06 * layout.W)} suffix="px"
                      onChange={(v) => patch({ radius: v })} />
                  </div>
                  <p className="igen-note">
                    <b>창 크기</b>는 4:3 비율 그대로 커지고 줄어듭니다. <b>영상 크기</b>를 키우면 창 안에서 영상이 확대돼 가장자리가 더 잘려요.
                  </p>
                  <p className="igen-note">미리보기에서 영상 창을 드래그하면 위치·크기를 자유롭게(비율 무시) 바꿀 수 있어요.</p>
                  </div>
                ) : (
                  <p className="igen-note">영상을 올리면 크기·모서리 등 옵션이 여기 나타나요.</p>
                )}
              </>
            )}

            {selected === 'image' && (
              <>
                <div className="igen-label" style={{ marginBottom: 5 }}>이미지 업로드</div>
                <div
                  className="igen-drop"
                  style={{ minHeight: 84 }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) attachImage(e.dataTransfer.files) }}
                  onClick={() => document.getElementById('sgen-img')?.click()}
                >
                  {!image ? (
                    <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <ImagePlus size={13} /> 이미지 추가
                    </span>
                  ) : (
                    <div className="igen-refs">
                      <div className="igen-ref" onClick={(e) => e.stopPropagation()}>
                        <img src={image.dataUrl} alt="" />
                        <button className="igen-ref-x" onClick={removeImage} title="제거"><X size={12} /></button>
                      </div>
                    </div>
                  )}
                </div>
                <input id="sgen-img" type="file" accept="image/*" hidden
                  onChange={(e) => { const el = e.currentTarget; if (el.files?.length) attachImage(el.files); el.value = '' }} />
                {image ? (
                  <div style={{ marginTop: 12 }}>
                  <div className="igen-label" style={{ marginBottom: 6 }}>배치 방식</div>
                  <div className="igen-ratios">
                    <button className={`igen-ratio ${layout.imageBordered ? 'active' : ''}`}
                      onClick={() => patch({ imageBordered: true })} title="테두리 있는 박스 안에 배치">박스 안</button>
                    <button className={`igen-ratio ${!layout.imageBordered ? 'active' : ''}`}
                      onClick={() => patch({ imageBordered: false })} title="테두리 없이 이미지만 배치">그냥 배치</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '11px 14px', marginTop: 12 }}>
                    {/* 창 크기: 박스 비율 유지한 채 폭만 (이미지 전체가 보이는 상태 유지) */}
                    <Slider label="창 크기" value={layout.image.w} min={Math.round(0.15 * layout.W)} max={layout.W} suffix="px"
                      onChange={(v) => patchBox('image', { w: v, h: Math.round((v / layout.image.w) * layout.image.h) })} />
                    {/* 이미지 크기: 창 안에서 중앙 기준 확대(상하 잘림) */}
                    <Slider label="이미지 크기" value={layout.imageZoom ?? 1} min={1} max={2.5} step={0.05}
                      onChange={(v) => patch({ imageZoom: v })} />
                  </div>
                  <p className="igen-note">
                    <b>창 크기</b>는 이미지 전체가 보이는 박스 크기예요. <b>이미지 크기</b>를 키우면 창 가운데를 기준으로 확대돼 상하단이 잘립니다.
                  </p>
                  <p className="igen-note">미리보기에서 이미지를 드래그해 위치·크기를 조절할 수 있어요.</p>
                  </div>
                ) : (
                  <p className="igen-note">이미지를 올리면 배치·크기 옵션이 여기 나타나요.</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── 하단 고정 생성바 ── */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px' }}>
          {msg && <div className={`igen-msg ${msg === '완료' ? 'ok' : ''}`} style={{ marginBottom: 8, marginTop: 0 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <button className="igen-go" onClick={run} disabled={generating}
              style={{ marginTop: 0, flex: 1, width: 'auto', minWidth: 0, whiteSpace: 'nowrap' }}>
              {generating ? (<><Loader2 size={16} className="igen-spin" /> 생성 중…</>)
                : (<><Sparkles size={16} /> 스크롤영상 만들기</>)}
            </button>
            <button
              className="igen-go"
              onClick={() => window.electronAPI.fs.openPath(saveDir || '@downloads')}
              title="생성된 스크롤영상이 저장된 폴더 열기"
              style={{ marginTop: 0, flex: '0 0 auto', width: 'auto', whiteSpace: 'nowrap', padding: '12px 14px', background: 'var(--surface-2)', color: 'var(--text)' }}
            >
              <FolderOpen size={16} /> 저장폴더
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
