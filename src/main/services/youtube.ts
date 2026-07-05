import type { YoutubeSearchOpts, YoutubeVideo, YoutubeChannelAnalysis, YoutubeChannelOpts, YoutubeTranscriptOpts, YoutubeTranscriptResult, YoutubeTranscriptTrack, YoutubeTranscriptSegment } from '@shared/types'
import { loadKeys } from '../secrets'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, promises as fsp } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { FFMPEG } from '../ffmpeg'

const API = 'https://www.googleapis.com/youtube/v3'

// 카테고리별 RPM(원) 대략치 — 예상 수익 계산용. 기본 24(엔터테인먼트). (luha-master 이식)
const CATEGORY_RPM: Record<string, { min: number; max: number }> = {
  '1': { min: 600, max: 2500 }, // Film & Animation
  '10': { min: 800, max: 3000 }, // Music
  '15': { min: 600, max: 2400 }, // Pets & Animals
  '17': { min: 700, max: 2800 }, // Sports
  '20': { min: 1200, max: 4500 }, // Gaming
  '22': { min: 600, max: 2500 }, // People & Blogs
  '23': { min: 700, max: 2800 }, // Comedy
  '24': { min: 650, max: 2600 }, // Entertainment
  '25': { min: 700, max: 2800 }, // News & Politics
  '26': { min: 900, max: 3500 }, // Howto & Style
  '27': { min: 1000, max: 4000 }, // Education
  '28': { min: 1100, max: 4200 } // Science & Tech
}
// 쇼츠는 롱폼 대비 RPM이 매우 낮음 → 쇼츠 전용 RPM(원/1000회) 별도 적용.
const SHORTS_RPM = { min: 30, max: 150 }
function estimateRevenue(views: number, categoryId?: string, isShort?: boolean): { min: number; max: number } {
  const rpm = isShort ? SHORTS_RPM : (categoryId && CATEGORY_RPM[categoryId]) || { min: 650, max: 2600 }
  return { min: Math.round((views / 1000) * rpm.min), max: Math.round((views / 1000) * rpm.max) }
}

// ISO8601 (PT#H#M#S) → 초
function parseDuration(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '')
  if (!m) return 0
  return parseInt(m[1] || '0', 10) * 3600 + parseInt(m[2] || '0', 10) * 60 + parseInt(m[3] || '0', 10)
}

// CII: 조회수/구독자 비율 기반 (≥10 Great, ≥3 Good, 그 외 Bad)
function cii(ratio: number | null): 'Great' | 'Good' | 'Bad' {
  if (ratio == null) return 'Bad'
  if (ratio >= 10) return 'Great'
  if (ratio >= 3) return 'Good'
  return 'Bad'
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// 할당량(세션 누적, 대략치) — search=100, 그 외=1 유닛
let quotaUsed = 0
export function youtubeQuota(): number {
  return quotaUsed
}
async function getJson(url: string): Promise<any> {
  quotaUsed += url.includes('/search') ? 100 : 1
  if (quotaUsed > 8000) console.warn('⚠️ YouTube API 할당량 80%+ 사용(세션 누적 ~' + quotaUsed + ' / 일 10000)')
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) {
    const msg = (j && j.error && j.error.message) || `HTTP ${r.status}`
    throw new Error('YouTube API: ' + msg)
  }
  return j
}

// ── 채널 식별 ─────────────────────────────────────────────
// 검색어가 채널을 가리키는지 감지 (URL / @핸들 / 채널ID)
function detectChannel(raw: string): { channelId?: string; handle?: string; legacy?: string } | null {
  const s = (raw || '').trim()
  let m = s.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i)
  if (m) return { channelId: m[1] }
  if (/^UC[\w-]{20,}$/.test(s)) return { channelId: s }
  m = s.match(/(?:youtube\.com\/)?@([\w.\-가-힣ぁ-んァ-ヶ一-龯]+)/i)
  if (m) return { handle: '@' + m[1] }
  m = s.match(/youtube\.com\/(?:c|user)\/([\w.\-가-힣]+)/i)
  if (m) return { legacy: m[1] }
  return null
}

