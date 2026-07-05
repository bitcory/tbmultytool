import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2, Copy, Check, ExternalLink, FileText, RotateCcw } from 'lucide-react'
import type { YoutubeTranscriptResult } from '@shared/types'

// 초 → m:ss (1시간 이상이면 h:mm:ss)
const ts = (sec: number): string => {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export default function ScriptAnalyzer() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<YoutubeTranscriptResult | null>(null)
  const [withTime, setWithTime] = useState(false) // 오른쪽 텍스트에 타임스탬프 포함
  const [text, setText] = useState('') // 오른쪽 텍스트창 (편집 가능)
  const [copied, setCopied] = useState(false)
  // 플레이어 — 임베드는 봇 차단 네트워크에서 막히므로 yt-dlp 로 로컬에 받아 재생
  const [videoSrc, setVideoSrc] = useState('')
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [videoErr, setVideoErr] = useState('')
  const videoIdRef = useRef('') // 같은 영상 중복 다운로드 방지

  const loadVideo = async (r: YoutubeTranscriptResult): Promise<void> => {
    videoIdRef.current = r.videoId
    setVideoState('loading')
    setVideoErr('')
    setVideoSrc('')
    const [info, v] = await Promise.all([window.electronAPI.bridge.getInfo(), window.electronAPI.youtube.video(r.url)])
    if (videoIdRef.current !== r.videoId) return // 그 사이 다른 영상 조회됨
    if (!v.ok || !v.file) {
      setVideoState('error')
      setVideoErr(v.message || '영상을 불러오지 못했어요')
      return
    }
    setVideoSrc(`http://127.0.0.1:${info.port}/media/${encodeURIComponent(v.file)}`)
    setVideoState('ready')
  }

  // 새 영상 스크립트를 가져오면 플레이어도 로드 (언어 전환 등 같은 영상이면 유지)
  useEffect(() => {
    if (!result) return
    if (videoIdRef.current === result.videoId) return
    void loadVideo(result)
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTranscript = async (lang?: string): Promise<void> => {
    const u = url.trim()
    if (!u) {
      setMsg('유튜브 영상 URL을 입력하세요')
      return
    }
    setLoading(true)
    setMsg(lang ? '언어 변경 중…' : '스크립트 가져오는 중…')
    const r = await window.electronAPI.youtube.transcript({ url: u, lang })
    setLoading(false)
    if (!r.ok || !r.result) {
      setMsg(r.message || '스크립트를 가져오지 못했어요')
      return
    }
    setResult(r.result)
    setMsg(`문장 ${r.result.segments.length}개 추출 완료`)
  }

  // 추출 결과/타임스탬프 옵션이 바뀌면 오른쪽 텍스트 재구성 (이후 사용자가 자유롭게 편집)
  useEffect(() => {
    if (!result) return
    setText(result.segments.map((s) => (withTime ? `[${ts(s.start)}] ${s.text}` : s.text)).join('\n'))
  }, [result, withTime])

  const copyAll = async (): Promise<void> => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const charCount = useMemo(() => text.replace(/\s/g, '').length, [text])

  // ── 스타일 (YoutubeAnalyzer 와 동일 톤) ─────────────────────
  const selC: React.CSSProperties = { background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 7, color: '#f4f5f7', padding: '6px 8px', fontSize: 12 }
  const card: React.CSSProperties = { background: '#1a1d26', border: '1px solid #262b36', borderRadius: 12 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── 헤더: URL 입력 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13, color: '#cfd3dd' }}>
          <FileText size={15} /> 스크립트 분석기
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 320px', maxWidth: 560 }}>
          <input
            style={{ ...selC, flex: 1, padding: '8px 10px', fontSize: 13 }}
            placeholder="유튜브 영상 URL (watch?v= / youtu.be / shorts)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchTranscript()}
          />
          <button
            onClick={() => fetchTranscript()}
            disabled={loading}
            className="yt-btn"
            style={{ flex: '0 0 auto', padding: '8px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#5b93ff,#346aff)', color: '#fff', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            {loading ? <Loader2 size={15} className="igen-spin" /> : <Search size={15} />} 가져오기
          </button>
        </div>
        {result && result.tracks.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#8b90a0' }}>언어</span>
            <select style={selC} value={result.lang} onChange={(e) => fetchTranscript(e.target.value)}>
              {result.tracks.map((t) => (
                <option key={t.lang + (t.auto ? ':a' : '')} value={t.lang}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {msg && <span style={{ fontSize: 12.5, opacity: 0.7 }}>{msg}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7180' }}>API 키·할당량 불필요</span>
      </div>

      {/* ── 영상 정보줄 ── */}
      {result && (
        <div style={{ padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <img src={`https://i.ytimg.com/vi/${result.videoId}/default.jpg`} alt="" style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 4 }} />
          <span style={{ fontWeight: 800, fontSize: 13, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={result.title}>
            {result.title || result.videoId}
          </span>
          {result.channel && <span style={{ fontSize: 12, color: '#8b90a0' }}>{result.channel}</span>}
          <button
            onClick={() => window.electronAPI.fs.openExternal(result.url)}
            title="유튜브에서 열기"
            style={{ background: 'none', border: 'none', color: '#7fb0ff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: 0 }}
          >
            <ExternalLink size={13} /> 열기
          </button>
        </div>
      )}

      {/* ── 본문: 좌 타임라인 / 우 복사용 텍스트 ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 14, padding: 14 }}>
        {/* 좌: 영상 플레이어 (로컬 캐시 재생) */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #262b36', fontSize: 12, fontWeight: 800, color: '#aab0c0' }}>
            영상 {result ? `· 문장 ${result.segments.length}개` : ''}
          </div>
          {videoState === 'ready' && videoSrc ? (
            <video key={videoSrc} src={videoSrc} controls style={{ flex: 1, minHeight: 0, width: '100%', background: '#000', objectFit: 'contain' }} />
          ) : videoState === 'loading' ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#aab0c0' }}>
              <div style={{ textAlign: 'center' }}>
                <Loader2 size={26} className="igen-spin" />
                <div style={{ marginTop: 10, fontSize: 13 }}>영상 준비 중…</div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#6b7180' }}>처음 여는 영상은 다운로드 때문에 수 초~수십 초 걸려요</div>
              </div>
            </div>
          ) : videoState === 'error' ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#aab0c0', padding: 20 }}>
              <div style={{ textAlign: 'center', maxWidth: 380 }}>
                <div style={{ fontSize: 13, color: '#ff8b8b', lineHeight: 1.6 }}>{videoErr}</div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {result && (
                    <button
                      onClick={() => loadVideo(result)}
                      className="yt-btn"
                      style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'transparent', color: '#cfd3dd', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <RotateCcw size={13} /> 다시 시도
                    </button>
                  )}
                  {result && (
                    <button
                      onClick={() => window.electronAPI.fs.openExternal(result.url)}
                      className="yt-btn"
                      style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#5b93ff,#346aff)', color: '#fff', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <ExternalLink size={13} /> 유튜브에서 열기
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="igen-empty" style={{ margin: 24 }}>
              {loading ? '가져오는 중…' : '상단에 유튜브 URL을 넣고 가져오기를 누르세요'}
            </div>
          )}
        </div>

        {/* 우: 복사용 텍스트창 */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #262b36', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#aab0c0' }}>텍스트 (편집 가능)</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: '#cfd3dd' }}>
              <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} /> 타임스탬프 포함
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6b7180' }}>{text ? `${charCount.toLocaleString()}자` : ''}</span>
            <button
              onClick={copyAll}
              disabled={!text}
              className="yt-btn"
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: text ? 'pointer' : 'default', background: copied ? 'linear-gradient(180deg,#3ecf8e,#2bb277)' : 'linear-gradient(180deg,#5b93ff,#346aff)', color: copied ? '#06281c' : '#fff', fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, opacity: text ? 1 : 0.4 }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? '복사됨' : '전체 복사'}
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="스크립트를 가져오면 여기에 복사·붙여넣기 가능한 텍스트가 표시됩니다"
            spellCheck={false}
            style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', color: '#e6e9ef', padding: 14, fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit' }}
          />
        </div>
      </div>
    </div>
  )
}
