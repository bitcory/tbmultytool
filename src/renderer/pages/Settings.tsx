import { useEffect, useState } from 'react'
import type { ApiKeys } from '@shared/types'

const FIELDS: { key: keyof ApiKeys; label: string; placeholder: string; help: string }[] = [
  { key: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...', help: '대본 생성' },
  { key: 'openai', label: 'OpenAI', placeholder: 'sk-...', help: '대본 / TTS / 이미지' },
  { key: 'gemini', label: 'Google Gemini', placeholder: 'AIza...', help: '대본 생성' },
  { key: 'elevenlabs', label: 'ElevenLabs', placeholder: '...', help: 'TTS 음성' },
  { key: 'fal', label: 'fal.ai', placeholder: 'fal-...', help: '이미지 생성 (FLUX)' }
]

export default function Settings() {
  const [keys, setKeys] = useState<ApiKeys>({})
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI.keys.get().then(setKeys)
    window.electronAPI.keys.getStatus().then(setStatus)
    window.electronAPI.getVersion().then(setVersion)
  }, [])

  async function save(): Promise<void> {
    await window.electronAPI.keys.set(keys)
    setStatus(await window.electronAPI.keys.getStatus())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h1 className="h1">설정</h1>
      <p className="sub">
        API 키는 OS 키체인(safeStorage)으로 암호화되어 로컬에만 저장됩니다.
        {version && <span style={{ marginLeft: 8, opacity: 0.6 }}>· 버전 v{version}</span>}
      </p>

      <div className="card">
        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label>
              {f.label} <span style={{ opacity: 0.6 }}>· {f.help}</span>{' '}
              {status[f.key] && <span className="badge ok">저장됨</span>}
            </label>
            <input
              type="password"
              placeholder={f.placeholder}
              value={keys[f.key] ?? ''}
              onChange={(e) => setKeys({ ...keys, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <div className="actions">
          <span className="hint">{saved ? '✓ 저장되었습니다.' : ''}</span>
          <button className="btn" onClick={save}>저장</button>
        </div>
      </div>
    </div>
  )
}