// 채널 입력을 channelId 로 해석 (채널ID → forHandle → search.list type=channel 폴백)
async function resolveChannelId(key: string, raw: string): Promise<string | null> {
  const det = detectChannel(raw) || { handle: raw.trim().startsWith('@') ? raw.trim() : undefined, legacy: raw.trim() }
  const byChannels = async (param: 'id' | 'forHandle' | 'forUsername', val: string): Promise<string | null> => {
    const u = new URL(API + '/channels')
    u.searchParams.set('part', 'id')
    u.searchParams.set(param, val)
    u.searchParams.set('key', key)
    const j = await getJson(u.toString()).catch(() => null)
    const it = j && j.items && j.items[0]
    return it ? it.id : null
  }
  if (det.channelId) return (await byChannels('id', det.channelId)) || det.channelId
  if (det.handle) {
    const bare = det.handle.replace(/^@/, '')
    // forHandle 은 대소문자/@유무를 구분하므로 변형을 순서대로 시도
    // (예: 사용자가 @TOOLB 를 넣어도 실제 핸들은 @toolb)
    const tries = [...new Set(['@' + bare, bare, '@' + bare.toLowerCase(), bare.toLowerCase()])]
    for (const t of tries) {
      const id = await byChannels('forHandle', t)
      if (id) return id
    }
    console.warn('[YT] forHandle 해석 실패 → search 폴백:', det.handle)
  }
  if (det.legacy) {
    const id = await byChannels('forUsername', det.legacy)
    if (id) return id
  }
  // 폴백: search.list type=channel.
  // 핸들의 '-'/'_' 는 검색 연산자(NOT 등)로 오해되므로 공백으로 치환해 토큰 검색.
  const term = (det.handle || det.legacy || raw || '').replace(/^@/, '').replace(/[-_]+/g, ' ').trim()
  if (!term) return null
  const u = new URL(API + '/search')
  u.searchParams.set('part', 'snippet')
  u.searchParams.set('type', 'channel')
  u.searchParams.set('q', term)
  u.searchParams.set('maxResults', '5')
  u.searchParams.set('key', key)
  const j = await getJson(u.toString()).catch(() => null)
  const items = (j && j.items) || []
  if (!items.length) { console.warn('[YT] 채널 검색 폴백 0건:', term); return null }
  const it = items[0]
  return it && it.id && it.id.channelId ? it.id.channelId : null
}

// 채널의 업로드 재생목록 ID + 기본 통계 (channels.list 1유닛)
async function getChannelCore(
  key: string,
  channelId: string
): Promise<{ uploads: string; title: string; thumb: string; description: string; subscribers: number; totalViews: number; videoCount: number; publishedAt: string; handle?: string } | null> {
  const u = new URL(API + '/channels')
  u.searchParams.set('part', 'snippet,statistics,contentDetails')
  u.searchParams.set('id', channelId)
  u.searchParams.set('key', key)
  const j = await getJson(u.toString())
  const it = (j.items || [])[0]
  if (!it) return null
  const sn = it.snippet || {}
  const st = it.statistics || {}
  const th = (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default || sn.thumbnails.high)) || {}
  // 업로드 재생목록 ID: contentDetails 우선, 없으면 채널ID의 UC→UU 변환으로 폴백.
  const uploads = (it.contentDetails && it.contentDetails.relatedPlaylists && it.contentDetails.relatedPlaylists.uploads) || (channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : '')
  return {
    uploads,
    title: sn.title || '',
    thumb: th.url || '',
    description: sn.description || '',
    subscribers: st.hiddenSubscriberCount ? 0 : parseInt(st.subscriberCount || '0', 10),
    totalViews: parseInt(st.viewCount || '0', 10),
    videoCount: parseInt(st.videoCount || '0', 10),
    publishedAt: sn.publishedAt || '',
    handle: sn.customUrl || undefined
  }
}

// 업로드 재생목록에서 영상 id 수집 (playlistItems 1유닛/페이지 — search 대비 100배 저렴)
// publishedAfter 지정 시 그보다 오래된 영상을 만나면 중단(최신순 정렬 가정).
async function collectUploadIds(key: string, uploads: string, max: number, publishedAfter?: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken = ''
  const cut = publishedAfter ? new Date(publishedAfter).getTime() : 0
  for (let guard = 0; guard < 10 && ids.length < max; guard++) {
    const u = new URL(API + '/playlistItems')
    u.searchParams.set('part', 'snippet,contentDetails')
    u.searchParams.set('playlistId', uploads)
    u.searchParams.set('maxResults', String(Math.min(50, max - ids.length)))
    u.searchParams.set('key', key)
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    // 재생목록이 없거나 접근 불가(예: 자동생성 Topic 채널)면 throw 대신 수집을 중단하고 모은 만큼 반환.
    let j: any
    try {
      j = await getJson(u.toString())
    } catch {
      break
    }
    let stop = false
    for (const it of j.items || []) {
      const cd = it.contentDetails || {}
      const vid = cd.videoId
      if (!vid) continue
      if (cut) {
        const pub = new Date(cd.videoPublishedAt || (it.snippet && it.snippet.publishedAt) || 0).getTime()
        if (pub && pub < cut) {
          stop = true
          continue
        }
      }
      ids.push(vid)
    }
    pageToken = j.nextPageToken || ''
    if (stop || !pageToken) break
  }
  return ids
}

