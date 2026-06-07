import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { ApiKeys } from '@shared/types'

// API 키는 평문 저장하지 않고 Electron safeStorage(OS 키체인 기반)로 암호화하여
// userData/keys.enc 에 저장한다. (keytar 같은 네이티브 모듈 불필요)
const keyFile = () => path.join(app.getPath('userData'), 'keys.enc')

export async function loadKeys(): Promise<ApiKeys> {
  try {
    const buf = await fs.readFile(keyFile())
    if (!safeStorage.isEncryptionAvailable()) {
      // 암호화 미지원 환경(일부 리눅스): 평문 JSON으로 폴백 저장됨
      return JSON.parse(buf.toString('utf8'))
    }
    const json = safeStorage.decryptString(buf)
    return JSON.parse(json)
  } catch {
    return {}
  }
}

export async function saveKeys(keys: ApiKeys): Promise<void> {
  const merged = { ...(await loadKeys()), ...keys }
  // 빈 문자열은 삭제로 간주
  for (const k of Object.keys(merged) as (keyof ApiKeys)[]) {
    if (!merged[k]) delete merged[k]
  }
  const json = JSON.stringify(merged)
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  await fs.writeFile(keyFile(), data)
}

export async function keysStatus(): Promise<Record<keyof ApiKeys, boolean>> {
  const k = await loadKeys()
  return {
    anthropic: !!k.anthropic,
    openai: !!k.openai,
    gemini: !!k.gemini,
    elevenlabs: !!k.elevenlabs,
    fal: !!k.fal
  }
}
