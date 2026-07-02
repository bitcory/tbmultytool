import type { YoutubeSearchOpts, YoutubeVideo, YoutubeChannelAnalysis, YoutubeChannelOpts } from '@shared/types'
import { loadKeys } from '../secrets'

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

// ── 키워드/채널 검색 ──────────────────────────────────────
export async function youtubeSearch(opts: YoutubeSearchOpts): Promise<YoutubeVideo[]> {
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
  }
  if (!ids.length) return []

  const vids = await fetchVideos(key, ids)
  const subsMap = await fetchSubs(key, vids.map((v) => v.channelId))
  return vids.map((v) => toVideo(v, subsMap[v.channelId] ?? 0))
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
