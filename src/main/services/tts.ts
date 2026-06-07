import { promises as fs } from 'fs'
import path from 'path'
import type { ProjectOptions, Scene } from '@shared/types'
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