// ── 영상 통계 → YoutubeVideo ──────────────────────────────
type RawV = {
  id: string
  title: string
  channelId: string
  channel: string
  thumb: string
  views: number
  likes: number | null
  comments: number | null
  durationSec: number
  publishedAt: string
  categoryId?: string
}
async function fetchVideos(key: string, ids: string[]): Promise<RawV[]> {
  const out: RawV[] = []
  for (const batch of chunk(ids, 50)) {
    const u = new URL(API + '/videos')
    u.searchParams.set('part', 'snippet,statistics,contentDetails')
    u.searchParams.set('id', batch.join(','))
    u.searchParams.set('key', key)
    const j = await getJson(u.toString())
    for (const it of j.items || []) {
      const sn = it.snippet || {}
      const st = it.statistics || {}
      const th = (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default || sn.thumbnails.high)) || {}
      out.push({
        id: it.id,
        title: sn.title || '',
        channelId: sn.channelId || '',
        channel: sn.channelTitle || '',
        thumb: th.url || '',
        views: parseInt(st.viewCount || '0', 10),
        likes: st.likeCount != null ? parseInt(st.likeCount, 10) : null,
        comments: st.commentCount != null ? parseInt(st.commentCount, 10) : null,
        durationSec: parseDuration((it.contentDetails && it.contentDetails.duration) || ''),
        publishedAt: sn.publishedAt || '',
        categoryId: sn.categoryId || undefined
      })
    }
  }
  return out
}
function toVideo(v: RawV, subscribers: number): YoutubeVideo {
  const subViewRatio = subscribers > 0 ? Math.round((v.views / subscribers) * 10) / 10 : null
  const likeRate = v.views > 0 && v.likes != null ? Math.round((v.likes / v.views) * 10000) / 100 : null
  const commentRate = v.views > 0 && v.comments != null ? Math.round((v.comments / v.views) * 10000) / 100 : null
  const isShort = v.durationSec > 0 && v.durationSec <= 60
  return {
    id: v.id,
    title: v.title,
    channel: v.channel,
    channelId: v.channelId,
    thumbnail: v.thumb,
    url: 'https://www.youtube.com/watch?v=' + v.id,
    views: v.views,
    subscribers,
    publishedAt: v.publishedAt,
    durationSec: v.durationSec,
    likes: v.likes,
    comments: v.comments,
    type: isShort ? 'shorts' : 'long',
    subViewRatio,
    likeRate,
    commentRate,
    categoryId: v.categoryId,
    estRevenue: v.views > 0 ? estimateRevenue(v.views, v.categoryId, isShort) : null,
    cii: cii(subViewRatio)
  }
}

// 채널 구독자 일괄 조회
async function fetchSubs(key: string, channelIds: string[]): Promise<Record<string, number>> {
  const subsMap: Record<string, number> = {}
  for (const batch of chunk([...new Set(channelIds.filter(Boolean))], 50)) {
    const u = new URL(API + '/channels')
    u.searchParams.set('part', 'statistics')
    u.searchParams.set('id', batch.join(','))
    u.searchParams.set('key', key)
    const j = await getJson(u.toString())
    for (const it of j.items || []) {
      const hidden = it.statistics && it.statistics.hiddenSubscriberCount
      subsMap[it.id] = hidden ? 0 : parseInt((it.statistics && it.statistics.subscriberCount) || '0', 10)
    }
  }
  return subsMap
}

// 검색어와 채널명이 실제로 같은 채널을 가리키는지 — 공백/대소문자 무시 부분일치
function nameMatches(query: string, title: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  const q = norm(query)
  const t = norm(title)
  return !!q && !!t && (t.includes(q) || q.includes(t))
}

// 키워드 검색이 0건일 때: 검색어가 채널명일 수 있으므로 type=channel 로 찾아 이름이 맞으면 채널ID 반환
async function findChannelByName(key: string, query: string): Promise<string | null> {
  const u = new URL(API + '/search')
  u.searchParams.set('part', 'snippet')
  u.searchParams.set('type', 'channel')
  u.searchParams.set('q', query)
  u.searchParams.set('maxResults', '5')
  u.searchParams.set('key', key)
  const j = await getJson(u.toString()).catch(() => null)
  for (const it of (j && j.items) || []) {
    const title = (it.snippet && it.snippet.title) || ''
    // 이름이 실제로 비슷할 때만 채널로 간주 (일반 키워드가 엉뚱한 채널로 빠지는 것 방지)
    if (nameMatches(query, title)) return (it.id && it.id.channelId) || null
  }
  return null
}

