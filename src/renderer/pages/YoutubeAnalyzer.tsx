import { useEffect, useRef, useState } from 'react'
import { Search, RotateCcw, Loader2, Users, X, ExternalLink } from 'lucide-react'
import type { YoutubeVideo, YoutubeChannelAnalysis } from '@shared/types'

const MAX_OPTS = [20, 50, 100, 150, 200]
const DAYS_OPTS = [
  { v: 1, label: '1일' },
  { v: 7, label: '7일' },
  { v: 30, label: '30일' },
  { v: 90, label: '90일' },
  { v: 365, label: '1년' }
]
const REGIONS = ['KR', 'US', 'JP', 'GB', 'DE', 'FR', 'IN', 'BR']
const ORDER_OPTS = [
  { v: 'viewCount', label: '조회수순' },
  { v: 'relevance', label: '관련도순' },
  { v: 'date', label: '최신순' }
] as const
// 검색어가 채널(URL/@핸들/채널ID)을 가리키는지 — 백엔드 detectChannel 과 동일 기준
const isChannelInput = (s: string): boolean => {
  const t = (s || '').trim()
  return /youtube\.com\/(channel|c|user)\//i.test(t) || /(?:youtube\.com\/)?@[\w.\-가-힣]+/i.test(t) || /^UC[\w-]{20,}$/.test(t)
}

const won = (n: number): string => {
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억'
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만'
  return n.toLocaleString('ko-KR')
}
const dur = (s: number): string => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0')
}
const dateFmt = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}
const CII_COLOR: Record<string, string> = { Great: '#3ecf8e', Good: '#ffc83d', Bad: '#ff6b6b' }
const CII_LABEL: Record<string, string> = { Great: '좋음', Good: '보통', Bad: '나쁨' }
const rev = (r: { min: number; max: number } | null): string => (r ? '₩' + won(r.min) + '~' + won(r.max) : '-')
const gradeColor = (g: string): string => (g.startsWith('S') ? '#ffd24a' : g.startsWith('A') ? '#3ecf8e' : g.startsWith('B') ? '#5b93ff' : g.startsWith('C') ? '#ffb648' : '#ff6b6b')
// 현지 언어 스크립트 (제목/채널에 이 문자가 있어야 그 나라 영상으로 간주)
const LOCAL_SCRIPT: Record<string, RegExp> = {
  KR: /[가-힣]/,
  JP: /[ぁ-んァ-ヶ぀-ゟ゠-ヿ]/
}

type SortKey = 'views' | 'subscribers' | 'publishedAt' | 'durationSec' | 'likes' | 'comments' | 'subViewRatio' | 'likeRate' | 'estRevenue'

