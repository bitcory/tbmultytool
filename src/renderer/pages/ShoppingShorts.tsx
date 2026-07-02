import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ShoppingBag,
  Link2,
  ExternalLink,
  Loader2,
  Star,
  Megaphone,
  Upload,
  Wand2,
  Film,
  Trash2,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Scissors,
  X,
  Copy,
  Check
} from 'lucide-react'
import type { Scene, ProjectOptions, AspectRatio, TtsProvider, ScriptProvider, CoupangProduct, ImportedImage } from '@shared/types'
import { usePersistedForm } from '../persist'

// 쇼핑쇼츠 파이프라인 — 쿠팡 상품 → 분석 → 대본 → 이미지 → 영상 → 오디오 → 편집 → 업로드 (단계 탭).
// 분석은 크롬 확장(coupang.js)이 사용자 브라우저에서 DOM 을 직접 읽어 403 없이 추출하고,
// 앱(/import-product)으로 보내면 bridge.onProduct 로 이 폼이 자동 채워진다.

const emptyProduct: CoupangProduct = {
  name: '',
  price: null,
  originalPrice: null,
  discount: null,
  rating: null,
  reviewCount: null,
  images: [],
  url: ''
}

const DURATIONS = [
  { v: 30, label: '30초', scenes: 4 },
  { v: 45, label: '45초', scenes: 6 },
  { v: 60, label: '60초', scenes: 8 }
]
const TONES = [
  { v: '활기차고 신뢰감 있는', label: '활기참' },
  { v: '차분하고 정보 전달 위주의', label: '정보형' },
  { v: '재미있고 후킹 강한', label: '후킹형' }
]
const won = (n: number | null) => (n == null ? '-' : n.toLocaleString('ko-KR') + '원')
const fmtNum = (n: number | null) => (n == null ? '' : n.toLocaleString('ko-KR'))
const parseNum = (s: string) => { const d = s.replace(/[^\d]/g, ''); return d ? parseInt(d, 10) : null }
const isCoupangUrl = (u: string) => /coupang\.com\/vp\/products\/\d+/.test(u)
const isImagePath = (p: string) => /\.(png|jpe?g|webp)$/i.test(p)
const isVideoPath = (p: string) => /\.(mp4|webm|mov)$/i.test(p)
const baseName = (p: string) => p.split(/[\\/]/).pop() || ''
const VID_DURATIONS = [
  { v: '6', label: '6초' },
  { v: '10', label: '10초' }
]
// Runway Seedance 2.0 길이 (최대 15초)
const RUNWAY_DURATIONS = [
  { v: '5', label: '5초' },
  { v: '10', label: '10초' },
  { v: '15', label: '15초' }
]
const VID_RES = [
  { v: '480p', label: '480p' },
  { v: '720p', label: '720p' }
]

// File → dataURL
const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = rej
    fr.readAsDataURL(f)
  })

// 로컬 media URL(또는 임의 URL) → dataURL (Flow I2I 참조로 넘기기 위함)
const urlToDataUrl = (url: string): Promise<string> =>
  fetch(url)
    .then((r) => r.blob())
    .then(
      (b) =>
        new Promise<string>((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result as string)
          fr.onerror = rej
          fr.readAsDataURL(b)
        })
    )

type ShortsTab = 'product' | 'script' | 'image' | 'video' | 'audio' | 'edit' | 'upload'
const TABS: { id: ShortsTab; label: string; Icon: typeof ShoppingBag }[] = [
  { id: 'product', label: '상품분석', Icon: ShoppingBag },
  { id: 'script', label: '대본생성', Icon: FileText },
  { id: 'image', label: '이미지생성', Icon: ImageIcon },
  { id: 'video', label: '영상생성', Icon: Video },
  { id: 'audio', label: '오디오생성', Icon: Music },
  { id: 'edit', label: '영상편집', Icon: Scissors },
  { id: 'upload', label: '영상업로드', Icon: Upload }
]

// 코드펜스 제거
const stripFences = (s: string) => s.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')

// 프롬프트 복사 버튼 (클릭 시 클립보드 복사 + 잠깐 '복사됨' 표시)
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    })
  }
  return (
    <button
      onClick={copy}
      title="프롬프트 복사"
      disabled={!text}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 6, color: done ? '#3ecf8e' : '#aab0c0', cursor: text ? 'pointer' : 'default', fontSize: 11, fontWeight: 600, padding: '3px 9px', opacity: text ? 1 : 0.5 }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? '복사됨' : '복사'}
    </button>
  )
}

// 첫 '{' 부터 문자열-인식 괄호매칭으로 균형 잡힌 객체만 잘라낸다(뒤따르는 산문의 '}' 오염 방지).
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start) // 불균형이면 나머지 전부 반환(복구에 맡김)
}

// LLM JSON 흔한 오류 보정: 스마트따옴표, 문자열 내부의 raw 개행/탭, 트레일링 콤마.
function repairJsonText(s: string): string {
  s = s.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'")
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) { out += ch; esc = false; continue }
      if (ch === '\\') { out += ch; esc = true; continue }
      if (ch === '"') { out += ch; inStr = false; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
    } else {
      out += ch
      if (ch === '"') inStr = true
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// 텍스트에서 JSON 객체/배열을 견고하게 파싱(원본 → 복구본 순서로 시도).
function looseParseJson(text: string): any | null {
  const raw = extractBalancedObject(stripFences(text))
  if (!raw) return null
  for (const cand of [raw, repairJsonText(raw)]) {
    try {
      return JSON.parse(cand)
    } catch {
      /* 다음 후보 */
    }
  }
  return null
}

// ChatGPT 응답(코드블록 포함)에서 대본 JSON 추출
function extractScenesJson(text: string): { title?: string; scenes: Record<string, unknown>[] } | null {
  const j = looseParseJson(text)
  return j && Array.isArray(j.scenes) && j.scenes.length ? j : null
}

type ParsedScene = { narration: string; imagePrompt: string }
const collapse = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim()

// 붙여넣은 대본을 씬 배열로 파싱. ① JSON(코드블록/객체/배열) 우선 → ② 텍스트(씬 헤더·라벨·문단) 폴백.
function parseScriptText(text: string): ParsedScene[] | null {
  if (!text || !text.trim()) return null
  const stripped = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
  const fromJson = (raw: string): ParsedScene[] | null => {
    for (const cand of [raw, repairJsonText(raw)]) {
      try {
        const j = JSON.parse(cand)
        const arr: any[] | null = Array.isArray(j) ? j : Array.isArray(j?.scenes) ? j.scenes : null
        if (!arr || !arr.length) continue
        const out = arr
          .map((s) => ({
            narration: collapse(String(s?.narration ?? s?.script ?? s?.text ?? s?.subtitle ?? s?.나레이션 ?? s?.자막 ?? '')),
            imagePrompt: collapse(String(s?.imagePrompt ?? s?.image_prompt ?? s?.prompt ?? s?.image ?? s?.visual ?? s?.이미지 ?? ''))
          }))
          .filter((s) => s.narration || s.imagePrompt)
        if (out.length) return out
      } catch {
        /* 다음 후보 */
      }
    }
    return null
  }
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = stripped.indexOf(open)
    const b = stripped.lastIndexOf(close)
    if (a >= 0 && b > a) {
      const r = fromJson(stripped.slice(a, b + 1))
      if (r) return r
    }
  }
  const plain = parsePlainScript(text)
  return plain && plain.length ? plain : null
}