// ── 키워드/채널 검색 ──────────────────────────────────────
export async function youtubeSearch(opts: YoutubeSearchOpts): Promise<{ items: YoutubeVideo[]; channelMode: boolean }> {
  const key = (await loadKeys()).youtube
  if (!key) throw new Error('설정에서 YouTube API 키를 등록하세요.')
  const q = (opts.query || '').trim()
  if (!q) throw new Error('검색어를 입력하세요.')
  const max = Math.min(Math.max(opts.max || 50, 1), 200)
  const region = opts.region || 'KR'
  const order = opts.order || 'viewCount'
  const publishedAfter = new Date(Date.now() - (opts.days || 7) * 86400000).toISOString()

  // 채널 입력이면(URL/@핸들/채널ID) uploads 재생목록으로 그 채널 영상만 (1유닛/페이지)
  const det = detectChannel(q)
  let ids: string[] = []
  let channelMode = !!det
  if (det) {
    const channelId = await resolveChannelId(key, q)
    if (!channelId) throw new Error('채널을 찾지 못했어요: ' + q + ' (채널 URL / @핸들 / 채널ID 확인)')
    const core = await getChannelCore(key, channelId)
    if (!core) throw new Error('채널 정보를 가져오지 못했어요.')
    ids = core.uploads ? await collectUploadIds(key, core.uploads, max, publishedAfter) : []
  } else {
    // 키워드 모드: search.list 페이지네이션
    let pageToken = ''
    const pages = Math.ceil(max / 50) + 2
    for (let guard = 0; guard < pages && ids.length < max; guard++) {
      const u = new URL(API + '/search')
      u.searchParams.set('part', 'snippet')
      u.searchParams.set('type', 'video')
      u.searchParams.set('order', order)
      u.searchParams.set('maxResults', String(Math.min(50, max - ids.length)))
      u.searchParams.set('publishedAfter', publishedAfter)
      u.searchParams.set('q', q)
      u.searchParams.set('regionCode', region)
      u.searchParams.set('relevanceLanguage', region === 'KR' ? 'ko' : 'en')
      u.searchParams.set('key', key)
      if (pageToken) u.searchParams.set('pageToken', pageToken)
      const j = await getJson(u.toString())
      for (const it of j.items || []) {
        const vid = it.id && it.id.videoId
        if (vid) ids.push(vid)
      }
      pageToken = j.nextPageToken || ''
      if (!pageToken) break
    }
    // 키워드 결과 0건 → 채널명일 수 있으니 채널로 해석해 그 채널 영상을 불러온다
    // (유튜브 키워드 검색은 채널명 + 최근 기간 조합에서 0건을 주는 경우가 많음)
    if (!ids.length) {
      const channelId = await findChannelByName(key, q).catch(() => null)
      if (channelId) {
        const core = await getChannelCore(key, channelId).catch(() => null)
        if (core && core.uploads) {
          ids = await collectUploadIds(key, core.uploads, max, publishedAfter)
          channelMode = ids.length > 0
        }
      }
    }
  }
  if (!ids.length) return { items: [], channelMode }

  const vids = await fetchVideos(key, ids)
  const subsMap = await fetchSubs(key, vids.map((v) => v.channelId))
  return { items: vids.map((v) => toVideo(v, subsMap[v.channelId] ?? 0)), channelMode }
}

// ── 스크립트(자막) 추출 ─────────────────────────────────────
// 유튜브 웹플레이어의 '스크립트' 패널과 같은 데이터를 내부 player 엔드포인트로 가져온다.
// Data API 의 captions.download 는 영상 소유자 OAuth 가 필요해 남의 영상엔 못 쓰므로 이 방식이 표준.
// API 키/할당량 불필요.

// URL/ID → 11자 영상 ID
export function parseVideoId(input: string): string | null {
  const s = (input || '').trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = s.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i)
  return m ? m[1] : null
}

type CaptionTrack = { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string; runs?: { text: string }[] } }
type PlayerMeta = { title: string; channel: string; tracks: CaptionTrack[] }

// 1차: innertube player 엔드포인트 (ANDROID 클라이언트 — 로그인/키 불필요)
async function playerMeta(videoId: string): Promise<PlayerMeta | null> {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'ko', gl: 'KR' } },
      videoId
    })
  }).catch(() => null)
  const j = r && r.ok ? await r.json().catch(() => null) : null
  if (!j) return null
  const status = j.playabilityStatus && j.playabilityStatus.status
  if (status && status !== 'OK') {
    const reason = (j.playabilityStatus && j.playabilityStatus.reason) || status
    throw new Error('영상을 열 수 없어요: ' + reason)
  }
  const vd = j.videoDetails || {}
  const tracks: CaptionTrack[] = (j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks) || []
  return { title: vd.title || '', channel: vd.author || '', tracks }
}

