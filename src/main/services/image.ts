import { promises as fs } from 'fs'
import path from 'path'
import type { AspectRatio, ProjectOptions, Scene } from '@shared/types'
import { loadKeys } from '../secrets'

// fal.ai FLUX 의 image_size 매핑
const FAL_SIZE: Record<AspectRatio, string> = {
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '1:1': 'square_hd'
}
// OpenAI gpt-image-1 의 size 매핑
const OPENAI_SIZE: Record<AspectRatio, string> = {
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '1:1': '1024x1024'
}

async function falImage(key: string, prompt: string, aspect: AspectRatio): Promise<Buffer> {
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Key ${key}` },
    body: JSON.stringify({ prompt, image_size: FAL_SIZE[aspect], num_images: 1 })
  })
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  const url = data.images?.[0]?.url
  if (!url) throw new Error('fal.ai 응답에 이미지 URL이 없습니다.')
  const img = await fetch(url)
  return Buffer.from(await img.arrayBuffer())
}

async function openaiImage(key: string, prompt: string, aspect: AspectRatio): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: OPENAI_SIZE[aspect], n: 1 })
  })
  if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI 응답에 이미지 데이터가 없습니다.')
  return Buffer.from(b64, 'base64')
}

/** 씬 이미지 생성 → 저장된 파일 경로 반환 */
export async function generateImage(scene: Scene, opts: ProjectOptions, outDir: string): Promise<string> {
  const keys = await loadKeys()
  let buf: Buffer
  if (opts.imageProvider === 'fal') {
    if (!keys.fal) throw new Error('fal.ai API 키가 없습니다.')
    buf = await falImage(keys.fal, scene.imagePrompt, opts.aspect)
  } else {
    if (!keys.openai) throw new Error('OpenAI API 키가 없습니다.')
    buf = await openaiImage(keys.openai, scene.imagePrompt, opts.aspect)
  }
  const dir = path.join(outDir, 'images')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `scene_${String(scene.index).padStart(3, '0')}.png`)
  await fs.writeFile(file, buf)
  return file
}
