import { useEffect, useState } from 'react'
import { MessageSquare, Clapperboard, Video, Music, FolderOpen, type LucideIcon } from 'lucide-react'
import { useStore } from '../store'
import type { ApiKeys, BridgeInfo, ImageSource } from '@shared/types'

const KEY_FIELDS: { key: keyof ApiKeys; label: string; placeholder: string; help: string }[] = [
  { key: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...', help: '대본 생성' },
  { key: 'openai', label: 'OpenAI', placeholder: 'sk-...', help: '대본 / TTS / 이미지' },
  { key: 'gemini', label: 'Google Gemini', placeholder: 'AIza...', help: '대본 생성' },
  { key: 'elevenlabs', label: 'ElevenLabs', placeholder: '...', help: 'TTS 음성' },
  { key: 'fal', label: 'fal.ai', placeholder: 'fal-...', help: '이미지 생성 (FLUX)' },
  { key: 'youtube', label: 'YouTube Data API', placeholder: 'AIza...', help: '유튜브 분석기' },
  { key: 'coupangAccess', label: '쿠팡파트너스 Access Key', placeholder: '...', help: '제휴링크 자동 발급 (파트너스 → 링크생성 → API 관리)' },
  { key: 'coupangSecret', label: '쿠팡파트너스 Secret Key', placeholder: '...', help: '제휴링크 자동 발급' },
  { key: 'typecast', label: 'Typecast', placeholder: '...', help: 'TTS 음성 (typecast.ai/developers 에서 발급)' }
]

const SOURCES: { id: ImageSource; label: string; url: string; Icon: LucideIcon }[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', Icon: MessageSquare },
  { id: 'flow', label: 'Google Flow', url: 'https://labs.google/fx/ko/tools/flow', Icon: Clapperboard },
  { id: 'grok', label: 'Grok', url: 'https://grok.com/', Icon: Video },
  { id: 'suno', label: 'SUNO', url: 'https://suno.com/create', Icon: Music }
]

export default function Settings() {
  const { setImages, addImage } = useStore()
  const [info, setInfo] = useState<BridgeInfo | null>(null)
  const [extDir, setExtDir] = useState('')
  const [keys, setKeys] = useState<ApiKeys>({})
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [savedKeys, setSavedKeys] = useState(false)

  useEffect(() => {
    window.electronAPI.bridge.getInfo().then(setInfo)
    window.electronAPI.bridge.list().then(setImages)
    window.electronAPI.getExtensionDir().then(setExtDir).catch(() => {})
    window.electronAPI.keys.get().then(setKeys).catch(() => {})
    window.electronAPI.keys.getStatus().then(setKeyStatus).catch(() => {})
    const off = window.electronAPI.bridge.onImported((img) => addImage(img))
    return off
  }, [])

  const saveKeys = async (): Promise<void> => {
    await window.electronAPI.keys.set(keys)
    setKeyStatus(await window.electronAPI.keys.getStatus())
    setSavedKeys(true)
    setTimeout(() => setSavedKeys(false), 2000)
  }

  return (
    <div>
      <h1 className="h1">설정</h1>
      <p className="sub">크롬에서 ChatGPT·Flow·Grok·SUNO에 미리 로그인해 두면, 생성이 확장을 통해 자동 동작합니다.</p>

      {/* 소스 로그인 (진짜 크롬에서) */}
      <div className="card">
        <label style={{ marginBottom: 10, display: 'block' }}>① 크롬에서 사이트 로그인 (먼저 여기서 다 로그인해 두세요)</label>
        <div className="row">
          {SOURCES.map((s) => {
            const Icon = s.Icon
            return (
              <button
                key={s.id}
                className="btn secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => window.electronAPI.fs.openExternal(s.url)}
              >
                <Icon size={16} /> {s.label} 열기
              </button>
            )
          })}
        </div>
        <p className="hint">
          버튼을 누르면 <b>기본 브라우저(크롬)</b>에서 사이트가 열립니다. 거기서 <b>한 번 로그인</b>해 두면 세션이 유지돼요.
          (봇 차단이 없는 진짜 크롬이라 구글 로그인도 정상 동작합니다.) 그러면 이미지·영상·음악 생성이 <b>크롬 확장</b>을 통해
          자동으로 실행됩니다. ※ 크롬에 <b>TB MTOOL 확장</b>이 설치돼 있어야 합니다.
        </p>
      </div>

      {/* 크롬 확장 설치 */}
      <div className="card">
        <label style={{ marginBottom: 10, display: 'block' }}>② 크롬 확장 설치 (생성 자동화에 필수, 1회)</label>
        <div className="row" style={{ alignItems: 'center' }}>
          <button
            className="btn secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => extDir && window.electronAPI.fs.openPath(extDir)}
          >
            <FolderOpen size={16} /> 확장 폴더 열기
          </button>
          {extDir && <code style={{ fontSize: 12, opacity: 0.7 }}>{extDir}</code>}
        </div>
        <p className="hint">
          ① 위 버튼으로 폴더를 연 뒤, 크롬 주소창에 <code>chrome://extensions</code> 입력 →
          <b> 개발자 모드 ON</b> → <b>“압축해제된 확장 프로그램을 로드”</b> → 이 폴더 선택.
          <br />
          ② <b>앱이 업데이트되면 이 폴더의 확장도 자동으로 갱신</b>됩니다. 그때는 <code>chrome://extensions</code>
          에서 <b>새로고침(↻)</b> 한 번만 눌러주세요 (크롬을 재시작해도 적용).
        </p>
      </div>

      {/* 연결 상태 */}
      <div className="card">
        <div className="statuschip">
          <span className={`dot ${info?.running ? 'on' : 'off'}`} />
          {info?.running ? (
            <span>
              확장 수신 대기 중 — <code>http://127.0.0.1:{info.port}</code>
            </span>
          ) : (
            <span>수신 서버가 꺼져 있습니다</span>
          )}
        </div>
        {info && (
          <p className="hint">
            저장 폴더: <code>{info.dir}</code>{' '}
            <button className="btn ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => window.electronAPI.fs.openPath(info.dir)}>
              <FolderOpen size={14} /> 폴더 열기
            </button>
          </p>
        )}
      </div>

      {/* API 키 */}
      <div className="card">
        <label style={{ marginBottom: 4, display: 'block' }}>③ API 키 (선택 기능용)</label>
        <p className="hint" style={{ marginTop: 0 }}>
          OS 키체인(safeStorage)으로 암호화되어 로컬에만 저장됩니다.
        </p>
        {KEY_FIELDS.map((f) => (
          <div className="field" key={f.key} style={{ marginTop: 10 }}>
            <label>
              {f.label} <span style={{ opacity: 0.6 }}>· {f.help}</span>{' '}
              {keyStatus[f.key] && <span className="badge ok">저장됨</span>}
            </label>
            <input
              type="password"
              placeholder={f.placeholder}
              value={keys[f.key] ?? ''}
              onChange={(e) => setKeys({ ...keys, [f.key]: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
        ))}
        <div className="row" style={{ marginTop: 12, alignItems: 'center', gap: 10 }}>
          <button className="btn" onClick={saveKeys}>저장</button>
          <span className="hint">{savedKeys ? '✓ 저장되었습니다.' : ''}</span>
        </div>
      </div>
    </div>
  )
}