// 2차 폴백: watch 페이지 HTML에서 captionTracks JSON 을 직접 추출
async function watchPageMeta(videoId: string): Promise<PlayerMeta | null> {
  const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36',
      'accept-language': 'ko,en;q=0.8'
    }
  }).catch(() => null)
  const html = r && r.ok ? await r.text().catch(() => '') : ''
  if (!html) return null
  const cm = html.match(/"captionTracks":(\[.*?\])(?=,")/)
  let tracks: CaptionTrack[] = []
  if (cm) {
    try {
      tracks = JSON.parse(cm[1])
    } catch {
      tracks = []
    }
  }
  const tm = html.match(/<title>(.*?)<\/title>/)
  const title = tm ? tm[1].replace(/\s*-\s*YouTube\s*$/, '').trim() : ''
  const am = html.match(/"author":"((?:[^"\\]|\\.)*)"/)
  let channel = ''
  if (am) {
    try {
      channel = JSON.parse('"' + am[1] + '"')
    } catch {
      channel = am[1]
    }
  }
  return { title, channel, tracks }
}

function trackName(t: CaptionTrack): string {
  return (t.name && (t.name.simpleText || (t.name.runs || []).map((r) => r.text).join(''))) || t.languageCode
}

// 트랙 선택: 요청 언어 → ko → 수동(비 ASR) 첫 트랙 → 첫 트랙
function pickTrack(tracks: CaptionTrack[], lang?: string): CaptionTrack | null {
  if (!tracks.length) return null
  const manualFirst = (arr: CaptionTrack[]) => arr.find((t) => t.kind !== 'asr') || arr[0]
  if (lang) {
    const exact = tracks.filter((t) => t.languageCode === lang)
    if (exact.length) return manualFirst(exact)
  }
  const ko = tracks.filter((t) => t.languageCode === 'ko')
  if (ko.length) return manualFirst(ko)
  return manualFirst(tracks)
}

// 자막 트랙 URL → 문장 목록 (json3 이벤트 파싱)
async function fetchSegments(baseUrl: string): Promise<YoutubeTranscriptSegment[]> {
  const url = baseUrl + (baseUrl.includes('fmt=') ? '' : '&fmt=json3')
  const r = await fetch(url, { headers: { 'accept-language': 'ko,en;q=0.8' } })
  if (r.status === 429) throw new Error('요청이 많아 유튜브가 잠시 제한했어요. 1~2분 후 다시 시도해 주세요.')
  if (!r.ok) throw new Error('자막 다운로드 실패 (HTTP ' + r.status + ')')
  const j = await r.json().catch(() => null)
  const events: any[] = (j && j.events) || []
  const out: YoutubeTranscriptSegment[] = []
  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs)) continue
    const text = ev.segs.map((s: any) => (s && s.utf8) || '').join('').replace(/\n/g, ' ').trim()
    if (!text) continue
    out.push({ start: Math.round((ev.tStartMs || 0) / 100) / 10, dur: Math.round((ev.dDurationMs || 0) / 100) / 10, text })
  }
  return out
}

// 3차 폴백: yt-dlp (설치되어 있으면). 유튜브가 익명 요청을 봇으로 차단하는 네트워크에서는
// 크롬 쿠키(--cookies-from-browser chrome)를 빌려 통과한다. 트랙의 서명된 URL 은 이후 일반 fetch 로 다운로드 가능.
function ytDlpBin(): string | null {
  const cands = [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    join(process.env.HOME || '', '.local/bin/yt-dlp')
  ]
  for (const c of cands) if (c && existsSync(c)) return c
  return null
}

// 패키징된 GUI 앱은 PATH 가 /usr/bin:/bin 수준이라 yt-dlp 가 JS 런타임(node/deno)을 못 찾고
// 유튜브 챌린지 해석에 실패한다(포맷 0개 → 추출 실패). 홈브류 등 표준 경로를 PATH 에 보강한다.
function ytDlpEnv(): NodeJS.ProcessEnv {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(process.env.HOME || '', '.local/bin')]
  const cur = (process.env.PATH || '').split(':')
  return { ...process.env, PATH: [...cur, ...extra.filter((p) => p && !cur.includes(p))].join(':') }
}