export default function YoutubeAnalyzer() {
  const [query, setQuery] = useState('')
  const [max, setMax] = useState(100)
  const [days, setDays] = useState(7)
  const [region, setRegion] = useState('KR')
  const [order, setOrder] = useState<'relevance' | 'viewCount' | 'date'>('viewCount')
  const [items, setItems] = useState<YoutubeVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [searchedChannel, setSearchedChannel] = useState(false) // 직전 검색이 채널 검색이었나
  const [msg, setMsg] = useState('')
  const [quota, setQuota] = useState<number | null>(null) // 세션 누적 API 사용량
  // 채널 상세 분석
  const [channel, setChannel] = useState<YoutubeChannelAnalysis | null>(null)
  const [chLoading, setChLoading] = useState('') // 로딩 중 채널명/식별자(빈문자=닫힘)

  // 필터
  const [typeF, setTypeF] = useState<'all' | 'shorts' | 'long'>('shorts')
  const [ciiF, setCiiF] = useState<Set<string>>(new Set(['Great', 'Good']))
  const [viewMin, setViewMin] = useState('')
  const [viewMax, setViewMax] = useState('')
  const [subMin, setSubMin] = useState('')
  const [subMax, setSubMax] = useState('')
  const [localOnly, setLocalOnly] = useState(true) // 현지 언어 영상만
  // 숫자 범위(조회수/구독자)는 '적용'(또는 Enter) 눌러야 반영 — 입력칸과 분리
  const [rngApplied, setRngApplied] = useState({ vMin: '', vMax: '', sMin: '', sMax: '' })
  const [sortKey, setSortKey] = useState<SortKey>('publishedAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const search = async (override?: string): Promise<void> => {
    const term = (override ?? query).trim()
    if (!term) {
      setMsg('검색어를 입력하세요')
      return
    }
    if (override !== undefined && override !== query) setQuery(override)
    const asChannel = isChannelInput(term)
    setLoading(true)
    setMsg(asChannel ? '채널 검색 중…' : '검색 중…')
    const r = await window.electronAPI.youtube.search({ query: term, max, days, region, order })
    setLoading(false)
    if (!r.ok) {
      setMsg(r.message || '검색 실패 (설정에서 YouTube API 키 확인)')
      return
    }
    setSearchedChannel(asChannel)
    setItems(r.items || [])
    if (r.quotaUsed != null) setQuota(r.quotaUsed)
    setMsg(`${asChannel ? '채널 영상' : '결과'} ${(r.items || []).length}개 수집`)
  }

  // 채널명 클릭 → 그 채널 영상만 아래 목록으로 불러오기 (채널ID 우선)
  const loadChannelVideos = (v: YoutubeVideo): void => {
    const ident = v.channelId || (v.channel?.startsWith('@') ? v.channel : '')
    if (!ident) { setMsg('채널 식별자를 찾지 못했어요'); return }
    void search(ident)
  }

  // 채널 상세 분석 모달 열기 (채널ID 우선, 없으면 채널명/핸들)
  const openChannel = async (v: YoutubeVideo): Promise<void> => {
    const ident = v.channelId || v.channel
    if (!ident) return
    setChannel(null)
    setChLoading(v.channel || ident)
    const r = await window.electronAPI.youtube.analyzeChannel({ channel: ident, max: 50 })
    setChLoading('')
    if (!r.ok || !r.analysis) {
      setMsg(r.message || '채널 분석 실패')
      return
    }
    setChannel(r.analysis)
    setQuota(r.analysis.quotaUsed)
  }

  const toggleCii = (c: string) =>
    setCiiF((prev) => {
      const n = new Set(prev)
      n.has(c) ? n.delete(c) : n.add(c)
      return n
    })
  const applyRanges = () => setRngApplied({ vMin: viewMin, vMax: viewMax, sMin: subMin, sMax: subMax })
  const resetFilters = () => {
    setTypeF('shorts')
    setCiiF(new Set(['Great', 'Good']))
    setViewMin('')
    setViewMax('')
    setSubMin('')
    setSubMax('')
    setRngApplied({ vMin: '', vMax: '', sMin: '', sMax: '' })
  }
  const num = (s: string) => (s ? parseInt(s.replace(/[^\d]/g, ''), 10) : null)

  const filtered = items.filter((v) => {
    // 채널 검색이면 그 채널 영상을 모두 보여준다(타입·CII·언어 필터 무시) — 채널 점검 목적
    if (!searchedChannel) {
      if (typeF !== 'all' && v.type !== typeF) return false
      if (!ciiF.has(v.cii)) return false
      if (localOnly) {
        const re = LOCAL_SCRIPT[region]
        if (re && !re.test(v.title) && !re.test(v.channel)) return false
      }
    }
    const vmin = num(rngApplied.vMin)
    const vmax = num(rngApplied.vMax)
    if (vmin != null && v.views < vmin) return false
    if (vmax != null && v.views > vmax) return false
    const smin = num(rngApplied.sMin)
    const smax = num(rngApplied.sMax)
    if (smin != null && v.subscribers < smin) return false
    if (smax != null && v.subscribers > smax) return false
    return true
  })
  const valOf = (v: YoutubeVideo): number => (sortKey === 'estRevenue' ? v.estRevenue?.max ?? -1 : ((v[sortKey] as number) ?? -1))
  const sorted = [...filtered].sort((a, b) => {
    const cmp = sortKey === 'publishedAt' ? String(a.publishedAt).localeCompare(String(b.publishedAt)) : valOf(a) - valOf(b)
    return sortDir === 'desc' ? -cmp : cmp
  })

  // 필터 투명성: 몇 개가 가려졌고 어떤 필터가 켜졌나
  const hidden = items.length - sorted.length
  const activeFilters: string[] = []
  if (!searchedChannel && typeF !== 'all') activeFilters.push(typeF === 'shorts' ? '쇼츠' : '롱폼')
  if (!searchedChannel && ciiF.size > 0 && ciiF.size < 3) activeFilters.push('CII ' + (['Great', 'Good', 'Bad'] as const).filter((c) => ciiF.has(c)).map((c) => CII_LABEL[c]).join('/'))
  if (!searchedChannel && localOnly && LOCAL_SCRIPT[region]) activeFilters.push(region === 'KR' ? '한국어만' : '현지어만')
  if (num(rngApplied.vMin) != null || num(rngApplied.vMax) != null) activeFilters.push('조회수')
  if (num(rngApplied.sMin) != null || num(rngApplied.sMax) != null) activeFilters.push('구독자')

  // 입력칸 값이 아직 '적용'되지 않았으면 적용 버튼 강조
  const rangeDirty = viewMin !== rngApplied.vMin || viewMax !== rngApplied.vMax || subMin !== rngApplied.sMin || subMax !== rngApplied.sMax

  const sortBtn = (key: SortKey) => () => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '')

  // 가로 스크롤 편의: 스페이스+드래그 패닝, Alt+휠 좌우 이동
  const scrollRef = useRef<HTMLDivElement>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const drag = useRef<{ x: number; left: number } | null>(null)
  const panned = useRef(false) // 패닝 중 이동이 있었나 (직후 클릭 차단용)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const isField = (el: Element | null) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(document.activeElement)) { setSpaceDown(true); e.preventDefault() }
    }
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => { if (e.altKey) { el.scrollLeft += e.deltaY; e.preventDefault() } }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const onPanDown = (e: React.MouseEvent) => {
    if (!spaceDown || !scrollRef.current) return
    drag.current = { x: e.clientX, left: scrollRef.current.scrollLeft }
    panned.current = false
    setDragging(true)
    e.preventDefault()
  }
  const onPanMove = (e: React.MouseEvent) => {
    if (!drag.current || !scrollRef.current) return
    panned.current = true
    scrollRef.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
  }
  const endPan = () => { drag.current = null; setDragging(false) }
  // 패닝(또는 스페이스 누른 상태)에서의 클릭은 행 onClick(URL 열기) 으로 전파되지 않게 차단
  const onPanClickCapture = (e: React.MouseEvent) => {
    if (spaceDown || panned.current) {
      e.preventDefault()
      e.stopPropagation()
      panned.current = false
    }
  }

  // ── 스타일 ───────────────────────────────────────────────────────────
  const th: React.CSSProperties = { padding: '10px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#aab0c0', whiteSpace: 'nowrap', cursor: 'pointer', position: 'sticky', top: 0, background: '#13151c', borderRight: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.12)' }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.05)', borderRight: '1px solid rgba(255,255,255,0.04)' }
  const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
  const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
  const selC: React.CSSProperties = { background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 7, color: '#f4f5f7', padding: '6px 8px', fontSize: 12 }
  const numC: React.CSSProperties = { ...selC, width: 60 }
  const iLbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#8b90a0', whiteSpace: 'nowrap' }
  // 기능 그룹 사이 얇은 세로 구분선
  const sepStyle: React.CSSProperties = { width: 1, alignSelf: 'stretch', minHeight: 20, background: 'rgba(255,255,255,0.1)', flex: '0 0 auto' }
  const Sep = () => <div style={sepStyle} />

  // 라벨 + 컨트롤을 한 줄로 (인라인)
  const inlineField = (label: string, control: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={iLbl}>{label}</span>
      {control}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── 헤더: 1행 검색+수집 / 2행 필터 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {/* 1행: 검색 + 수집 옵션 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 280px', maxWidth: 460 }}>
            <input style={{ ...selC, flex: 1, padding: '8px 10px', fontSize: 13 }} placeholder="키워드 또는 채널 URL/@핸들" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <button onClick={() => search()} disabled={loading} className="yt-btn" style={{ flex: '0 0 auto', padding: '8px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#5b93ff,#346aff)', color: '#fff', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {loading ? <Loader2 size={15} className="igen-spin" /> : <Search size={15} />} 검색
            </button>
            {isChannelInput(query) && (
              <span style={{ fontSize: 11, color: '#c08bff', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Users size={12} /> 채널
              </span>
            )}
          </div>
          <Sep />
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            {inlineField('수량', <select style={selC} value={max} onChange={(e) => setMax(Number(e.target.value))}>{MAX_OPTS.map((n) => <option key={n} value={n}>{n}</option>)}</select>)}
            {inlineField('정렬', <select style={selC} value={order} onChange={(e) => setOrder(e.target.value as 'relevance' | 'viewCount' | 'date')}>{ORDER_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>)}
            {inlineField('기간', <select style={selC} value={days} onChange={(e) => setDays(Number(e.target.value))}>{DAYS_OPTS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}</select>)}
            {inlineField('국가', <select style={selC} value={region} onChange={(e) => setRegion(e.target.value)}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>)}
          </div>
          {quota != null && (
            <div
              style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.35, cursor: 'help' }}
              title={'YouTube API 일일 한도 10,000유닛(태평양시 자정 리셋, 한국시간 오후 4~5시경).\n이 숫자는 앱 세션 누적 추정치라 앱을 끄면 0으로 초기화됩니다 — 구글의 실제 사용량은 아닙니다.\n키워드 검색 100 / 채널 분석 ~5 유닛.'}
            >
              <span style={{ fontSize: 11, color: quota > 8000 ? '#ff6b6b' : '#6b7180', whiteSpace: 'nowrap' }}>
                세션 API ~{quota.toLocaleString()} · 일일 10,000{quota > 8000 ? ' · 임박' : ''}
              </span>
              <span style={{ fontSize: 10, color: '#5a5f6b', whiteSpace: 'nowrap' }}>매일 오후 4~5시경 초기화</span>
            </div>
          )}
        </div>

        {/* 2행: 필터 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: '#6b7180' }}>필터</span>
          {inlineField('타입', (
            <select style={selC} value={typeF} onChange={(e) => setTypeF(e.target.value as 'all' | 'shorts' | 'long')}>
              <option value="all">전체</option>
              <option value="shorts">쇼츠</option>
              <option value="long">롱폼</option>
            </select>
          ))}
          <Sep />
          {inlineField('CII', (
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              {(['Great', 'Good', 'Bad'] as const).map((c) => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: CII_COLOR[c] }}>
                  <input type="checkbox" checked={ciiF.has(c)} onChange={() => toggleCii(c)} /> {CII_LABEL[c]}
                </label>
              ))}
            </div>
          ))}
          <Sep />
          {inlineField('조회수', (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input style={numC} placeholder="최소" value={viewMin} onChange={(e) => setViewMin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyRanges()} />
              <span style={{ opacity: 0.4 }}>~</span>
              <input style={numC} placeholder="최대" value={viewMax} onChange={(e) => setViewMax(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyRanges()} />
            </div>
          ))}
          {inlineField('구독자', (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input style={numC} placeholder="최소" value={subMin} onChange={(e) => setSubMin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyRanges()} />
              <span style={{ opacity: 0.4 }}>~</span>
              <input style={numC} placeholder="최대" value={subMax} onChange={(e) => setSubMax(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyRanges()} />
            </div>
          ))}
          {LOCAL_SCRIPT[region] && (
            <>
              <Sep />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} /> 현지어만
              </label>
            </>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {rangeDirty && <span style={{ fontSize: 11, color: '#ffc83d' }}>적용 안 된 값 있음</span>}
            <button onClick={applyRanges} className="yt-btn" title="조회수/구독자 범위 적용" style={{ padding: '7px 16px', borderRadius: 7, border: rangeDirty ? '1px solid #6affb0' : 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#3ecf8e,#2bb277)', color: '#06281c', fontWeight: 800, fontSize: 12, boxShadow: rangeDirty ? '0 0 0 3px rgba(62,207,142,0.25)' : 'none' }}>✓ 적용</button>
            <button onClick={resetFilters} className="yt-btn yt-btn-ghost" title="필터 초기화" style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'transparent', color: '#cfd3dd', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><RotateCcw size={13} /> 초기화</button>
          </div>
        </div>
      </div>

      {/* ── 결과 정보줄 ── */}
      <div style={{ padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800 }}>결과 {sorted.length}개</span>
        {items.length > 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>(전체 {items.length})</span>}
        {hidden > 0 && <span style={{ fontSize: 12, color: '#ffb648' }}>· 필터로 {hidden}개 숨김{activeFilters.length ? ` (${activeFilters.join(' · ')})` : ''}</span>}
        {items.length > 0 && sorted.length <= 3 && hidden > 0 && (
          <span style={{ fontSize: 11.5, color: '#8b90a0' }}>— CII 보통/나쁨도 켜거나 타입을 전체로, 기간을 늘려보세요</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7180' }}>Space+드래그 · Alt+휠 = 좌우 이동</span>
        {msg && <span style={{ fontSize: 12.5, opacity: 0.7 }}>{msg}</span>}
      </div>

      {/* ── 결과 테이블 (전체폭 · 가로스크롤 · 패닝) ── */}
      <div
        ref={scrollRef}
        onMouseDown={onPanDown}
        onMouseMove={onPanMove}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onClickCapture={onPanClickCapture}
        style={{ flex: 1, overflow: 'auto', cursor: spaceDown ? (dragging ? 'grabbing' : 'grab') : 'default', userSelect: dragging ? 'none' : 'auto' }}
      >
        {sorted.length === 0 ? (
          <div className="igen-empty" style={{ margin: 30 }}>{loading ? '검색 중…' : '상단에서 키워드로 검색하세요'}</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1200 }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>썸네일</th>
                <th style={{ ...th, cursor: 'default' }}>제목</th>
                <th style={{ ...th, cursor: 'default' }}>채널</th>
                <th style={thNum} onClick={sortBtn('views')}>조회수{arrow('views')}</th>
                <th style={thNum} onClick={sortBtn('subscribers')}>구독자{arrow('subscribers')}</th>
                <th style={th} onClick={sortBtn('publishedAt')}>날짜{arrow('publishedAt')}</th>
                <th style={thNum} onClick={sortBtn('durationSec')}>길이{arrow('durationSec')}</th>
                <th style={thNum} onClick={sortBtn('likes')}>좋아요{arrow('likes')}</th>
                <th style={thNum} onClick={sortBtn('comments')}>댓글{arrow('comments')}</th>
                <th style={thNum} onClick={sortBtn('subViewRatio')} title="구독자 대비 조회수 배수 — 높을수록 구독자보다 조회가 많이 터진 영상(바이럴)">조회배수{arrow('subViewRatio')}</th>
                <th style={thNum} onClick={sortBtn('likeRate')}>좋아요율{arrow('likeRate')}</th>
                <th style={thNum} onClick={sortBtn('estRevenue')}>예상수익{arrow('estRevenue')}</th>
                <th style={{ ...th, cursor: 'default' }}>CII</th>
                <th style={{ ...th, cursor: 'default' }}>타입</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v, i) => (
                <tr key={v.id} className="yt-row" style={{ cursor: 'pointer', background: i % 2 ? 'rgba(255,255,255,0.022)' : 'transparent' }} onClick={() => window.electronAPI.fs.openExternal(v.url)}>
                  <td style={{ ...tdNum, opacity: 0.5 }}>{i + 1}</td>
                  <td style={td}>{v.thumbnail ? <img src={v.thumbnail} alt="" style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 4 }} /> : null}</td>
                  <td style={{ ...td, maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.title}>{v.title}</td>
                  <td style={{ ...td, maxWidth: 190 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); loadChannelVideos(v) }}
                        title="이 채널 영상만 보기"
                        style={{ background: 'none', border: 'none', padding: 0, color: '#7fb0ff', cursor: 'pointer', font: 'inherit', textAlign: 'left', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textDecoration: 'underline', textUnderlineOffset: 2 }}
                      >
                        {v.channel}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openChannel(v) }}
                        title="채널 상세 분석(등급·수익)"
                        style={{ flex: '0 0 auto', background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 5, color: '#aab0c0', cursor: 'pointer', fontSize: 10.5, padding: '2px 6px', lineHeight: 1.4 }}
                      >
                        분석
                      </button>
                    </div>
                  </td>
                  <td style={tdNum}>{won(v.views)}</td>
                  <td style={tdNum}>{won(v.subscribers)}</td>
                  <td style={{ ...td, opacity: 0.8 }}>{dateFmt(v.publishedAt)}</td>
                  <td style={tdNum}>{dur(v.durationSec)}</td>
                  <td style={tdNum}>{v.likes != null ? won(v.likes) : 'N/A'}</td>
                  <td style={tdNum}>{v.comments != null ? won(v.comments) : 'N/A'}</td>
                  <td
                    style={{ ...tdNum, fontWeight: 700, color: v.subViewRatio == null ? '#6b7180' : v.subViewRatio >= 10 ? '#3ecf8e' : v.subViewRatio >= 3 ? '#ffc83d' : '#aab0c0' }}
                    title={v.subViewRatio != null ? `구독자 대비 조회수 ${v.subViewRatio}배 (${v.subViewRatio >= 10 ? '바이럴' : v.subViewRatio >= 3 ? '양호' : '보통'})` : ''}
                  >
                    {v.subViewRatio != null ? '×' + v.subViewRatio : 'N/A'}
                  </td>
                  <td style={tdNum}>{v.likeRate != null ? v.likeRate + '%' : 'N/A'}</td>
                  <td style={{ ...tdNum, color: '#9fe0b8' }}>{rev(v.estRevenue)}</td>
                  <td style={{ ...td, fontWeight: 800, color: CII_COLOR[v.cii] }}>{CII_LABEL[v.cii]}</td>
                  <td style={{ ...td, color: v.type === 'shorts' ? '#c08bff' : '#6fb3ff' }}>{v.type === 'shorts' ? '쇼츠' : '롱폼'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 채널 상세 분석 오버레이 */}
      {(chLoading || channel) && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setChannel(null); setChLoading('') } }}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', display: 'grid', placeItems: 'center', padding: 24 }}
        >
          <div style={{ width: 'min(920px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#13151c', border: '1px solid #2a2e3a', borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
            {chLoading && !channel ? (
              <div style={{ padding: 60, textAlign: 'center', color: '#aab0c0' }}>
                <Loader2 size={28} className="igen-spin" />
                <div style={{ marginTop: 12, fontSize: 14 }}>{chLoading} 채널 분석 중…</div>
              </div>
            ) : channel ? (() => {
              const c = channel
              const bd = c.rating.breakdown
              const bars: { label: string; v: number; max: number }[] = [
                { label: '구독자', v: bd.subscriber, max: 25 },
                { label: '조회수', v: bd.view, max: 25 },
                { label: '참여도', v: bd.engagement, max: 25 },
                { label: '일관성', v: bd.consistency, max: 15 },
                { label: '성장성', v: bd.growth, max: 10 }
              ]
              const card: React.CSSProperties = { background: '#1a1d26', border: '1px solid #262b36', borderRadius: 12, padding: 14 }
              const metric = (label: string, value: string, color = '#e6e9ef') => (
                <div>
                  <div style={{ fontSize: 11, color: '#8b90a0' }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
                </div>
              )
              return (
                <>
                  {/* 헤더 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderBottom: '1px solid #262b36' }}>
                    {c.thumbnail ? <img src={c.thumbnail} alt="" style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover' }} /> : null}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                      <div style={{ fontSize: 12, color: '#8b90a0', marginTop: 2 }}>
                        {c.handle ? c.handle + ' · ' : ''}구독자 {won(c.subscribers)} · 총 {won(c.totalViews)}회 · 영상 {c.videoCount.toLocaleString()}개 · {dateFmt(c.publishedAt)} 개설
                      </div>
                    </div>
                    <button onClick={() => window.electronAPI.fs.openExternal('https://www.youtube.com/channel/' + c.channelId)} title="유튜브에서 채널 열기" style={{ marginLeft: 'auto', background: '#262b36', border: 'none', borderRadius: 8, color: '#cfd3dd', cursor: 'pointer', padding: '7px 11px', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700 }}>
                      <ExternalLink size={13} /> 채널 열기
                    </button>
                    <button onClick={() => { setChannel(null); setChLoading('') }} title="닫기" style={{ background: 'none', border: 'none', color: '#9aa3b2', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}><X size={20} /></button>
                  </div>

                  {/* 본문 */}
                  <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* 등급 + 수익 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
                          <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: gradeColor(c.rating.grade) }}>{c.rating.grade}</div>
                          <div style={{ fontSize: 12, color: '#8b90a0', marginTop: 4 }}>{c.rating.score}/100점</div>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {bars.map((b) => (
                            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 11, color: '#8b90a0', width: 40, flex: '0 0 auto' }}>{b.label}</span>
                              <div style={{ flex: 1, height: 7, background: '#262b36', borderRadius: 999, overflow: 'hidden' }}>
                                <div style={{ width: Math.round((b.v / b.max) * 100) + '%', height: '100%', background: gradeColor(c.rating.grade) }} />
                              </div>
                              <span style={{ fontSize: 11, color: '#aab0c0', width: 42, textAlign: 'right', flex: '0 0 auto' }}>{b.v}/{b.max}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#9fe0b8' }}>💰 예상 수익 (분석 영상 기준)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          {metric('월 예상', rev(c.revenue.monthly), '#9fe0b8')}
                          {metric('연 예상', rev(c.revenue.yearly), '#9fe0b8')}
                          {metric('영상당 평균', rev(c.revenue.perVideoAvg))}
                          {metric('최근 30일 업로드', c.upload.perMonth + '개')}
                        </div>
                        <div style={{ fontSize: 10.5, color: '#6b7180' }}>※ 카테고리별 RPM 추정치 — 실제와 다를 수 있습니다.</div>
                      </div>
                    </div>

                    {/* 참여 + 업로드 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: '#7fb0ff' }}>📊 참여 지표</div>
                        {metric('평균 좋아요율', c.engagement.avgLikeRate + '%')}
                        {metric('평균 댓글율', c.engagement.avgCommentRate + '%')}
                        {metric('영상당 평균 조회', won(c.engagement.avgViewsPerVideo))}
                        {metric('구독자 대비 조회', c.engagement.subViewRate + '%')}
                      </div>
                      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 800, color: '#c08bff' }}>📅 업로드 패턴</div>
                        {metric('최근 7일', c.upload.perWeek + '개')}
                        {metric('최근 30일', c.upload.perMonth + '개')}
                        {metric('주로 올리는 요일', c.upload.mostActiveDay + '요일')}
                        {metric('최근 업로드', dateFmt(c.upload.lastUpload))}
                      </div>
                    </div>

                    {/* 최근 영상 */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#cfd3dd', margin: '4px 0 8px' }}>최근 영상 {c.videos.length}개</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {c.videos.slice(0, 20).map((v) => (
                          <div key={v.id} onClick={() => window.electronAPI.fs.openExternal(v.url)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#1a1d26', border: '1px solid #262b36', borderRadius: 9, cursor: 'pointer' }}>
                            {v.thumbnail ? <img src={v.thumbnail} alt="" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 4, flex: '0 0 auto' }} /> : null}
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title}</span>
                            <span style={{ fontSize: 11.5, color: '#aab0c0', flex: '0 0 auto' }}>{won(v.views)}회</span>
                            <span style={{ fontSize: 11, color: '#6b7180', flex: '0 0 70px', textAlign: 'right' }}>{dateFmt(v.publishedAt)}</span>
                            <span style={{ fontSize: 11, color: '#9fe0b8', flex: '0 0 90px', textAlign: 'right' }}>{rev(v.estRevenue)}</span>
                            <span style={{ fontSize: 11, color: v.type === 'shorts' ? '#c08bff' : '#6fb3ff', flex: '0 0 30px', textAlign: 'right' }}>{v.type === 'shorts' ? '쇼츠' : '롱폼'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )
            })() : null}
          </div>
        </div>
      )}
    </div>
  )
}
