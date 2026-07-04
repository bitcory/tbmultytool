import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { ProjectOptions, Scene, TypecastTtsOptions, TypecastVoice } from '@shared/types'
import { loadKeys } from '../secrets'
import { getDuration } from '../ffmpeg'

async function openaiTts(key: string, text: string, voice: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'tts-1', voice: voice || 'alloy', input: text, response_format: 'mp3' })
  })
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

async function elevenTts(key: string, text: string, voiceId: string): Promise<Buffer> {
  const id = voiceId || '21m00Tcm4TlvDq8ikWAM' // 기본 음성(Rachel)
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
  })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

// ── Typecast (typecast.ai) ────────────────────────────────────────────────
// POST /v1/text-to-speech, X-API-KEY 인증, 오디오 바이너리 응답.
// 보이스/감정/출력 옵션은 TypecastTtsOptions 로 제어 (렌더러의 보이스 선택 UI 와 연동).

/** /v2/voices 원본 → 정규화. 응답 필드가 바뀔 수 있어 방어적으로 파싱한다. */
function normalizeVoice(raw: Record<string, unknown>): TypecastVoice | null {
  const voiceId = String(raw.voice_id || raw.voiceId || '')
  if (!voiceId) return null
  const emotions: Record<string, string[]> = {}
  const models = raw.models
  if (Array.isArray(models)) {
    for (const m of models as Record<string, unknown>[]) {
      const name = String(m.version || m.model || m.name || '')
      const emo = Array.isArray(m.emotions) ? (m.emotions as string[]).map(String) : []
      if (name) emotions[name] = emo
    }
  }
  return {
    voiceId,
    name: String(raw.voice_name || raw.name || voiceId),
    gender: raw.gender != null ? String(raw.gender) : undefined,
    age: raw.age != null ? String(raw.age) : undefined,
    useCases: Array.isArray(raw.use_cases) ? (raw.use_cases as unknown[]).map(String) : undefined,
    voiceType: raw.voice_type != null ? String(raw.voice_type) : undefined,
    emotions: Object.keys(emotions).length ? emotions : undefined
  }
}