async function ytDlpMeta(videoId: string): Promise<PlayerMeta | null> {
  const bin = ytDlpBin()
  if (!bin) return null
  const url = 'https://www.youtube.com/watch?v=' + videoId
  const exec = promisify(execFile)
  const run = async (extra: string[]): Promise<any> => {
    // --ignore-no-formats-error: 자막 메타만 필요하므로 포맷이 없어도(JS 런타임 부재 등) JSON 을 받는다
    const { stdout } = await exec(bin, ['--no-warnings', '--skip-download', '--ignore-no-formats-error', '-J', ...extra, url], { maxBuffer: 128 * 1024 * 1024, timeout: 120000, env: ytDlpEnv() })
    return JSON.parse(stdout)
  }
  let j: any = null
  try {
    j = await run(['--cookies-from-browser', 'chrome'])
  } catch {
    // 크롬 미설치/키체인 거부 등이면 쿠키 없이 한 번 더
    j = await run([]).catch(() => null)
  }
  if (!j) return null

  const manual: Record<string, any[]> = j.subtitles || {}
  const auto: Record<string, any[]> = j.automatic_captions || {}
  const json3Url = (entries: any[]): string => {
    const e = (entries || []).find((x) => x && x.ext === 'json3') || (entries || [])[0]
    return (e && e.url) || ''
  }
  const tracks: CaptionTrack[] = []
  const seen = new Set<string>()
  const push = (lang: string, entries: any[], asr: boolean) => {
    const u = json3Url(entries)
    if (!u || seen.has(lang)) return
    seen.add(lang)
    const label = ((entries || [])[0] && (entries || [])[0].name) || lang
    tracks.push({ baseUrl: u, languageCode: lang, kind: asr ? 'asr' : undefined, name: { simpleText: asr ? label + ' (자동)' : label } })
  }
  for (const [lang, entries] of Object.entries(manual)) push(lang, entries, false)
  // 자동 자막은 번역본이 100개+ 라 원어(-orig) + 주요 언어만 노출
  for (const [key, entries] of Object.entries(auto)) if (key.endsWith('-orig')) push(key.replace(/-orig$/, ''), entries, true)
  for (const lang of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) if (auto[lang]) push(lang, auto[lang], true)
  return { title: j.title || '', channel: j.channel || j.uploader || '', tracks }
}

// 영상별 메타 캐시 — 언어 전환 시 재조회(특히 yt-dlp 수 초) 방지
const metaCache = new Map<string, PlayerMeta>()

export async function youtubeTranscript(opts: YoutubeTranscriptOpts): Promise<YoutubeTranscriptResult> {
  const videoId = parseVideoId(opts.url || '')
  if (!videoId) throw new Error('유튜브 영상 URL이 아니에요. (예: https://www.youtube.com/watch?v=XXXXXXXXXXX)')

  // innertube → watch 페이지 → yt-dlp(크롬 쿠키) 순서로 시도
  let meta: PlayerMeta | null = metaCache.get(videoId) || null
  let playerErr = ''
  if (!meta || !meta.tracks.length) {
    try {
      meta = await playerMeta(videoId)
    } catch (e) {
      playerErr = e instanceof Error ? e.message : String(e)
      console.warn('[YT transcript] player 실패:', playerErr)
    }
  }
  if (!meta || !meta.tracks.length) {
    const fb = await watchPageMeta(videoId).catch(() => null)
    if (fb && (fb.tracks.length || !meta)) meta = { ...fb, title: fb.title || (meta ? meta.title : ''), channel: fb.channel || (meta ? meta.channel : '') }
  }
  if (!meta || !meta.tracks.length) {
    const dlp = await ytDlpMeta(videoId).catch((e) => {
      console.warn('[YT transcript] yt-dlp 실패:', e instanceof Error ? e.message : e)
      return null
    })
    if (dlp) meta = dlp
  }
  if (!meta) throw new Error('영상 정보를 가져오지 못했어요. 네트워크 상태를 확인해 주세요.' + (playerErr ? ` (${playerErr})` : ''))
  if (!meta.tracks.length) {
    // 봇 차단으로 트랙을 못 받은 것인지, 진짜 자막이 없는 것인지 구분해 안내
    if (playerErr && !ytDlpBin()) throw new Error('유튜브가 요청을 차단했어요. 터미널에서 `brew install yt-dlp` 후 다시 시도해 보세요.')
    throw new Error('이 영상에는 스크립트(자막)가 없어요.')
  }
  metaCache.set(videoId, meta)
  if (metaCache.size > 20) metaCache.delete(metaCache.keys().next().value as string)

  const track = pickTrack(meta.tracks, opts.lang)
  if (!track || !track.baseUrl) throw new Error('사용 가능한 자막 트랙을 찾지 못했어요.')
  const segments = await fetchSegments(track.baseUrl)
  if (!segments.length) throw new Error('자막 내용이 비어 있어요.')

  const tracks: YoutubeTranscriptTrack[] = meta.tracks.map((t) => ({ lang: t.languageCode, name: trackName(t), auto: t.kind === 'asr' }))
  return {
    videoId,
    title: meta.title,
    channel: meta.channel,
    url: 'https://www.youtube.com/watch?v=' + videoId,
    tracks,
    lang: track.languageCode,
    segments
  }
}

