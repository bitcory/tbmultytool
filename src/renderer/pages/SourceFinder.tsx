import { useEffect, useState } from 'react'
import { Search, Loader2, Download, ExternalLink, Link as LinkIcon, Heart, Film } from 'lucide-react'
import type { XhsCard } from '@shared/types'

const DAYS_OPTS = [
  { v: 0, label: '전체' },
  { v: 7, label: '7일' },
  { v: 30, label: '30일' },
  { v: 90, label: '90일' }
]
const LIMIT_OPTS = [20, 50, 100, 200]
const SORTS = [
  { v: 'hot' as const, label: '인기순' },
  { v: 'like' as const, label: '좋아요순' },
  { v: 'time' as const, label: '최신순' }
]
const won = (n: number): string => (n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만' : n.toLocaleString('ko-KR'))

export default function SourceFinder() {
  const [keyword, setKeyword] = useState('')
  const [days, setDays] = useState(90)
  const [limit, setLimit] = useState(100)
  const [sort, setSort] = useState<'hot' | 'like' | 'time'>('hot')
  const [cards, setCards] = useState<XhsCard[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set()) // 다운로드 중 noteId
  const [linkUrl, setLinkUrl] = useState('')

  // 확장 스크래퍼가 보낸 검색결과 수신
  useEffect(() => {
    const off = window.electronAPI.xhs.onResults((incoming) => {
      setCards(incoming)
      setLoading(false)
      setMsg(incoming.length ? `${incoming.length}개 수집` : '결과 없음 — 로그인 여부·검색어를 확인하세요')
    })
    return off
  }, [])
  // 확장 진행/오류 메시지 (로그인 필요 등)
  useEffect(() => {
    const off = window.electronAPI.bridge.onProgress((m: string) => {
      setMsg(m)
      if (/로그인|실패|오류|필요|취소/.test(m)) setLoading(false)
    })
    return off
  }, [])

  const search = async () => {
    if (!keyword.trim()) { setMsg('검색어를 입력하세요'); return }
    setLoading(true)
    setCards([])
    setMsg('크롬 샤오홍슈에서 검색·수집 중… (로그인 필요, 탭은 뒤에서 열립니다)')
    const r = await window.electronAPI.xhs.search({ keyword: keyword.trim(), days, limit, sort })
    if (!r.ok) { setLoading(false); setMsg(r.message || '검색 실패') }
  }

  const mark = (id: string, on: boolean) =>
    setBusy((p) => { const n = new Set(p); on ? n.add(id) : n.delete(id); return n })

  const download = async (url: string, id: string) => {
    mark(id, true)
    setMsg('다운로드 중…')
    const r = await window.electronAPI.xhs.download(url)
    mark(id, false)
    setMsg(r.ok ? `갤러리에 저장됨 (${r.saved}개)` : r.message || '다운로드 실패')
  }

  const importLink = async () => {
    const u = linkUrl.trim()
    if (!/xiaohongshu\.com|xhslink/.test(u)) { setMsg('샤오홍슈 노트 링크를 붙여넣으세요'); return }
    mark('link', true)
    setMsg('링크에서 미디어 가져오는 중…')
    const r = await window.electronAPI.xhs.download(u)
    mark('link', false)
    setMsg(r.ok ? `갤러리에 저장됨 (${r.saved}개)` : r.message || '가져오기 실패')
  }

  const sorted = [...cards].sort((a, b) => (sort === 'like' ? b.likes - a.likes : 0))

  const selC: React.CSSProperties = { background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 7, color: '#f4f5f7', padding: '6px 8px', fontSize: 12 }
  const iLbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#8b90a0', whiteSpace: 'nowrap' }
  const inline = (label: string, ctrl: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={iLbl}>{label}</span>{ctrl}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 14 }}>
            <span style={{ background: '#ff2442', color: '#fff', fontSize: 11, fontWeight: 800, borderRadius: 5, padding: '2px 6px' }}>샤오홍슈</span> 소스찾기
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 280px', maxWidth: 460 }}>
            <input style={{ ...selC, flex: 1, padding: '8px 10px', fontSize: 13 }} placeholder="검색어 (예: 隔音墙, breakfast, 인테리어)" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <button onClick={search} disabled={loading} className="yt-btn" style={{ padding: '8px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#ff5470,#ff2442)', color: '#fff', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {loading ? <Loader2 size={15} className="igen-spin" /> : <Search size={15} />} 검색
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {inline('기간', <select style={selC} value={days} onChange={(e) => setDays(Number(e.target.value))}>{DAYS_OPTS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}</select>)}
            {inline('개수', <select style={selC} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{LIMIT_OPTS.map((n) => <option key={n} value={n}>{n}</option>)}</select>)}
          </div>
        </div>
        {/* 링크로 바로 가져오기 (확장 없이 동작) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <LinkIcon size={13} style={{ color: '#8b90a0' }} />
          <input style={{ ...selC, flex: '1 1 auto', maxWidth: 560 }} placeholder="노트 공유링크 붙여넣기 → 영상/이미지 바로 다운로드" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && importLink()} />
          <button onClick={importLink} disabled={busy.has('link')} className="yt-btn yt-btn-ghost" style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cfd3dd', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {busy.has('link') ? <Loader2 size={13} className="igen-spin" /> : <Download size={13} />} 링크 가져오기
          </button>
        </div>
      </div>

      {/* 정렬 + 상태 */}
      <div style={{ padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {SORTS.map((s) => (
          <button key={s.v} onClick={() => setSort(s.v)} className="yt-btn" style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid ' + (sort === s.v ? 'transparent' : 'rgba(255,255,255,0.12)'), background: sort === s.v ? '#ff2442' : 'transparent', color: sort === s.v ? '#fff' : '#cfd3dd', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{s.label}</button>
        ))}
        <span style={{ fontSize: 11.5, color: '#8b90a0' }}>💡 검색은 <b>확장이 깔린 크롬에서 샤오홍슈 로그인 탭을 열어둔 채</b> 하면 새 창 없이 그 탭을 재사용해요</span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, opacity: 0.7 }}>{msg}</span>
      </div>

      {/* 그리드 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {sorted.length === 0 ? (
          <div className="igen-empty" style={{ margin: 30 }}>
            {loading ? '수집 중…' : '검색어로 검색하거나, 노트 링크를 붙여넣어 가져오세요'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {sorted.map((c) => (
              <div key={c.noteId} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#0c0e14' }}>
                  {c.cover ? <img src={c.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {c.type === 'video' ? <><Film size={11} /> 영상{c.duration ? ' ' + c.duration : ''}</> : '이미지'}
                  </span>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={c.title}>{c.title || '(제목 없음)'}</div>
                  <div style={{ fontSize: 11.5, color: '#8b90a0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#ff6b8a' }}><Heart size={11} /> {won(c.likes)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.author}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                    <button onClick={() => download(c.url, c.noteId)} disabled={busy.has(c.noteId)} className="yt-btn" style={{ flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#ff5470,#ff2442)', color: '#fff', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      {busy.has(c.noteId) ? <Loader2 size={12} className="igen-spin" /> : <Download size={12} />} 다운로드
                    </button>
                    <button onClick={() => window.electronAPI.fs.openExternal(c.url)} title="샤오홍슈에서 열기" className="yt-btn yt-btn-ghost" style={{ flex: '0 0 auto', padding: '6px 9px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cfd3dd', cursor: 'pointer' }}>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