// 라벨/번호 기반 평문 대본 파서
const NAR_LABEL = /^\s*(?:나레이션|내레이션|자막|대사|멘트|narration|script|voice ?over|vo)\s*[:：\-]\s*/i
const IMG_LABEL = /(?:이미지\s*프롬프트|이미지|장면\s*묘사|image ?prompt|image|prompt|visual)\s*[:：\-]\s*/i
const SCENE_HEAD = /^\s*(?:#+\s*)?(?:씬|장면|scene|cut|컷)\s*#?\s*\d+/i
const NUM_HEAD = /^\s*\d+[.)]\s+/
function parsePlainScript(text: string): ParsedScene[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const hasHeader = lines.some((l) => SCENE_HEAD.test(l))
  const hasLabel = lines.some((l) => NAR_LABEL.test(l) || IMG_LABEL.test(l.replace(NAR_LABEL, '')))
  // 씬 헤더도 라벨도 없으면: 번호 목록 → 각 번호가 씬, 아니면 빈 줄 문단 단위로 분할
  if (!hasHeader && !hasLabel) {
    if (lines.filter((l) => NUM_HEAD.test(l)).length >= 2) {
      const out: ParsedScene[] = []
      let cur: string | null = null
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (NUM_HEAD.test(line)) { if (cur != null) out.push({ narration: collapse(cur), imagePrompt: '' }); cur = line.replace(NUM_HEAD, '') }
        else cur = cur == null ? line : cur + ' ' + line
      }
      if (cur != null) out.push({ narration: collapse(cur), imagePrompt: '' })
      return out.filter((s) => s.narration)
    }
    const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map((p) => collapse(p.replace(NUM_HEAD, ''))).filter(Boolean)
    return paras.map((p) => ({ narration: p, imagePrompt: '' }))
  }
  const scenes: ParsedScene[] = []
  let cur: ParsedScene | null = null
  let mode: 'nar' | 'img' = 'nar'
  const push = () => { if (cur && (cur.narration || cur.imagePrompt)) scenes.push({ narration: collapse(cur.narration), imagePrompt: collapse(cur.imagePrompt) }); cur = null }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (SCENE_HEAD.test(line) || (NUM_HEAD.test(line) && !hasHeader)) {
      push()
      cur = { narration: '', imagePrompt: '' }
      mode = 'nar'
      const rest = line.replace(SCENE_HEAD, '').replace(NUM_HEAD, '').replace(/^\s*[:：.\-)]\s*/, '').trim()
      if (rest) cur.narration += rest + ' '
      continue
    }
    if (!cur) cur = { narration: '', imagePrompt: '' }
    const imgAt = line.search(IMG_LABEL)
    if (imgAt >= 0) {
      const before = line.slice(0, imgAt).replace(NAR_LABEL, '').trim()
      if (before) cur.narration += before + ' '
      cur.imagePrompt += line.slice(imgAt).replace(IMG_LABEL, '').trim() + ' '
      mode = 'img'
      continue
    }
    if (NAR_LABEL.test(line)) { cur.narration += line.replace(NAR_LABEL, '').trim() + ' '; mode = 'nar'; continue }
    // 라벨 없는 줄 → 현재 모드에 이어붙임
    cur[mode === 'img' ? 'imagePrompt' : 'narration'] += line + ' '
  }
  push()
  return scenes
}