// ── 영상 로컬 다운로드 (스크립트 분석기 플레이어용) ─────────
// 임베드 플레이어는 봇 차단 네트워크에서 "로그인하여 봇이 아님을 확인하세요"로 재생이 막히므로,
// yt-dlp(크롬 쿠키)로 로컬에 받아 브릿지 서버 /media/<file> (Range 지원)로 스트리밍 재생한다.
// imported/ 폴더에 두지만 index.json 에 등록하지 않으므로 갤러리에는 나타나지 않는다.
export async function youtubeVideoFile(url: string): Promise<{ file: string }> {
  const videoId = parseVideoId(url || '')
  if (!videoId) throw new Error('유튜브 영상 URL이 아니에요.')
  const dir = join(app.getPath('userData'), 'imported')
  await fsp.mkdir(dir, { recursive: true })
  const file = `yt_${videoId}.mp4`
  const out = join(dir, file)
  if (existsSync(out)) return { file }

  const bin = ytDlpBin()
  if (!bin) throw new Error('영상 재생에는 yt-dlp 가 필요해요. 터미널에서 `brew install yt-dlp` 후 다시 시도해 주세요.')
  const exec = promisify(execFile)
  const run = (cookies: boolean) =>
    exec(
      bin,
      [
        '--no-warnings',
        ...(cookies ? ['--cookies-from-browser', 'chrome'] : []),
        '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', FFMPEG,
        '-o', out,
        'https://www.youtube.com/watch?v=' + videoId
      ],
      { timeout: 600000, maxBuffer: 32 * 1024 * 1024, env: ytDlpEnv() }
    )
  try {
    await run(true)
  } catch (firstErr) {
    // 크롬 미설치/키체인 거부 등이면 쿠키 없이 한 번 더
    try {
      await run(false)
    } catch {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)
      const line = (msg.match(/ERROR:[^\n]*/g) || []).pop() || msg.slice(0, 300)
      throw new Error('영상 다운로드 실패: ' + line)
    }
  }
  if (!existsSync(out)) throw new Error('영상 다운로드에 실패했어요.')

  // 캐시 정리: 방금 파일 제외 yt_*.mp4 를 오래된 순으로 지워 최근 10개만 유지
  const names = (await fsp.readdir(dir)).filter((n) => n.startsWith('yt_') && n.endsWith('.mp4') && n !== file)
  if (names.length > 9) {
    const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fsp.stat(join(dir, n))).mtimeMs })))
    stats.sort((a, b) => a.t - b.t)
    for (const s of stats.slice(0, stats.length - 9)) await fsp.rm(join(dir, s.n), { force: true }).catch(() => {})
  }
  return { file }
}

// ── 채널 상세 분석 (luha-master 등급/수익/참여/업로드 패턴 이식) ──
function gradeOf(score: number): string {
  if (score >= 90) return 'S+'
  if (score >= 85) return 'S'
  if (score >= 80) return 'A+'
  if (score >= 75) return 'A'
  if (score >= 70) return 'B+'
  if (score >= 60) return 'B'
  if (score >= 50) return 'C+'
  if (score >= 40) return 'C'
  return 'D'
}
function subscriberScore(s: number): number {
  if (s >= 10000000) return 25
  if (s >= 1000000) return 22
  if (s >= 500000) return 20
  if (s >= 100000) return 18
  if (s >= 50000) return 15
  if (s >= 10000) return 12
  if (s >= 1000) return 8
  if (s >= 100) return 5
  return Math.min(s / 20, 3)
}
function viewScore(avg: number): number {
  if (avg >= 1000000) return 25
  if (avg >= 500000) return 22
  if (avg >= 100000) return 20
  if (avg >= 50000) return 18
  if (avg >= 10000) return 15
  if (avg >= 5000) return 12
  if (avg >= 1000) return 8
  if (avg >= 100) return 5
  return Math.min(avg / 20, 3)
}
function engagementScore(rate: number): number {
  if (rate >= 10) return 25
  if (rate >= 5) return 22
  if (rate >= 3) return 20
  if (rate >= 2) return 18
  if (rate >= 1) return 15
  if (rate >= 0.5) return 12
  if (rate >= 0.2) return 8
  if (rate >= 0.1) return 5
  return Math.min(rate * 25, 3)
}
function cvScore(views: number[]): number {
  if (views.length < 5) return 5
  const recent = views.slice(0, 10)
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length
  if (mean <= 0) return 5
  const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length
  const cv = Math.sqrt(variance) / mean
  if (cv <= 0.3) return 15
  if (cv <= 0.5) return 12
  if (cv <= 0.8) return 10
  if (cv <= 1.2) return 7
  return 5
}
function growthScore(publishedAt: string, subs: number, videoCount: number): number {
  const ageYears = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 365)
  if (!(ageYears > 0)) return 5
  const subsPerYear = subs / ageYears
  const vidsPerYear = videoCount / ageYears
  let g = 0
  if (subsPerYear >= 1000000) g += 6
  else if (subsPerYear >= 100000) g += 5
  else if (subsPerYear >= 10000) g += 4
  else if (subsPerYear >= 1000) g += 3
  else if (subsPerYear >= 100) g += 2
  else g += 1
  if (vidsPerYear >= 100) g += 4
  else if (vidsPerYear >= 52) g += 3
  else if (vidsPerYear >= 24) g += 2
  else if (vidsPerYear >= 12) g += 1
  return Math.min(g, 10)
}