let voicesCache: TypecastVoice[] | null = null
export async function typecastVoices(): Promise<TypecastVoice[]> {
  if (voicesCache) return voicesCache
  const keys = await loadKeys()
  if (!keys.typecast) throw new Error('Typecast API 키가 없습니다. 설정에서 입력하세요.')
  const res = await fetch('https://api.typecast.ai/v2/voices', { headers: { 'X-API-KEY': keys.typecast } })
  if (!res.ok) throw new Error(`Typecast 보이스 조회 ${res.status}: ${await res.text()}`)
  const raw = (await res.json()) as Record<string, unknown>[]
  const list = (Array.isArray(raw) ? raw : []).map(normalizeVoice).filter((v): v is TypecastVoice => !!v)
  if (list.length) voicesCache = list
  return list
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

async function typecastTts(key: string, text: string, o: TypecastTtsOptions): Promise<Buffer> {
  // 보이스는 tc_/uc_ 접두사 ID — 미지정/타 공급자 기본값이면 목록의 첫 보이스 자동 선택
  let voiceId = /^(tc_|uc_)/.test(o.voiceId || '') ? (o.voiceId as string) : ''
  if (!voiceId) {
    const list = await typecastVoices()
    if (!list.length) throw new Error('Typecast 보이스가 없습니다 — typecast.ai 콘솔에서 확인하세요.')
    voiceId = list[0].voiceId
  }
  const model = o.model === 'ssfm-v21' ? 'ssfm-v21' : 'ssfm-v30'
  // 감정: 프리셋 지정 시 preset+강도, 미지정이면 v30 은 스마트(문맥 자동), v21 은 생략(기본)
  const prompt = o.emotionPreset
    ? {
        emotion_type: 'preset',
        emotion_preset: o.emotionPreset,
        emotion_intensity: clamp(o.emotionIntensity ?? 1, 0, 2)
      }
    : model === 'ssfm-v30'
      ? { emotion_type: 'smart' }
      : undefined
  const body: Record<string, unknown> = {
    voice_id: voiceId,
    text: text.slice(0, 2000), // API 제한 1~2000자
    model,
    output: {
      volume: clamp(Math.round(o.volume ?? 100), 0, 200),
      audio_pitch: clamp(Math.round(o.pitch ?? 0), -12, 12),
      audio_tempo: clamp(o.tempo ?? 1, 0.5, 2),
      audio_format: 'mp3' // 320kbps mp3 — 기존 파이프라인(.mp3)과 동일
    }
  }
  if (o.language) body.language = o.language
  if (prompt) body.prompt = prompt
  if (o.seed != null && Number.isFinite(o.seed)) body.seed = clamp(Math.round(o.seed), 0, 4294967295)
  const res = await fetch('https://api.typecast.ai/v1/text-to-speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Typecast TTS ${res.status}: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

// 보이스 미리듣기 — 언어별 짧은 예시문장을 합성. (voiceId|model|lang) 별로 캐시해 반복 재생시 크레딧 소모 없음.
const PREVIEW_TEXT: Record<string, string> = {
  kor: '안녕하세요. 지금 이 목소리로 나레이션을 만들어 드려요.',
  eng: 'Hello! This is how your narration will sound.',
  cmn: '你好，这是您的旁白声音示例。',
  jpn: 'こんにちは。ナレーションのサンプル音声です。'
}
// 메모리 + 디스크(userData/tc-previews) 2단 캐시 — 앱을 재시작해도 같은 보이스는 재과금 없음.
const previewCache = new Map<string, Buffer>()
function previewCacheDir(): string {
  return path.join(app.getPath('userData'), 'tc-previews')
}
export async function typecastPreview(voiceId: string, model: string, language: string): Promise<Buffer> {
  const keys = await loadKeys()
  if (!keys.typecast) throw new Error('Typecast API 키가 없습니다. 설정에서 입력하세요.')
  const lang = PREVIEW_TEXT[language] ? language : 'kor'
  const mdl = model === 'ssfm-v21' ? 'ssfm-v21' : 'ssfm-v30'
  const cacheKey = `${voiceId}|${mdl}|${lang}`
  const hit = previewCache.get(cacheKey)
  if (hit) return hit
  // 디스크 캐시 확인 (파일명: 보이스ID_모델_언어.mp3 — 모두 안전한 문자만 포함)
  const safe = (v: string): string => v.replace(/[^a-zA-Z0-9_-]/g, '')
  const file = path.join(previewCacheDir(), `${safe(voiceId) || 'auto'}_${safe(mdl)}_${safe(lang)}.mp3`)
  try {
    const disk = await fs.readFile(file)
    previewCache.set(cacheKey, disk)
    return disk
  } catch {
    /* 캐시 없음 → API 호출 */
  }
  const buf = await typecastTts(keys.typecast, PREVIEW_TEXT[lang], { voiceId, model: mdl, language: lang })
  previewCache.set(cacheKey, buf)
  try {
    await fs.mkdir(previewCacheDir(), { recursive: true })
    await fs.writeFile(file, buf)
  } catch {
    /* 디스크 저장 실패는 무시 — 메모리 캐시로 동작 */
  }
  return buf
}

/** 나레이션 텍스트 → 음성 버퍼 (공급자/보이스/Typecast 상세옵션) — genNarration IPC 용 */
export async function synthesizeNarration(
  text: string,
  provider: string,
  voice: string,
  tcOpts?: TypecastTtsOptions
): Promise<Buffer> {
  const keys = await loadKeys()
  if (provider === 'openai') {
    if (!keys.openai) throw new Error('OpenAI API 키가 없습니다.')
    return openaiTts(keys.openai, text, voice)
  }
  if (provider === 'typecast') {
    if (!keys.typecast) throw new Error('Typecast API 키가 없습니다. 설정에서 입력하세요 (typecast.ai/developers).')
    return typecastTts(keys.typecast, text, { ...(tcOpts || {}), voiceId: (tcOpts && tcOpts.voiceId) || voice })
  }
  if (!keys.elevenlabs) throw new Error('ElevenLabs API 키가 없습니다.')
  return elevenTts(keys.elevenlabs, text, voice)
}

/** 씬 나레이션 음성 생성 → 파일 경로 + 길이(초) */
export async function generateTts(
  scene: Scene,
  opts: ProjectOptions,
  outDir: string
): Promise<{ path: string; durationSec: number }> {
  const keys = await loadKeys()
  let buf: Buffer
  if (opts.ttsProvider === 'openai') {
    if (!keys.openai) throw new Error('OpenAI API 키가 없습니다.')
    buf = await openaiTts(keys.openai, scene.narration, opts.ttsVoice)
  } else if (opts.ttsProvider === 'typecast') {
    if (!keys.typecast) throw new Error('Typecast API 키가 없습니다. 설정에서 입력하세요 (typecast.ai/developers).')
    buf = await typecastTts(keys.typecast, scene.narration, { voiceId: opts.ttsVoice })
  } else {
    if (!keys.elevenlabs) throw new Error('ElevenLabs API 키가 없습니다.')
    buf = await elevenTts(keys.elevenlabs, scene.narration, opts.ttsVoice)
  }
  const dir = path.join(outDir, 'audio')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `scene_${String(scene.index).padStart(3, '0')}.mp3`)
  await fs.writeFile(file, buf)
  const durationSec = await getDuration(file)
  return { path: file, durationSec }
}
