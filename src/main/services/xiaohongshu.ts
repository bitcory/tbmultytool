// 샤오홍슈(小红书) 노트 fetch/다운로드 — 공유링크(xsec_token 포함)는 로그인 없이 서버 fetch 가능.
// 검색 목록은 서명이 필요해 브라우저 확장(xiaohongshu.js)이 처리하고, 다운로드는 이 모듈이 담당한다.
import type { XhsNote } from '@shared/types'
import { importImage } from '../imageBridge'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

async function httpGetText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }
  })
  if (!r.ok) throw new Error(`샤오홍슈 응답 오류: ${r.status}`)
  return await r.text()
}

// HTML 안의 window.__INITIAL_STATE__ = {...} 를 파싱 (slice 기반 — 종료가 };</script> 든 뭐든 견고)
function parseInitialState(html: string): Record<string, unknown> | null {
  const s = html.indexOf('__INITIAL_STATE__')
  if (s < 0) return null
  const eq = html.indexOf('=', s)
  const end = html.indexOf('</script>', eq)
  if (eq < 0 || end < 0) return null
  const raw = html.slice(eq + 1, end).trim().replace(/;+$/, '').replace(/\bundefined\b/g, 'null')
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

// <meta ... og:KEY ... content="..."> 를 속성 순서 무관하게 추출
function ogMeta(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]*(?:property|name)=["']og:${key}["'][^>]*content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']og:${key}["']`, 'i')
  const m = html.match(re) || html.match(re2)
  return m ? m[1] : ''
}
function ogMetaAll(html: string, key: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<meta[^>]*(?:property|name)=["']og:${key}["'][^>]*content=["']([^"']*)["']`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.push(m[1])
  return out
}

type AnyObj = Record<string, unknown>
const obj = (v: unknown): AnyObj => (v && typeof v === 'object' ? (v as AnyObj) : {})
const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  const mm = s.match(/([\d.]+)\s*([wk万]?)/i)
  if (!mm) return 0
  const n = parseFloat(mm[1]) || 0
  const u = mm[2].toLowerCase()
  return u === 'w' || u === '万' ? Math.round(n * 10000) : u === 'k' ? Math.round(n * 1000) : Math.round(n)
}

// 노트 객체에서 영상 스트림의 다운로드 URL 추출
function pickVideoUrl(note: AnyObj): string | undefined {
  const stream = obj(obj(obj(note.video).media).stream)
  for (const key of Object.keys(stream)) {
    const arr = stream[key]
    if (Array.isArray(arr) && arr[0]) {
      const s = obj(arr[0])
      const u = (s.masterUrl as string) || (Array.isArray(s.backupUrls) && (s.backupUrls[0] as string))
      if (u) return String(u).replace(/^http:/, 'https:')
    }
  }
  return undefined
}

function extractNote(state: AnyObj): AnyObj | null {
  const nd = obj(state.note)
  const map = obj(nd.noteDetailMap || nd.note)
  const keys = Object.keys(map)
  if (!keys.length) return null
  const first = obj(map[keys[0]])
  const note = obj(first.note || first)
  return Object.keys(note).length ? note : null
}

// __INITIAL_STATE__ 실패 시 og 메타태그로 최소 정보 복원 (title/cover/video 는 항상 존재)
function fromOg(html: string, url: string): XhsNote | null {
  const title = ogMeta(html, 'title').replace(/ - 小红书$/, '').trim()
  const videoUrl = (ogMeta(html, 'video') || '').replace(/^http:/, 'https:')
  const images = ogMetaAll(html, 'image')
    .filter((u) => /xhscdn\.com/.test(u))
    .map((u) => u.replace(/^http:/, 'https:'))
  if (!videoUrl && !images.length) return null
  const idM = url.match(/\/([0-9a-f]{16,32})/i)
  return {
    noteId: idM ? idM[1] : '',
    url,
    title,
    desc: '',
    type: videoUrl ? 'video' : 'image',
    author: '',
    likes: 0,
    collects: 0,
    comments: 0,
    cover: images[0] || '',
    images,
    videoUrl: videoUrl || undefined,
    duration: ogMeta(html, 'videotime') || ''
  }
}

/** 노트 URL(공유링크) 을 fetch 해 구조화 데이터 반환 */
export async function fetchNote(url: string): Promise<XhsNote> {
  const html = await httpGetText(url)
  const state = parseInitialState(html)
  const note = state ? extractNote(state) : null
  if (!note) {
    // state 파싱 실패 → og 태그 폴백
    const og = fromOg(html, url)
    if (og) return og
    throw new Error('노트를 파싱하지 못했어요 (로그인/토큰 만료일 수 있음)')
  }

  const interact = obj(note.interactInfo)
  const images = (Array.isArray(note.imageList) ? note.imageList : [])
    .map((i) => {
      const im = obj(i)
      const info = Array.isArray(im.infoList) ? obj(im.infoList[0]) : {}
      return String(im.urlDefault || im.url || info.url || '').replace(/^http:/, 'https:')
    })
    .filter(Boolean)
  const videoUrl = pickVideoUrl(note)

  return {
    noteId: String(note.noteId || note.id || ''),
    url,
    title: String(note.title || '').trim(),
    desc: String(note.desc || '').trim(),
    type: videoUrl ? 'video' : 'image',
    author: String(obj(note.user).nickname || ''),
    likes: num(interact.likedCount),
    collects: num(interact.collectedCount),
    comments: num(interact.commentCount),
    cover: images[0] || '',
    images,
    videoUrl,
    duration: note.video ? String(obj(obj(note.video).capa).duration || '') : ''
  }
}

/** 노트의 미디어(영상 우선, 없으면 이미지 전부) 를 갤러리에 저장 */
export async function downloadNote(url: string): Promise<{ ok: boolean; saved: number; message?: string }> {
  const note = await fetchNote(url)
  const safeTitle = (note.title || 'xhs').slice(0, 40).replace(/[^\w가-힣一-龥]+/g, '_')
  let saved = 0
  try {
    if (note.videoUrl) {
      await importImage({ source: 'xiaohongshu', url: note.videoUrl, filename: `${safeTitle}.mp4`, pageUrl: url })
      saved++
    } else {
      for (const [i, img] of note.images.entries()) {
        await importImage({ source: 'xiaohongshu', url: img, filename: `${safeTitle}_${i + 1}.jpg`, pageUrl: url }).catch(() => {})
        saved++
      }
    }
  } catch (e) {
    return { ok: false, saved, message: String(e instanceof Error ? e.message : e) }
  }
  if (!saved) return { ok: false, saved, message: '다운로드할 미디어가 없어요' }
  return { ok: true, saved }
}
