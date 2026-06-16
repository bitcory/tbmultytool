import { useEffect, useRef, useState } from 'react'
import { Music, Sparkles, Loader2, Square, Trash2 } from 'lucide-react'
import type { ImportedImage, SunoMode } from '@shared/types'
import { usePersistedForm, isToday } from '../persist'

const isAudioPath = (p: string) => /\.(mp3|wav)$/i.test(p)

function TrackRow({ track, port, onDelete }: { track: ImportedImage; port: number; onDelete: () => void }) {
  const name = track.path.split(/[\\/]/).pop() || ''
  const src = port ? `http://127.0.0.1:${port}/media/${name}` : ''
  return (
    <div className="mgen-track">
      <audio controls src={src} style={{ flex: 1, height: 36 }} />
      <button className="igen-act danger" onClick={onDelete} title="삭제">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

export default function MusicGen() {
  const [mode, setMode] = useState<SunoMode>('simple')
  const [description, setDescription] = useState('')
  const [instrumental, setInstrumental] = useState(false)
  const [style, setStyle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [title, setTitle] = useState('')
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [tracks, setTracks] = useState<ImportedImage[]>([])
  const [port, setPort] = useState(0)
  const pendingCount = useRef(0)

  // 입력 폼 영구 저장 (모드·설명·가사·스타일 등) — 페이지 이동 후에도 유지
  usePersistedForm(
    'musicgen',
    { mode, description, instrumental, style, lyrics, title },
    (v) => {
      if (v.mode) setMode(v.mode as SunoMode)
      if (typeof v.description === 'string') setDescription(v.description)
      if (typeof v.instrumental === 'boolean') setInstrumental(v.instrumental)
      if (typeof v.style === 'string') setStyle(v.style)
      if (typeof v.lyrics === 'string') setLyrics(v.lyrics)
      if (typeof v.title === 'string') setTitle(v.title)
    }
  )

  // 갤러리(디스크)를 신뢰 소스로 "오늘 생성한 음악"만 표시.
  useEffect(() => {
    window.electronAPI.bridge.getInfo().then((i) => setPort(i.port)).catch(() => {})
    window.electronAPI.bridge.list().then((all) => {
      setTracks(all.filter((i) => isAudioPath(i.path) && isToday(i.importedAt)))
    })
  }, [])

  useEffect(() => {
    const off = window.electronAPI.bridge.onImported((img) => {
      // 오늘 도착한 음악이면 화면에 추가 — 생성 중 카운트와 무관하게 받아 누락을 막는다.
      if (!isAudioPath(img.path) || !isToday(img.importedAt)) return
      setTracks((prev) => [img, ...prev.filter((p) => p.id !== img.id)])
      if (pendingCount.current > 0) {
        pendingCount.current = Math.max(0, pendingCount.current - 1)
        if (pendingCount.current <= 0) {
          setGenerating(false)
          setMsg('완료')
        } else {
          setMsg(`음악 받는 중… (남은 ${pendingCount.current})`)
        }
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

  const run = async () => {
    if (mode === 'simple' && !description.trim()) {
      setMsg('음악 설명을 입력하세요')
      return
    }
    if (mode === 'advanced' && !style.trim()) {
      setMsg('스타일을 입력하세요')
      return
    }
    setGenerating(true)
    pendingCount.current = 2 // 한 번에 2곡
    setMsg('음악 생성 시작… (1~3분 소요)')
    const r = await window.electronAPI.bridge.generateMusic({
      mode,
      description: description.trim(),
      instrumental,
      style: style.trim(),
      lyrics,
      title: title.trim()
    })
    if (!r.ok) {
      pendingCount.current = 0
      setGenerating(false)
      setMsg(r.message || '생성 실패')
    }
  }

  const stop = async () => {
    await window.electronAPI.bridge.cancel()
    pendingCount.current = 0
    setGenerating(false)
    setMsg('정지했습니다.')
  }

  const deleteTrack = async (id: string) => {
    await window.electronAPI.bridge.remove([id])
    setTracks((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div className="igen">
      {/* 좌측: 생성된 음악 */}
      <div className="igen-left">
        <div className="igen-left-head">
          <Music size={15} /> 생성된 음악
          <span className="igen-count">{tracks.length}</span>
        </div>
        {tracks.length === 0 && !generating ? (
          <div className="igen-empty">오른쪽에서 설명을 입력하고 음악을 생성하세요</div>
        ) : (
          <div className="mgen-list">
            {generating && (
              <div className="mgen-track" style={{ justifyContent: 'center', opacity: 0.7 }}>
                <Loader2 size={18} className="igen-spin" /> 생성 중…
              </div>
            )}
            {tracks.map((t) => (
              <TrackRow key={t.id} track={t} port={port} onDelete={() => deleteTrack(t.id)} />
            ))}
          </div>
        )}
      </div>

      {/* 우측: 입력 + 생성 */}
      <div className="igen-right">
        <div className="igen-panel">
          <div className="igen-label">생성 엔진</div>
          <div className="igen-seg">
            <button className="igen-seg-btn active">
              <Music size={15} /> SUNO
            </button>
          </div>

          {/* 모드 */}
          <div className="igen-seg" style={{ marginTop: 16 }}>
            {(['simple', 'advanced'] as SunoMode[]).map((m) => (
              <button
                key={m}
                className={`igen-seg-btn ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'simple' ? '간단' : '고급'}
              </button>
            ))}
          </div>

          {mode === 'simple' ? (
            <>
              <div className="igen-label" style={{ marginTop: 16 }}>
                음악 설명
              </div>
              <textarea
                className="igen-textarea"
                rows={6}
                placeholder="예: 잔잔한 어쿠스틱 발라드, 따뜻하고 감성적인 분위기"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
                연주곡 (가사 없음)
              </label>
            </>
          ) : (
            <>
              <div className="igen-label" style={{ marginTop: 16 }}>
                스타일
              </div>
              <textarea
                className="igen-textarea"
                rows={3}
                placeholder="예: K-pop, upbeat, female vocal, 120bpm"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              />
              <div className="igen-label" style={{ marginTop: 16 }}>
                가사
              </div>
              <textarea
                className="igen-textarea"
                rows={6}
                placeholder="[Verse]\n...\n[Chorus]\n..."
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
              />
              <div className="igen-label" style={{ marginTop: 16 }}>
                제목
              </div>
              <input
                className="igen-textarea"
                style={{ minHeight: 0 }}
                placeholder="곡 제목"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </>
          )}

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
                  <Sparkles size={16} /> 음악 생성 (2곡)
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
          <p className="igen-note">※ SUNO 로그인 필요 (크롬). 한 번에 2곡 생성됩니다.</p>
        </div>
      </div>
    </div>
  )
}