export async function analyzeChannel(opts: YoutubeChannelOpts): Promise<YoutubeChannelAnalysis> {
  const key = (await loadKeys()).youtube
  if (!key) throw new Error('설정에서 YouTube API 키를 등록하세요.')
  const raw = (opts.channel || '').trim()
  if (!raw) throw new Error('채널을 지정하세요.')
  const max = Math.min(Math.max(opts.max || 50, 5), 100)

  const channelId = await resolveChannelId(key, raw)
  if (!channelId) throw new Error('채널을 찾지 못했어요: ' + raw)
  const core = await getChannelCore(key, channelId)
  if (!core) throw new Error('채널 정보를 가져오지 못했어요.')

  const ids = core.uploads ? await collectUploadIds(key, core.uploads, max) : []
  const raws = ids.length ? await fetchVideos(key, ids) : []
  const videos = raws.map((v) => toVideo(v, core.subscribers))

  // 참여 지표(분석 영상 평균)
  const n = videos.length || 1
  const avgLikeRate = videos.reduce((a, v) => a + (v.likeRate || 0), 0) / n
  const avgCommentRate = videos.reduce((a, v) => a + (v.commentRate || 0), 0) / n
  const avgViewsPerVideo = core.videoCount > 0 ? core.totalViews / core.videoCount : videos.reduce((a, v) => a + v.views, 0) / n
  const subViewRate = core.subscribers > 0 ? Math.round((avgViewsPerVideo / core.subscribers) * 1000) / 10 : 0

  // 등급
  const sScore = subscriberScore(core.subscribers)
  const vScore = viewScore(avgViewsPerVideo)
  const eScore = engagementScore(avgLikeRate + avgCommentRate)
  const cScore = cvScore(videos.map((v) => v.views))
  const gScore = growthScore(core.publishedAt, core.subscribers, core.videoCount)
  const score = Math.round(sScore + vScore + eScore + cScore + gScore)

  // 수익 — 최근 30일 업로드분 합산 → 월/연
  const cut30 = Date.now() - 30 * 86400000
  const recent30 = videos.filter((v) => new Date(v.publishedAt).getTime() >= cut30)
  const sumRev = (arr: YoutubeVideo[]) =>
    arr.reduce((acc, v) => ({ min: acc.min + (v.estRevenue?.min || 0), max: acc.max + (v.estRevenue?.max || 0) }), { min: 0, max: 0 })
  const monthly = sumRev(recent30)
  const perVid = videos.length ? { min: Math.round(sumRev(videos).min / videos.length), max: Math.round(sumRev(videos).max / videos.length) } : { min: 0, max: 0 }

  // 업로드 패턴
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dayCount: Record<string, number> = {}
  for (const v of videos) {
    const d = new Date(v.publishedAt)
    if (!isNaN(d.getTime())) dayCount[days[d.getDay()]] = (dayCount[days[d.getDay()]] || 0) + 1
  }
  const mostActiveDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
  const now = Date.now()
  const perWeek = videos.filter((v) => now - new Date(v.publishedAt).getTime() < 7 * 86400000).length
  const perMonth = videos.filter((v) => now - new Date(v.publishedAt).getTime() < 30 * 86400000).length
  const lastUpload = videos[0]?.publishedAt || ''

  return {
    channelId,
    title: core.title,
    handle: core.handle,
    thumbnail: core.thumb,
    description: core.description,
    subscribers: core.subscribers,
    totalViews: core.totalViews,
    videoCount: core.videoCount,
    publishedAt: core.publishedAt,
    rating: {
      score,
      grade: gradeOf(score),
      breakdown: {
        subscriber: Math.round(sScore),
        view: Math.round(vScore),
        engagement: Math.round(eScore),
        consistency: Math.round(cScore),
        growth: Math.round(gScore)
      }
    },
    revenue: { monthly, yearly: { min: monthly.min * 12, max: monthly.max * 12 }, perVideoAvg: perVid },
    engagement: {
      avgLikeRate: Math.round(avgLikeRate * 100) / 100,
      avgCommentRate: Math.round(avgCommentRate * 100) / 100,
      avgViewsPerVideo: Math.round(avgViewsPerVideo),
      subViewRate
    },
    upload: { perWeek, perMonth, mostActiveDay, lastUpload },
    videos,
    quotaUsed
  }
}
