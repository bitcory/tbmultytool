import { useEffect, useState } from 'react'
import { MessageSquare, Clapperboard, Video, Music, FolderOpen, type LucideIcon } from 'lucide-react'
import { useStore } from '../store'
import type { BridgeInfo, ImageSource } from '@shared/types'

const SOURCES: { id: ImageSource; label: string; url: string; Icon: LucideIcon }[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', Icon: MessageSquare },
  { id: 'flow', label: 'Google Flow', url: 'https://labs.google/fx/ko/tools/flow', Icon: Clapperboard },
  { id: 'grok', label: 'Grok', url: 'https://grok.com/', Icon: Video },
  { id: 'suno', label: 'SUNO', url: 'https://suno.com/create', Icon: Music }
]

export default function Gallery() {
  const { setImages, addImage } = useStore()
  const [info, setInfo] = useState<BridgeInfo | null>(null)

  useEffect(() => {
    window.electronAPI.bridge.getInfo().then(setInfo)
    window.electronAPI.bridge.list().then(setImages)
    const off = window.electronAPI.bridge.onImported((img) => addImage(img))
    return off
  }, [])

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
    </div>
  )
}
