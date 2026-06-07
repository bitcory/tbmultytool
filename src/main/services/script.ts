import { randomUUID } from 'crypto'
import type { ProjectOptions, Scene } from '@shared/types'
import { loadKeys } from '../secrets'

// 공급자별 기본 모델
const MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash'
} as const

function buildPrompt(opts: ProjectOptions): { system: string; user: string } {
  const langName = opts.language === 'ko' ? '한국어' : opts.language
  const system = [
    `당신은 유튜브 영상 대본 작가입니다. 주제를 받아 ${opts.sceneCount}개의 씬으로 구성된 영상 대본을 작성합니다.`,
    `각 씬은 (1) ${langName}로 된 나레이션 문장, (2) 그 장면을 묘사하는 영어 이미지 생성 프롬프트로 이루어집니다.`,
    `이미지 프롬프트는 구체적인 시각 묘사(피사체, 배경, 분위기, 조명, 구도)를 영어로 작성합니다.`,
    `반드시 아래 JSON 스키마로만 응답하세요. 코드블록·설명 없이 순수 JSON만 출력합니다.`,
    `{"title": string, "scenes": [{"narration": string, "imagePrompt": string}]}`
  ].join('\n')
  const user = [
    `주제: ${opts.topic}`,
    opts.channelName ? `채널명: ${opts.channelName}` : '',
    `씬 개수: 정확히 ${opts.sceneCount}개`,
    `언어: ${langName}`
  ].filter(Boolean).join('\n')
  return { system, user }
}

/** 응답 텍스트에서 JSON 본문만 안전하게 추출 */
function extractJson(text: string): { title: string; scenes: { narration: string; imagePrompt: string }[] } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('LLM 응답에서 JSON을 찾지 못했습니다.')
  return JSON.parse(text.slice(start, end + 1))
}

async function callAnthropic(key: string, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODELS.anthropic,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }]
    })
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  return data.content?.map((c: any) => c.text).join('') ?? ''
}

async function callOpenAI(key: string, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODELS.openai,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' }
    })
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

async function callGemini(key: string, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${key}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
}

/** 대본 생성 → Scene[] 반환 */
export async function generateScript(opts: ProjectOptions): Promise<Scene[]> {
  const keys = await loadKeys()
  const { system, user } = buildPrompt(opts)

  let raw: string
  if (opts.scriptProvider === 'anthropic') {
    if (!keys.anthropic) throw new Error('Anthropic API 키가 없습니다.')
    raw = await callAnthropic(keys.anthropic, system, user)
  } else if (opts.scriptProvider === 'openai') {
    if (!keys.openai) throw new Error('OpenAI API 키가 없습니다.')
    raw = await callOpenAI(keys.openai, system, user)
  } else {
    if (!keys.gemini) throw new Error('Gemini API 키가 없습니다.')
    raw = await callGemini(keys.gemini, system, user)
  }

  const parsed = extractJson(raw)
  const style = opts.imageStyle?.trim()
  return parsed.scenes.map((s, i) => ({
    id: randomUUID(),
    index: i,
    narration: s.narration.trim(),
    imagePrompt: style ? `${s.imagePrompt.trim()}, ${style}` : s.imagePrompt.trim()
  }))
}