// 세그먼트 컨트롤 (균일 너비 토글 그룹)
// 본문 입력 섹션을 감싸는 카드 + 번호 배지 헤더
const SECTION: React.CSSProperties = { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14 }
const SUFFIX: React.CSSProperties = { position: 'absolute', right: 11, top: 0, height: 40, display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: '#8b90a0', pointerEvents: 'none' }
function StepHead({ n, children, extra, done }: { n: number; children: React.ReactNode; extra?: React.ReactNode; done?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
      <span style={{ width: 20, height: 20, borderRadius: 999, background: done ? 'rgba(62,207,142,0.18)' : 'rgba(79,140,255,0.18)', color: done ? '#7ee0a0' : '#9db8ff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
        {done ? '✓' : n}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#dfe2ea' }}>{children}</span>
      {extra && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{extra}</span>}
    </div>
  )
}

function Seg<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: { v: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: '#8b90a0', marginBottom: 7 }}>
        {label}
        {hint ? <span style={{ fontWeight: 400, opacity: 0.7 }}> {hint}</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 11, padding: 4 }}>
        {options.map((o) => {
          const on = value === o.v
          return (
            <button
              key={String(o.v)}
              title={o.title}
              onClick={() => onChange(o.v)}
              style={{
                flex: 1,
                padding: '9px 6px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                background: on ? 'linear-gradient(180deg,#5b93ff,#346aff)' : 'transparent',
                color: on ? '#fff' : '#aab0c0',
                boxShadow: on ? '0 3px 10px rgba(52,106,255,0.4)' : 'none',
                transition: 'all .15s'
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const CARD: React.CSSProperties = {
  background: '#13151c',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 14,
  padding: 16
}

// 툴바용 컴팩트 인라인 세그먼트 (라벨 없음, 한 줄)
function SegInline<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 9, padding: 3 }}>
      {options.map((o) => {
        const on = value === o.v
        return (
          <button
            key={String(o.v)}
            onClick={() => onChange(o.v)}
            style={{
              padding: '6px 13px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              background: on ? 'linear-gradient(180deg,#5b93ff,#346aff)' : 'transparent',
              color: on ? '#fff' : '#aab0c0',
              boxShadow: on ? '0 2px 8px rgba(52,106,255,0.4)' : 'none'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
const TOOLBAR: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 12,
  padding: '10px 14px'
}
const TB_LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#8b90a0' }

// 기본 CTA 버튼 스타일
function ctaStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    marginTop: 4,
    padding: '13px',
    borderRadius: 11,
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    background: disabled ? 'rgba(52,106,255,0.45)' : 'linear-gradient(180deg,#5b93ff,#346aff)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: disabled ? 'none' : '0 6px 18px rgba(52,106,255,0.45)'
  }
}

// 작은 CTA(자동 너비) — "전체 생성" 등
function smallCta(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    background: disabled ? 'rgba(52,106,255,0.45)' : 'linear-gradient(180deg,#5b93ff,#346aff)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    boxShadow: disabled ? 'none' : '0 4px 12px rgba(52,106,255,0.4)'
  }
}
const stopBtn: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  background: 'linear-gradient(180deg,#ff6b6b,#e23b3b)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 13
}
// 타일 내 작은 생성/다시 버튼
function tileBtn(disabled: boolean): React.CSSProperties {
  return {
    marginLeft: 'auto',
    padding: '4px 10px',
    borderRadius: 7,
    border: '1px solid rgba(91,147,255,0.5)',
    cursor: disabled ? 'default' : 'pointer',
    background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(52,106,255,0.18)',
    color: disabled ? '#888' : '#9db8ff',
    fontSize: 11,
    fontWeight: 700
  }
}

// 내용에 맞춰 세로로 자동 확장되는 textarea (내부 스크롤 없음)
function AutoTextarea({
  value,
  onChange,
  placeholder,
  style
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [value])
  return (
    <textarea
      ref={ref}
      className="igen-textarea"
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      style={{ width: '100%', resize: 'none', overflow: 'hidden', lineHeight: 1.55, ...style }}
    />
  )
}

// 다음 단계 안내 카드 (영상/오디오/편집/업로드 placeholder)
function Soon({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', opacity: 0.7 }}>
      <div style={{ marginBottom: 10, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.6 }}>{desc}</div>
      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.5 }}>🚧 다음 단계에서 연결됩니다</div>
    </div>
  )
}

export default function ShoppingShorts() {
  const [url, setUrl] = useState('')
  const [product, setProduct] = useState<CoupangProduct>(emptyProduct)
  const [features, setFeatures] = useState('') // 핵심 특징(대본 재료)
  const [partnersLink, setPartnersLink] = useState('') // 쿠팡파트너스 제휴링크
  const [inpockLink, setInpockLink] = useState('') // 인포크링크
  const [aspect, setAspect] = useState<AspectRatio>('9:16')
  const [duration, setDuration] = useState(30)
  const [tone, setTone] = useState(TONES[0].v)
  const [tts, setTts] = useState<TtsProvider>('openai')
  const [narrationText, setNarrationText] = useState('') // 오디오 탭: 통합 나레이션(편집 가능)
  const [scriptSource, setScriptSource] = useState<'chatgpt' | 'api'>('chatgpt') // 대본 생성 방식
  const [peopleMode, setPeopleMode] = useState<'product' | 'hands' | 'free'>('hands') // 인물 표현 수준
  const [scenes, setScenes] = useState<Scene[]>([])
  // 씬 나레이션을 하나의 대본으로 통합 — 씬 구분 없이, 문장 단위로 줄바꿈(TTS 한 번에 처리)
  const buildNarration = () =>
    scenes
      .map((s) => (s.narration || '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/([.!?…])\s+/g, '$1\n')
      .trim()
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false) // 쿠팡 분석 대기 중(크롬에서 전송 버튼 누를 때까지)
  const [uploadOpen, setUploadOpen] = useState(false) // 대본 업로드 모달
  const [uploadText, setUploadText] = useState('')
  const [uploadErr, setUploadErr] = useState('')
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<ShortsTab>('product') // 단계 탭
  // 오디오 탭 진입 시 비어 있으면 씬 대사로 자동 채움
  useEffect(() => {
    if (tab === 'audio' && !narrationText.trim()) {
      const t = buildNarration()
      if (t) setNarrationText(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  const [sceneIdx, setSceneIdx] = useState(0) // 대본 씬 서브탭
  const [port, setPort] = useState(0)
  // 씬별 슬롯: 씬 id → 생성 결과(이미지/영상). 개별 생성/재생성 가능.
  const [imgByScene, setImgByScene] = useState<Record<string, ImportedImage>>({})
  const [vidByScene, setVidByScene] = useState<Record<string, ImportedImage>>({})
  const [busyImg, setBusyImg] = useState<Set<string>>(new Set()) // 이미지 생성 중인 씬 id
  const [busyVid, setBusyVid] = useState<Set<string>>(new Set()) // 영상 생성 중인 씬 id
  const imgQueue = useRef<string[]>([]) // 도착하는 Flow 이미지를 배정할 씬 id (FIFO)
  const vidQueue = useRef<string[]>([]) // 도착하는 그록 영상을 배정할 씬 id (FIFO)
  const [vidDuration, setVidDuration] = useState('6')
  const [vidRes, setVidRes] = useState('720p')
  const [vidEngine, setVidEngine] = useState<'grok' | 'runway'>('grok') // 영상 생성 엔진
  // 참조 이미지 매칭: 모드(전체/1:1/선택) + 풀 선택(제품이미지 index) + 씬별 선택
  const [refMode, setRefMode] = useState<'all' | 'one' | 'pick'>('all')
  const [refSel, setRefSel] = useState<Set<number>>(new Set()) // 비어있으면 전체 사용
  const [refPick, setRefPick] = useState<Record<string, number[]>>({}) // sceneId → 이미지 index[]

  // 입력 폼 영구 저장
  usePersistedForm(
    'shoppingshorts',
    { url, product, features, partnersLink, inpockLink, aspect, duration, tone, tts, scriptSource, peopleMode },
    (v) => {
      if (typeof v.url === 'string') setUrl(v.url)
      if (v.product && typeof v.product === 'object') setProduct(v.product as CoupangProduct)
      if (typeof v.features === 'string') setFeatures(v.features)
      if (typeof v.partnersLink === 'string') setPartnersLink(v.partnersLink)
      if (typeof v.inpockLink === 'string') setInpockLink(v.inpockLink)
      if (v.aspect === '9:16' || v.aspect === '16:9' || v.aspect === '1:1') setAspect(v.aspect)
      if (typeof v.duration === 'number') setDuration(v.duration)
      if (typeof v.tone === 'string') setTone(v.tone)
      if (v.tts === 'openai' || v.tts === 'elevenlabs') setTts(v.tts)
      if (v.scriptSource === 'chatgpt' || v.scriptSource === 'api') setScriptSource(v.scriptSource)
      if (v.peopleMode === 'product' || v.peopleMode === 'hands' || v.peopleMode === 'free') setPeopleMode(v.peopleMode)
    }
  )

  // 확장(coupang.js)이 추출한 상품정보가 도착하면 폼을 자동으로 채운다.
  useEffect(() => {
    const off = window.electronAPI.bridge.onProduct((p) => {
      setProduct(p)
      if (p.url) setUrl(p.url)
      setAnalyzing(false)
      setMsg(`상품 분석 완료: ${p.name}`)
    })
    return () => off()
  }, [])

  // 로컬 미디어 서버 포트 + Flow 이미지 도착 수신
  useEffect(() => {
    window.electronAPI.bridge.getInfo().then((i) => setPort(i.port)).catch(() => {})
    const off = window.electronAPI.bridge.onImported((img) => {
      // Flow 이미지 → 대기열의 다음 씬에 배정
      if (img.source === 'flow' && isImagePath(img.path)) {
        const sid = imgQueue.current.shift()
        if (!sid) return
        setImgByScene((prev) => ({ ...prev, [sid]: img }))
        setBusyImg((prev) => {
          const n = new Set(prev)
          n.delete(sid)
          return n
        })
        setMsg(imgQueue.current.length ? `이미지 받는 중… (남은 ${imgQueue.current.length})` : '이미지 생성 완료')
        return
      }
      // 그록 영상 → 대기열의 다음 씬에 배정
      if (img.source === 'grok' && isVideoPath(img.path)) {
        const sid = vidQueue.current.shift()
        if (!sid) return
        setVidByScene((prev) => ({ ...prev, [sid]: img }))
        setBusyVid((prev) => {
          const n = new Set(prev)
          n.delete(sid)
          return n
        })
        setMsg(vidQueue.current.length ? `영상 받는 중… (남은 ${vidQueue.current.length})` : '영상 생성 완료')
        return
      }
    })
    const offP = window.electronAPI.bridge.onProgress((m) => {
      if (imgQueue.current.length || vidQueue.current.length) setMsg(m)
    })
    return () => {
      off()
      offP()
    }
  }, [])

  // 쿠팡 상품페이지를 사용자의 진짜 크롬에서 열기 → 거기서 coupang.js 가 추출.
  const analyze = async () => {
    if (!isCoupangUrl(url)) {
      setMsg('올바른 쿠팡 상품 URL을 입력하세요 (…coupang.com/vp/products/…)')
      return
    }
    setProduct((p) => ({ ...p, url }))
    setAnalyzing(true)
    await window.electronAPI.fs.openExternal(url)
    setMsg('크롬에서 상품페이지를 열었어요. 페이지 우하단 "📥 앱으로 상품 보내기" 버튼을 누르면 정보가 채워집니다.')
  }

  const setP = (patch: Partial<CoupangProduct>) => setProduct((p) => ({ ...p, ...patch }))

  // 상품정보 → 대본(씬별 나레이션 + 이미지 프롬프트) 생성.
  const genScript = async () => {
    if (!product.name.trim()) {
      setMsg('상품명을 입력하거나 먼저 분석하세요')
      return
    }
    const sceneCount = DURATIONS.find((d) => d.v === duration)?.scenes ?? 4
    const segments = Math.max(2, Math.round(duration / 15)) // 15초 Seedance 세그먼트 수
    const priceLine = product.price
      ? `가격 ${won(product.price)}${product.discount ? ` (${product.discount}% 할인)` : ''}.`
      : ''
    const topReviews = (product.reviews || []).filter((r) => r.body || r.title).slice(0, 5)
    const reviewBlock = topReviews.length
      ? '\n실사용 후기:\n' +
        topReviews.map((r, i) => `${i + 1}. (${r.rating ?? '?'}점) ${r.title ? r.title + ' — ' : ''}${(r.body || '').slice(0, 220)}`).join('\n')
      : ''
    const attrBlock = (product.attributes || []).length
      ? '\n속성 만족도: ' + product.attributes!.map((a) => `${a.label} ${a.value}(${a.percent ?? '?'}%)`).join(', ')
      : ''
    const peopleRule =
      peopleMode === 'product'
        ? `- 제품에만 포커스. 사람/인물/얼굴/손 금지: "no people, no human, no face, no hands".\n`
        : peopleMode === 'hands'
          ? `- 얼굴은 절대 금지(AI 티 남): "no visible face, no recognizable person, face out of frame".\n` +
            `  단 손·팔로 제품을 쓰는 장면, POV, 뒷모습, 라이프스타일 컨텍스트(책상/방 등)는 자연스럽게 허용해 생동감을 줄 것.\n`
          : `- 자연스러운 인물 연출 허용(photorealistic, AI 티 안 나게). 단 과도한 클로즈업 얼굴은 지양.\n`
    const topic =
      `쿠팡 제품 홍보용 ${duration}초 세로 숏폼. 상품: "${product.name}". ${priceLine} ` +
      `핵심 특징: ${features || '(특징 미입력 — 상품명/후기 기반으로 매력 포인트를 추론)'}.` +
      reviewBlock +
      attrBlock +
      `\n위 실사용 후기에서 자주 언급되는 장점을 근거로, ${tone} 톤으로 시청자의 구매욕을 자극하고 ` +
      `마지막에 "지금 링크 확인" CTA로 마무리. 후기 내용을 과장 없이 자연스럽게 녹여라.` +
      `\n\n[이미지 프롬프트 규칙 — 매우 중요]\n` +
      `- 모든 imagePrompt 는 photorealistic product photography(실사 제품 사진), AI 티가 전혀 안 나게 자연스럽게.\n` +
      `- 실제 제품 이미지를 참조로 합성하므로 제품의 외형/색상/형태를 바꾸지 말 것(keep the exact product).\n` +
      `- 제품이 단 하나의 주인공(single hero product, centered): 제품과 어울리는 깔끔하고 보완적인 배경/표면(complementary clean background & surface)으로 제품이 돋보이게, 얕은 심도/은은한 조명.\n` +
      `- 주변에 관련 없는 다른 제품·소품·잡동사니 금지(no other unrelated products, no clutter, no distracting objects).\n` +
      `- 이미지/제품 위에 어떤 글자도 금지: no text, no captions, no labels, no logos, no watermark, no UI overlay.\n` +
      peopleRule +
      `- 9:16 세로 구도(vertical 9:16 composition).`
    setBusy(true)
    try {
      let result: Scene[]
      if (scriptSource === 'chatgpt') {
        setMsg('ChatGPT(확장)로 대본 생성 중… 크롬에서 ChatGPT 로그인 필요')
        const ratio = aspect
        const prompt =
          `너는 쿠팡 제품 숏폼 광고 감독 겸 대본 작가야. 아래 정보로 Seedance 2.0용 숏폼 대본을 짜.\n\n${topic}\n\n` +
          `[구조]\n` +
          `- 정확히 ${segments}개 세그먼트(scene). 각 세그먼트 = 15초짜리 Seedance 2.0 클립.\n` +
          `- 첫 세그먼트: 후크+핵심매력. 마지막 세그먼트: 기능+CTA(나레이션 끝에 "지금 아래 링크 확인").\n` +
          `[각 scene 필드]\n` +
          `- role: 역할(예 "hook+design","features+cta")\n` +
          `- durationSec: 15\n` +
          `- sellingPoints: 한국어 배열(후기/속성 근거)\n` +
          `- narration: 한국어 나레이션(15초 분량)\n` +
          `- captions: [{"at":"0:00","hook":"짧고 강한 후킹 문구","detail":"(보조설명)"}] 2~3개 (자막)\n` +
          `- refs: ["@product"] (인물 등장 시 "@character" 추가)\n` +
          `- imagePrompt: 이 세그먼트 첫 프레임용 영어 이미지 프롬프트(제품 단독·어울리는 배경·글자 없음)\n` +
          `- seedancePrompt: Seedance 2.0용 영어 멀티컷 디렉팅. 한 줄 문자열로, 줄바꿈은 \\n, 내부 인용은 작은따옴표(')만 사용. 형식:\n` +
          `   "Style & Mood: ...\\nDynamic Description:\\nCUT 1 (0-2.5s) [shot size, angle, movement]: ...\\nCUT 2 (2.5-5s) [...]: ... (총 5~6컷, 타임코드 합 15초)\\nStatic Description: 배경/세팅(no other products, no clutter)\\nAudio: SFX + Korean VO: '나레이션'\\nTotal: 15s / N shots / ${ratio}"\n` +
          `- @product 의 제품 외형은 절대 변형 금지(keep the EXACT product). 다른 제품/잡동사니·이미지 위 글자 금지.\n` +
          '[출력 형식 — 매우 중요]\n' +
          '- 반드시 아래 JSON만 ```json 코드블록 안에 출력(설명·인사말 금지).\n' +
          '- 유효한 JSON 만: 모든 문자열의 줄바꿈은 \\n 으로, 문자열 내부의 따옴표는 작은따옴표(\')만 사용(큰따옴표 금지). 트레일링 콤마 금지.\n' +
          `{"title":"제목","format":"seedance-2.0","ratio":"${ratio}","structure":"${segments}x15s","product":${JSON.stringify(product.name)},"price":${JSON.stringify(product.price ? won(product.price) : '')},"scenes":[{"id":1,"role":"hook+design","durationSec":15,"sellingPoints":["..."],"narration":"...","captions":[{"at":"0:00","hook":"...","detail":"(...)"}],"refs":["@product"],"imagePrompt":"english first-frame prompt","seedancePrompt":"...멀티컷..."}]}`
        const r = await window.electronAPI.bridge.generateText(prompt)
        if (!r.ok || !r.text) {
          setMsg(r.message || 'ChatGPT 생성 실패 — 크롬에서 ChatGPT 로그인과 TB MTOOL 확장을 확인하세요.')
          setBusy(false)
          return
        }
        const data = extractScenesJson(r.text)
        if (!data) {
          // 최후 폴백: 느슨한 텍스트 파서로라도 나레이션/이미지 프롬프트만 살린다.
          const loose = parseScriptText(r.text)
          if (loose && loose.length) {
            result = loose.map((s, i) => ({ id: crypto.randomUUID(), index: i, narration: s.narration, imagePrompt: s.imagePrompt }))
            setScenes(result)
            setMsg(`대본 ${result.length}개 씬 생성 완료 (텍스트 폴백 — 일부 필드는 비어있을 수 있어요)`)
            setBusy(false)
            return
          }
          setMsg('응답 파싱 실패 — 다시 시도하거나, ChatGPT 응답을 복사해 우측 ‘대본 업로드’로 붙여넣어 보세요.')
          setBusy(false)
          return
        }
        result = data.scenes.map((raw, i) => {
          const s = raw as Record<string, unknown>
          const seedance = typeof s.seedancePrompt === 'string' ? s.seedancePrompt : ''
          const motion = typeof s.motionPrompt === 'string' ? s.motionPrompt : ''
          return {
            id: crypto.randomUUID(),
            index: i,
            narration: typeof s.narration === 'string' ? s.narration : '',
            imagePrompt: typeof s.imagePrompt === 'string' ? s.imagePrompt : '',
            motionPrompt: seedance || motion,
            seedancePrompt: seedance,
            captions: Array.isArray(s.captions) ? (s.captions as Scene['captions']) : undefined,
            role: typeof s.role === 'string' ? s.role : undefined,
            sellingPoints: Array.isArray(s.sellingPoints) ? (s.sellingPoints as string[]) : undefined
          }
        })
      } else {
        const status = await window.electronAPI.keys.getStatus()
        const provider: ScriptProvider | null = status.anthropic
          ? 'anthropic'
          : status.openai
            ? 'openai'
            : status.gemini
              ? 'gemini'
              : null
        if (!provider) {
          setMsg('설정에서 LLM API 키를 입력하거나 ChatGPT(확장) 방식을 쓰세요.')
          setBusy(false)
          return
        }
        setMsg(`대본 생성 중… (${provider})`)
        const opts: ProjectOptions = {
          topic,
          channelName: '',
          language: 'ko',
          aspect,
          sceneCount,
          scriptProvider: provider,
          ttsProvider: tts,
          ttsVoice: tts === 'elevenlabs' ? 'Rachel' : 'alloy',
          imageProvider: 'fal',
          imageStyle: 'product hero shot, clean studio lighting, e-commerce, high detail'
        }
        result = await window.electronAPI.generate.script(opts)
      }
      setScenes(result)
      setMsg(`대본 ${result.length}개 씬 생성 완료`)
    } catch (e) {
      setMsg('대본 생성 실패: ' + String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const openUpload = () => { setUploadText(''); setUploadErr(''); setUploadOpen(true) }
  const importScript = () => {
    const parsed = parseScriptText(uploadText)
    if (!parsed || !parsed.length) {
      setUploadErr('대본을 인식하지 못했어요. JSON({"scenes":[…]}) 또는 “씬 1 / 나레이션: / 이미지:” 형식으로 붙여넣어 주세요.')
      return
    }
    setScenes(parsed.map((s, i) => ({ id: crypto.randomUUID(), index: i, narration: s.narration, imagePrompt: s.imagePrompt })))
    setSceneIdx(0)
    setUploadOpen(false)
    setMsg(`대본 ${parsed.length}개 씬 불러옴 (업로드)`)
  }

  const clearProduct = () => {
    setProduct(emptyProduct)
    setScenes([])
    setFeatures('')
    setImgByScene({})
    setVidByScene({})
    setAnalyzing(false)
    setMsg('')
  }

  const updateScene = (id: string, patch: Partial<Scene>) =>
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const hasProduct = !!product.name.trim()
  const mediaSrc = (img: ImportedImage) => (port ? `http://127.0.0.1:${port}/media/${baseName(img.path)}` : '')

  // 선택된 참조 이미지 풀(비어있으면 전체 사용)
  const refPool = (): number[] => {
    const all = (product.images || []).map((_, i) => i)
    return refSel.size ? all.filter((i) => refSel.has(i)) : all
  }
  // 씬에 매칭할 제품 이미지 index 들 (모드별)
  const refIdxForScene = (s: Scene): number[] => {
    const pool = refPool()
    if (!pool.length) return []
    if (refMode === 'all') return pool
    if (refMode === 'one') return [pool[s.index % pool.length]]
    return (refPick[s.id] || []).filter((i) => pool.includes(i)) // pick
  }
  const isRefSel = (i: number) => (refSel.size ? refSel.has(i) : true)
  const toggleRef = (i: number) =>
    setRefSel((prev) => {
      const base = prev.size ? new Set(prev) : new Set((product.images || []).map((_, k) => k))
      base.has(i) ? base.delete(i) : base.add(i)
      return base
    })
  const togglePick = (sid: string, i: number) =>
    setRefPick((prev) => {
      const cur = new Set(prev[sid] || [])
      cur.has(i) ? cur.delete(i) : cur.add(i)
      return { ...prev, [sid]: [...cur].sort((a, b) => a - b) }
    })

  // 제품 특성 반영 모션 프롬프트(씬 motionPrompt 우선, 없으면 imagePrompt/상품명 기반 폴백)
  const motionFor = (s: Scene): string =>
    (s.motionPrompt && s.motionPrompt.trim()) ||
    `Slow cinematic orbit around the product "${product.name}": the camera smoothly arcs around the product while the product stays fixed and centered. Gentle parallax, no cuts, consistent 180-degree rule (camera stays on one side of the axis), product shape unchanged, premium product-ad look.`

  const markImg = (ids: string[], on: boolean) =>
    setBusyImg((prev) => {
      const n = new Set(prev)
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
      return n
    })
  const markVid = (ids: string[], on: boolean) =>
    setBusyVid((prev) => {
      const n = new Set(prev)
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
      return n
    })

  // 이미지: 대상 씬들을 Flow 한 배치로 생성. 씬별 참조 이미지를 @[pN] 토큰으로, 에셋과 함께 전달.
  const genImagesFor = async (targets: Scene[]) => {
    const list = targets.filter((s) => s.imagePrompt.trim())
    if (!list.length) {
      setMsg('이미지 프롬프트가 없습니다')
      return
    }
    markImg(list.map((s) => s.id), true)
    setMsg('제품 참조 이미지 준비 중…')
    // 씬별 토큰 프롬프트 + 사용된 이미지 index 수집
    const usedIdx = new Set<number>()
    const prompts = list.map((s) => {
      const idxs = refIdxForScene(s)
      idxs.forEach((i) => usedIdx.add(i))
      const tokens = idxs.map((i) => `@[p${i}]`).join(' ')
      return tokens ? `${tokens} ${s.imagePrompt}` : s.imagePrompt
    })
    // 사용된 이미지를 에셋(name p{index})으로 변환
    const assets: { name: string; dataUrl: string }[] = []
    for (const i of [...usedIdx]) {
      try {
        assets.push({ name: `p${i}`, dataUrl: await urlToDataUrl(product.images[i]) })
      } catch (e) {
        /* 변환 실패 무시 */
      }
    }
    imgQueue.current.push(...list.map((s) => s.id))
    setMsg(`Flow 이미지 ${list.length}장 생성 시작… (참조 ${assets.length}개) · 크롬 Flow 로그인 필요`)
    const r = await window.electronAPI.bridge.generateFlowBatch(prompts, assets, aspect)
    if (!r.ok) {
      imgQueue.current = imgQueue.current.filter((id) => !list.some((s) => s.id === id))
      markImg(list.map((s) => s.id), false)
      setMsg(r.message || 'Flow 배치 실패 — 크롬 Flow 로그인/확장 확인')
    }
  }
  const genAllImages = () => genImagesFor(scenes)
  const genOneImage = (s: Scene) => genImagesFor([s])

  // 씬에 이미지 직접 업로드 (붙여넣기/드롭/폴더) → 앱에 저장 후 그 씬 슬롯에 배정
  const uploadImageFor = async (sceneId: string, dataUrl: string, filename = 'upload.png') => {
    try {
      const img = await window.electronAPI.bridge.importImage({ source: 'other', dataUrl, filename })
      setImgByScene((prev) => ({ ...prev, [sceneId]: img }))
      setMsg('이미지 업로드 완료')
    } catch (e) {
      setMsg('이미지 업로드 실패: ' + String((e as Error)?.message || e))
    }
  }
  const pickFor = async (sceneId: string) => {
    const p = await window.electronAPI.fs.pickImage()
    if (!p) return
    const dataUrl = await window.electronAPI.fs.readImage(p)
    await uploadImageFor(sceneId, dataUrl, p.split(/[\\/]/).pop() || 'upload.png')
  }
  const removeImageFor = (sceneId: string) =>
    setImgByScene((prev) => {
      const n = { ...prev }
      delete n[sceneId]
      return n
    })
  const dropFor = async (sceneId: string, e: React.DragEvent) => {
    e.preventDefault()
    const internal = e.dataTransfer.getData('text/avs-dataurl')
    if (internal) {
      await uploadImageFor(sceneId, internal)
      return
    }
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
    if (f) await uploadImageFor(sceneId, await fileToDataUrl(f), f.name)
  }
  const pasteFor = async (sceneId: string, e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || [])
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) {
          e.preventDefault()
          await uploadImageFor(sceneId, await fileToDataUrl(f), 'paste.png')
          return
        }
      }
    }
  }

  // 영상: 이미지가 있는 씬들을 그록으로 i2v. 모션은 씬별 motionPrompt.
  const genVideosFor = async (targets: Scene[]) => {
    const list = targets.filter((s) => imgByScene[s.id])
    if (!list.length) {
      setMsg('먼저 이미지를 생성하세요')
      return
    }
    markVid(list.map((s) => s.id), true)
    const engineName = vidEngine === 'runway' ? 'SEEDANCE 2.0' : 'Grok'
    setMsg(`${engineName}으로 영상 ${list.length}편 생성 시작… 크롬 로그인 필요 (시간이 걸립니다)`)
    const ratio = aspect === '16:9' ? '16:9' : '9:16' // Runway Seedance 는 9:16/16:9
    for (const s of list) {
      let dataUrl = ''
      try {
        dataUrl = await urlToDataUrl(mediaSrc(imgByScene[s.id]))
      } catch (e) {
        markVid([s.id], false)
        continue
      }
      vidQueue.current.push(s.id)
      const p =
        vidEngine === 'runway'
          ? window.electronAPI.bridge.generateRunway(motionFor(s), dataUrl, { aspect: ratio, duration: vidDuration })
          : window.electronAPI.bridge.generateVideo(motionFor(s), dataUrl, { aspect, duration: vidDuration, resolution: vidRes })
      p.then((r) => {
        if (!r.ok) {
          vidQueue.current = vidQueue.current.filter((id) => id !== s.id)
          markVid([s.id], false)
          setMsg(r.message || '일부 영상 생성 실패')
        }
      }).catch(() => {})
    }
  }
  const genAllVideos = () => genVideosFor(scenes)
  const genOneVideo = (s: Scene) => genVideosFor([s])

  const stopGen = async () => {
    await window.electronAPI.bridge.cancel()
    imgQueue.current = []
    vidQueue.current = []
    setBusyImg(new Set())
    setBusyVid(new Set())
    setMsg('생성 정지')
  }

  // ── 분석된 상품 카드 (상품분석 탭 우측) ──
  const productCard = (
    <div>
      <div className="igen-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShoppingBag size={14} /> 분석된 상품
        {hasProduct && (
          <button className="igen-act danger" style={{ marginLeft: 'auto' }} onClick={clearProduct} title="분석된 상품/대본 비우기">
            <Trash2 size={13} /> 비우기
          </button>
        )}
      </div>
      {!hasProduct ? (
        <div className="igen-empty" style={{ marginTop: 10 }}>왼쪽에 쿠팡 URL을 넣고 분석하세요</div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12 }}>
            {product.images[0] ? (
              <img src={product.images[0]} alt="" style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, flex: '0 0 auto' }} />
            ) : (
              <div style={{ width: 92, height: 92, borderRadius: 10, background: 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                <ShoppingBag size={26} opacity={0.4} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.35 }}>{product.name}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#ff5b5b' }}>{won(product.price)}</span>
                {product.discount ? <span style={{ fontSize: 12, color: '#ff5b5b', fontWeight: 700 }}>{product.discount}%</span> : null}
                {product.originalPrice ? (
                  <span style={{ fontSize: 12, opacity: 0.5, textDecoration: 'line-through' }}>{won(product.originalPrice)}</span>
                ) : null}
              </div>
              {product.rating != null && (
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Star size={12} fill="#ffc83d" stroke="#ffc83d" /> {product.rating}
                  {product.reviewCount != null && <span style={{ opacity: 0.6 }}>· 리뷰 {product.reviewCount.toLocaleString()}</span>}
                </div>
              )}
            </div>
          </div>

          {product.images.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {product.images.slice(1, 8).map((src, i) => (
                <img key={i} src={src} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </div>
          )}

          {!!(product.attributes && product.attributes.length) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
              {product.attributes!.map((a, i) => (
                <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgba(52,106,255,0.15)', color: '#9db8ff' }}>
                  {a.label} {a.value}{a.percent != null ? ` ${a.percent}%` : ''}
                </span>
              ))}
            </div>
          )}

          {!!(product.reviews && product.reviews.length) && (
            <div style={{ marginTop: 16 }}>
              <div className="igen-label">상품평 ({product.reviews!.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {product.reviews!.filter((r) => r.body || r.title).slice(0, 5).map((r, i) => (
                  <div key={i} style={{ fontSize: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <Star size={11} fill="#ffc83d" stroke="#ffc83d" />
                      <span style={{ fontWeight: 700 }}>{r.rating ?? '-'}</span>
                      {r.title && <span style={{ opacity: 0.85 }}>· {r.title}</span>}
                      {r.date && <span style={{ opacity: 0.4, marginLeft: 'auto', fontSize: 10 }}>{r.date}</span>}
                    </div>
                    {r.body && (
                      <div style={{ opacity: 0.7, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {r.body}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>※ 대본 생성 시 평점 높은 후기를 근거로 반영합니다</div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 단계 탭 바 */}
      <div style={{ display: 'flex', gap: 6, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map(({ id, label, Icon }, i) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 13px',
              borderRadius: 9,
              whiteSpace: 'nowrap',
              border: '1px solid ' + (tab === id ? '#346aff' : 'rgba(255,255,255,0.1)'),
              background: tab === id ? '#346aff' : 'transparent',
              color: tab === id ? '#fff' : '#c9ccd6',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700
            }}
          >
            <span style={{ opacity: 0.55, fontSize: 11 }}>{i + 1}</span>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, minHeight: 0 }}>
        {/* ── 상품분석 ── */}
        {tab === 'product' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* ① URL */}
              <div style={SECTION}>
                <StepHead n={1} done={hasProduct}>쿠팡 상품 URL</StepHead>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="igen-textarea"
                    style={{ flex: 1, height: 42, resize: 'none', whiteSpace: 'nowrap', overflow: 'hidden' }}
                    placeholder="https://www.coupang.com/vp/products/…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') analyze() }}
                  />
                  <button
                    className="igen-go"
                    style={{ width: 'auto', marginTop: 0, flex: '0 0 auto', padding: '0 18px', opacity: isCoupangUrl(url) ? 1 : 0.5 }}
                    onClick={analyze}
                    title={isCoupangUrl(url) ? '크롬에서 상품 페이지 열기' : '올바른 쿠팡 상품 URL을 입력하세요'}
                  >
                    {analyzing ? <><Loader2 size={15} className="igen-spin" /> 대기 중</> : <><ExternalLink size={15} /> 분석</>}
                  </button>
                </div>
                <p style={{ margin: '9px 0 0', fontSize: 11, color: analyzing ? '#9db8ff' : '#8b90a0', lineHeight: 1.5 }}>
                  {analyzing
                    ? '크롬에서 상품 페이지 우하단 "📥 앱으로 상품 보내기"를 누르면 자동으로 채워집니다.'
                    : 'URL을 붙여넣고 Enter 또는 분석을 누르세요.'}
                </p>
              </div>

              {/* ② 상품 정보 */}
              <div style={SECTION}>
                <StepHead n={2} done={hasProduct} extra={<span style={{ fontSize: 10.5, fontWeight: 600, color: '#7a8090' }}>자동 채움 · 수정 가능</span>}>상품 정보</StepHead>
                <input className="igen-textarea" style={{ height: 40, resize: 'none' }} placeholder="상품명" value={product.name} onChange={(e) => setP({ name: e.target.value })} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      className="igen-textarea"
                      style={{ height: 40, resize: 'none', width: '100%', boxSizing: 'border-box', paddingRight: 30, textAlign: 'right' }}
                      placeholder="가격"
                      inputMode="numeric"
                      value={fmtNum(product.price)}
                      onChange={(e) => setP({ price: parseNum(e.target.value) })}
                    />
                    <span style={SUFFIX}>원</span>
                  </div>
                  <div style={{ position: 'relative', flex: '0 0 116px' }}>
                    <input
                      className="igen-textarea"
                      style={{ height: 40, resize: 'none', width: '100%', boxSizing: 'border-box', paddingRight: 28, textAlign: 'right' }}
                      placeholder="할인율"
                      inputMode="numeric"
                      value={product.discount ?? ''}
                      onChange={(e) => setP({ discount: parseNum(e.target.value) })}
                    />
                    <span style={SUFFIX}>%</span>
                  </div>
                </div>
                <textarea
                  className="igen-textarea"
                  style={{ marginTop: 8 }}
                  rows={3}
                  placeholder="핵심 특징 (쉼표로 구분) — 예) 무선, 노이즈캔슬링, 30시간 재생"
                  value={features}
                  onChange={(e) => setFeatures(e.target.value)}
                />
                <p style={{ margin: '7px 0 0', fontSize: 11, color: '#8b90a0', lineHeight: 1.5 }}>
                  핵심 특징은 대본의 매력 포인트로 쓰입니다. 비워두면 상품명·후기에서 자동 추론합니다.
                </p>
              </div>

              {/* ③ 제휴 링크 */}
              <div style={SECTION}>
                <StepHead n={3} done={!!(partnersLink || inpockLink)}>
                  제휴 링크 <Link2 size={12} style={{ verticalAlign: 'middle', opacity: 0.6 }} />
                </StepHead>
                <input
                  className="igen-textarea"
                  style={{ height: 40, resize: 'none' }}
                  placeholder="쿠팡파트너스 제휴링크 (https://link.coupang.com/…)"
                  value={partnersLink}
                  onChange={(e) => setPartnersLink(e.target.value)}
                />
                <input
                  className="igen-textarea"
                  style={{ height: 40, resize: 'none', marginTop: 8 }}
                  placeholder="인포크링크 (선택)"
                  value={inpockLink}
                  onChange={(e) => setInpockLink(e.target.value)}
                />
              </div>

              <p className="igen-note" style={{ marginTop: 0 }}>
                <Megaphone size={12} style={{ verticalAlign: 'middle' }} /> 분석은 크롬 확장(coupang.js)이 내 브라우저에서 직접 읽어 차단 없이 가져옵니다.
              </p>
            </div>
            {productCard}
          </div>
        )}

        {/* ── 대본생성 ── */}
        {tab === 'script' &&
          (!hasProduct ? (
            <div className="igen-empty">먼저 ‘상품분석’ 탭에서 상품을 분석/입력하세요</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 22, alignItems: 'start' }}>
              <div style={CARD}>
                <Seg
                  label="대본 생성 방식"
                  value={scriptSource}
                  onChange={setScriptSource}
                  options={[
                    { v: 'chatgpt', label: 'ChatGPT (확장)', title: 'API 키 불필요' },
                    { v: 'api', label: 'API 키', title: '설정의 LLM API 키 사용' }
                  ]}
                />
                <Seg label="길이" value={duration} onChange={setDuration} options={DURATIONS.map((d) => ({ v: d.v, label: d.label }))} />
                <Seg label="톤" value={tone} onChange={setTone} options={TONES.map((t) => ({ v: t.v, label: t.label }))} />
                <Seg
                  label="인물 표현"
                  hint="(이미지 프롬프트)"
                  value={peopleMode}
                  onChange={setPeopleMode}
                  options={[
                    { v: 'product', label: '제품만', title: '순수 제품샷만' },
                    { v: 'hands', label: '손·사용컷', title: '손·사용장면 허용, 얼굴 없음 (추천)' },
                    { v: 'free', label: '자유', title: '인물 연출 허용' }
                  ]}
                />
                <button style={ctaStyle(busy)} onClick={genScript} disabled={busy}>
                  {busy ? <><Loader2 size={16} className="igen-spin" /> 생성 중…</> : <><Wand2 size={16} /> 대본 생성</>}
                </button>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div className="igen-label" style={{ margin: 0 }}>
                    {scenes.length ? `생성된 대본 (${scenes.length}씬) · 직접 검수·수정` : '생성된 대본'}
                  </div>
                  <button className="igen-act" style={{ marginLeft: 'auto' }} onClick={openUpload} title="외부에서 작성한 대본을 붙여넣어 불러오기">
                    <Upload size={13} /> 대본 업로드
                  </button>
                </div>
                {scenes.length === 0 ? (
                  <div className="igen-empty" style={{ flex: 'none', padding: '30px 20px' }}>왼쪽에서 대본을 생성하거나, ‘대본 업로드’로 붙여넣으세요</div>
                ) : (
                  (() => {
                    const cur = Math.min(sceneIdx, scenes.length - 1)
                    const s = scenes[cur]
                    return (
                      <>
                        {/* 씬 서브탭 */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' }}>
                          {scenes.map((sc, i) => (
                            <button
                              key={sc.id}
                              onClick={() => setSceneIdx(i)}
                              style={{
                                padding: '7px 14px',
                                borderRadius: 9,
                                border: '1px solid ' + (i === cur ? '#346aff' : 'rgba(255,255,255,0.1)'),
                                background: i === cur ? 'linear-gradient(180deg,#5b93ff,#346aff)' : 'transparent',
                                color: i === cur ? '#fff' : '#aab0c0',
                                cursor: 'pointer',
                                fontSize: 13,
                                fontWeight: 700,
                                boxShadow: i === cur ? '0 3px 10px rgba(52,106,255,0.4)' : 'none'
                              }}
                            >
                              씬 {i + 1}
                            </button>
                          ))}
                        </div>
                        {/* 활성 씬 편집 */}
                        <div style={CARD}>
                          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 800 }}>씬 {cur + 1}</span>
                            <button
                              onClick={() => {
                                setScenes((prev) => prev.filter((x) => x.id !== s.id))
                                setSceneIdx(Math.max(0, cur - 1))
                              }}
                              title="이 씬 삭제"
                              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ff7a7a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                            >
                              <Trash2 size={13} /> 삭제
                            </button>
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#8b90a0', marginBottom: 6 }}>나레이션</div>
                          <AutoTextarea
                            value={s.narration}
                            placeholder="나레이션"
                            onChange={(e) => updateScene(s.id, { narration: e.target.value })}
                            style={{ fontSize: 14, minHeight: 70 }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 6px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#8b90a0' }}>이미지 프롬프트 (첫 프레임, 영어)</span>
                            <CopyBtn text={s.imagePrompt} />
                          </div>
                          <AutoTextarea
                            value={s.imagePrompt}
                            placeholder="이미지 프롬프트 (영어)"
                            onChange={(e) => updateScene(s.id, { imagePrompt: e.target.value })}
                            style={{ fontSize: 12.5, minHeight: 90, opacity: 0.9 }}
                          />
                          {!!s.captions?.length && (
                            <div style={{ margin: '14px 0 6px' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#8b90a0', marginBottom: 4 }}>자막</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {s.captions.map((c, ci) => (
                                  <div key={ci} style={{ fontSize: 12 }}>
                                    <span style={{ opacity: 0.5 }}>{c.at}</span> <b>{c.hook}</b>
                                    {c.detail && <span style={{ opacity: 0.6 }}> {c.detail}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 6px' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#8b90a0' }}>Seedance 프롬프트 (멀티컷, 영어)</span>
                            <CopyBtn text={s.seedancePrompt || ''} />
                          </div>
                          <AutoTextarea
                            value={s.seedancePrompt || ''}
                            placeholder="Seedance 멀티컷 디렉팅 (Style/Dynamic CUT/Static/Audio/Total)"
                            onChange={(e) => updateScene(s.id, { seedancePrompt: e.target.value, motionPrompt: e.target.value })}
                            style={{ fontSize: 11.5, minHeight: 120, opacity: 0.85 }}
                          />
                        </div>
                      </>
                    )
                  })()
                )}
              </div>
            </div>
          ))}

        {/* ── 이미지생성 ── */}
        {tab === 'image' &&
          (scenes.length === 0 ? (
            <div className="igen-empty">먼저 ‘대본생성’ 탭에서 대본을 만드세요</div>
          ) : (
            <div>
              <div style={TOOLBAR}>
                <span style={TB_LABEL}>화면 비율</span>
                <SegInline value={aspect} onChange={(v) => setAspect(v as AspectRatio)} options={[{ v: '9:16', label: '9:16' }, { v: '1:1', label: '1:1' }, { v: '16:9', label: '16:9' }]} />
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button style={smallCta(busyImg.size > 0)} onClick={genAllImages} disabled={busyImg.size > 0}>
                    <Film size={14} /> 전체 이미지 생성
                  </button>
                  {busyImg.size > 0 && <button style={stopBtn} onClick={stopGen}>정지</button>}
                </div>
              </div>
              {/* 참조 이미지 매칭 */}
              {product.images.length > 0 && (
                <div style={{ ...SECTION, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={TB_LABEL}>참조 매칭</span>
                    <SegInline value={refMode} onChange={setRefMode} options={[{ v: 'all', label: '전체' }, { v: 'one', label: '1:1' }, { v: 'pick', label: '선택' }]} />
                    <span style={{ fontSize: 11, opacity: 0.5 }}>
                      {refMode === 'all' ? '선택한 이미지를 모든 씬에 참조' : refMode === 'one' ? '씬 순서대로 이미지 1장씩 매칭' : '씬마다 아래에서 참조 이미지 선택'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {product.images.map((src, i) => {
                      const on = isRefSel(i)
                      return (
                        <div
                          key={i}
                          onClick={() => toggleRef(i)}
                          title={on ? '풀에서 제외' : '풀에 포함'}
                          style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, outline: on ? '2px solid #5b93ff' : '2px solid transparent', opacity: on ? 1 : 0.35 }}
                        >
                          <img src={src} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                          <span style={{ position: 'absolute', left: 3, bottom: 3, fontSize: 9, fontWeight: 700, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 4px', borderRadius: 4 }}>p{i}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <p className="igen-note">씬별로 <b>생성(AI)</b> 하거나 <b>직접 업로드</b>(클릭=폴더 / 드래그&드롭 / 붙여넣기). 영상은 이 이미지를 바탕으로 만듭니다.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16, marginTop: 12 }}>
                {scenes.map((s, i) => {
                  const img = imgByScene[s.id]
                  const busy = busyImg.has(s.id)
                  return (
                    <div key={s.id} style={{ ...SECTION, padding: 12 }}>
                      <div
                        className="ss-drop"
                        tabIndex={0}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => dropFor(s.id, e)}
                        onPaste={(e) => pasteFor(s.id, e)}
                        onClick={() => (img ? window.electronAPI.fs.openPath(img.path) : pickFor(s.id))}
                        title={img ? '클릭=원본 열기' : '클릭=폴더에서 선택 · 드롭/붙여넣기 가능'}
                        style={{ aspectRatio: '9 / 16', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center', position: 'relative', cursor: 'pointer' }}
                      >
                        {img ? (
                          <img src={mediaSrc(img)} alt="" title={img.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : busy ? (
                          <Loader2 size={22} className="igen-spin" />
                        ) : (
                          <div style={{ textAlign: 'center', opacity: 0.5, fontSize: 12, lineHeight: 1.6, padding: 12 }}>
                            <ImageIcon size={26} style={{ opacity: 0.6 }} />
                            <div style={{ marginTop: 6 }}>클릭 · 드롭 · 붙여넣기</div>
                            <div style={{ fontSize: 11, opacity: 0.7 }}>또는 아래 ‘생성’</div>
                          </div>
                        )}
                        {img && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeImageFor(s.id) }}
                            title="이미지 제거"
                            style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'grid', placeItems: 'center', padding: 0 }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>씬 {i + 1}</span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          <button style={tileBtn(busy)} onClick={(e) => { e.stopPropagation(); genOneImage(s) }} disabled={busy}>
                            {busy ? '생성 중' : img ? '다시' : '생성'}
                          </button>
                          <button style={tileBtn(false)} onClick={(e) => { e.stopPropagation(); pickFor(s.id) }} title="폴더에서 이미지 선택">
                            업로드
                          </button>
                        </div>
                      </div>
                      {/* 선택 모드: 씬별 참조 이미지 칩 */}
                      {refMode === 'pick' && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                          {refPool().map((i2) => {
                            const picked = (refPick[s.id] || []).includes(i2)
                            return (
                              <div
                                key={i2}
                                onClick={() => togglePick(s.id, i2)}
                                title={`p${i2}`}
                                style={{ cursor: 'pointer', borderRadius: 6, outline: picked ? '2px solid #5b93ff' : '2px solid transparent', opacity: picked ? 1 : 0.4 }}
                              >
                                <img src={product.images[i2]} alt="" style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

        {/* ── 영상생성 ── */}
        {tab === 'video' &&
          (scenes.length === 0 ? (
            <div className="igen-empty">먼저 ‘대본생성/이미지생성’을 진행하세요</div>
          ) : (
            <div>
              <div style={TOOLBAR}>
                <span style={TB_LABEL}>엔진</span>
                <SegInline
                  value={vidEngine}
                  onChange={(e) => { setVidEngine(e); setVidDuration(e === 'runway' ? '10' : '6') }}
                  options={[{ v: 'grok', label: 'Grok' }, { v: 'runway', label: 'SEEDANCE 2.0' }]}
                />
                <span style={{ ...TB_LABEL, marginLeft: 6 }}>길이</span>
                <SegInline value={vidDuration} onChange={setVidDuration} options={(vidEngine === 'runway' ? RUNWAY_DURATIONS : VID_DURATIONS).map((d) => ({ v: d.v, label: d.label }))} />
                {vidEngine === 'grok' && (
                  <>
                    <span style={{ ...TB_LABEL, marginLeft: 6 }}>화질</span>
                    <SegInline value={vidRes} onChange={setVidRes} options={VID_RES.map((r) => ({ v: r.v, label: r.label }))} />
                  </>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button style={smallCta(busyVid.size > 0)} onClick={genAllVideos} disabled={busyVid.size > 0}>
                    <Video size={14} /> 전체 영상 생성
                  </button>
                  {busyVid.size > 0 && <button style={stopBtn} onClick={stopGen}>정지</button>}
                </div>
              </div>
              <p className="igen-note" style={{ marginTop: 0 }}>
                {vidEngine === 'runway'
                  ? 'SEEDANCE 2.0 i2v (비율 9:16/16:9, 화면비율은 이미지 탭 설정 따름). 크롬에서 Runway 로그인 필요.'
                  : '이미지가 있는 씬을 그록 i2v로 영상화(씬별 모션). 시간이 걸리고 개별 재생성 가능.'}
                {' '}탭은 뒤에서 열립니다.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16, marginTop: 12 }}>
                {scenes.map((s, i) => {
                  const vid = vidByScene[s.id]
                  const img = imgByScene[s.id]
                  const busy = busyVid.has(s.id)
                  return (
                    <div key={s.id} style={SECTION}>
                      <div style={{ aspectRatio: '9 / 16', borderRadius: 8, overflow: 'hidden', background: '#000', display: 'grid', placeItems: 'center', position: 'relative' }}>
                        {vid ? (
                          <video src={mediaSrc(vid)} muted loop playsInline preload="metadata" title={vid.filename} onClick={() => window.electronAPI.fs.openPath(vid.path)} onMouseOver={(e) => e.currentTarget.play().catch(() => {})} onMouseOut={(e) => e.currentTarget.pause()} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
                        ) : busy ? (
                          <Loader2 size={18} className="igen-spin" />
                        ) : img ? (
                          <img src={mediaSrc(img)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
                        ) : (
                          <span style={{ fontSize: 11, opacity: 0.4 }}>이미지 먼저</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>씬 {i + 1}</span>
                        <button style={tileBtn(busy || !img)} onClick={() => genOneVideo(s)} disabled={busy || !img}>
                          {busy ? '생성 중' : vid ? '다시' : '생성'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

        {/* ── 오디오생성 ── */}
        {tab === 'audio' && (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            {/* 왼쪽: 통합 나레이션 (편집 가능) */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>나레이션 대본 (전체 통합 · 편집 가능)</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setNarrationText(buildNarration())}
                    title="씬 대사를 다시 불러와 통합(현재 내용 덮어씀)"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 7, color: '#cfd3dd', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 11px' }}
                  >
                    <FileText size={13} /> 씬 대사 불러오기
                  </button>
                  <CopyBtn text={narrationText} />
                </div>
              </div>
              <AutoTextarea
                value={narrationText}
                onChange={(e) => setNarrationText(e.target.value)}
                placeholder="씬 대사가 문장 단위로 통합됩니다. 자유롭게 수정하세요."
                style={{ minHeight: 420, fontSize: 13.5, lineHeight: 1.9 }}
              />
              <p className="igen-note" style={{ marginTop: 6 }}>
                {narrationText.replace(/\s/g, '').length}자 · {narrationText.split('\n').filter((l) => l.trim()).length}문장 — 이 텍스트를 한 번에 나레이션 음성으로 생성합니다.
              </p>
            </div>
            {/* 오른쪽: 엔진 + 생성 */}
            <div style={{ width: 300, flex: '0 0 300px' }}>
              <div className="igen-label">나레이션 엔진</div>
              <div className="igen-ratios">
                <button className={`igen-ratio ${tts === 'openai' ? 'active' : ''}`} onClick={() => setTts('openai')}>OpenAI TTS</button>
                <button className={`igen-ratio ${tts === 'elevenlabs' ? 'active' : ''}`} onClick={() => setTts('elevenlabs')}>ElevenLabs</button>
                <button className="igen-ratio" disabled title="브라우저 무료 TTS — 추가 예정" style={{ opacity: 0.45 }}>무료 (예정)</button>
              </div>
              <Soon icon={<Music size={30} />} title="오디오(나레이션) 생성" desc="왼쪽 통합 대본을 위 엔진으로 음성 생성합니다." />
            </div>
          </div>
        )}

        {/* ── 영상편집 ── */}
        {tab === 'edit' && <Soon icon={<Scissors size={30} />} title="영상 편집 / 스크롤영상 합성" desc="이미지·영상·나레이션·자막을 스크롤영상으로 합성합니다." />}

        {/* ── 영상업로드 ── */}
        {tab === 'upload' && <Soon icon={<Upload size={30} />} title="영상 업로드" desc="유튜브 / X / 인스타 / 스레드에 제휴링크와 함께 업로드합니다." />}
      </div>

      {/* 상태바 */}
      {msg && (
        <div style={{ flexShrink: 0, padding: '9px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12.5, color: msg.includes('완료') ? '#7ee0a0' : '#cfd3dd' }}>
          {msg}
        </div>
      )}

      {/* 대본 업로드 모달 */}
      {uploadOpen && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setUploadOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', display: 'grid', placeItems: 'center', padding: 24 }}
        >
          <div style={{ width: 'min(680px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: '#181b22', border: '1px solid #2c313c', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 18px', borderBottom: '1px solid #2c313c' }}>
              <Upload size={16} />
              <span style={{ fontSize: 14, fontWeight: 800 }}>대본 업로드</span>
              <button onClick={() => setUploadOpen(false)} title="닫기" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#9aa3b2', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 18, overflowY: 'auto' }}>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9aa3b2', lineHeight: 1.6 }}>
                ChatGPT 등에서 받은 대본을 그대로 붙여넣으세요. <b style={{ color: '#cfd3dd' }}>JSON</b>(<code>{'{"scenes":[…]}'}</code>) ·
                <b style={{ color: '#cfd3dd' }}> 씬/나레이션/이미지 라벨</b> · <b style={{ color: '#cfd3dd' }}>번호 목록</b> · <b style={{ color: '#cfd3dd' }}>문단</b> 형식을 자동 인식합니다.
              </p>
              <textarea
                className="igen-textarea"
                autoFocus
                rows={12}
                style={{ minHeight: 220, fontSize: 13, lineHeight: 1.5, fontFamily: 'ui-monospace, Menlo, monospace' }}
                placeholder={'예) 붙여넣기\n\n씬 1\n나레이션: 첫 멘트입니다\n이미지: a product on a clean desk\n\n씬 2\n나레이션: 둘째 멘트\n이미지: closeup shot\n\n— 또는 —\n\n{"scenes":[{"narration":"...","imagePrompt":"..."}]}'}
                value={uploadText}
                onChange={(e) => { setUploadText(e.target.value); if (uploadErr) setUploadErr('') }}
              />
              {uploadErr && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#ff7a7a', lineHeight: 1.5 }}>{uploadErr}</p>}
              {!uploadErr && uploadText.trim() && (() => {
                const preview = parseScriptText(uploadText)
                return (
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: preview ? '#7ee0a0' : '#9aa3b2' }}>
                    {preview ? `✓ ${preview.length}개 씬으로 인식됨` : '아직 인식 가능한 형식이 아니에요'}
                  </p>
                )
              })()}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid #2c313c' }}>
              <button className="igen-act" onClick={() => setUploadOpen(false)}>취소</button>
              <button className="igen-go" style={{ width: 'auto', marginTop: 0, padding: '0 20px', height: 40, opacity: uploadText.trim() ? 1 : 0.5 }} onClick={importScript}>
                <FileText size={15} /> 불러오기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
