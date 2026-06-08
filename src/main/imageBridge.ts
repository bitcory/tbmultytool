// 크롬 확장 → 앱 이미지 브릿지.
// 127.0.0.1 에서만 듣는 작은 HTTP 서버. 확장(background)이 여기로 이미지를 POST 하면
// 로컬 폴더에 저장하고 렌더러로 이벤트를 push 한다. 외부 노출 없음(로컬 전용).
import http from 'http'
import { promises as fs, createReadStream } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, net } from 'electron'
import type { BridgeInfo, BridgeJob, ImageSource, ImportedImage } from '@shared/types'

const PREFERRED_PORT = 47321
const MAX_BODY = 40 * 1024 * 1024 // 40MB

let server: http.Server | null = null
let port = PREFERRED_PORT
let dir = ''
let indexFile = ''
let items: ImportedImage[] = []
let notify: (img: ImportedImage) => void = () => {}
let debugEval: ((target: string, js: string) => Promise<unknown>) | null = null
export function setDebugEval(fn: (target: string, js: string) => Promise<unknown>): void {
  debugEval = fn
}

// ── 앱→확장 작업 큐 ─────────────────────────────────────────────────────
// 앱이 생성 작업을 큐에 넣으면, 사용자 크롬의 확장(content script)이 /poll 로 가져가
// 실제 로그인된 페이지에서 실행하고 결과를 /import + /job-status 로 돌려준다.
interface PendingJob {
  job: BridgeJob
  resolve: (r: { ok: boolean; message?: string }) => void
  timer: ReturnType<typeof setTimeout>
  taken: boolean
}
const jobQueue: PendingJob[] = []
const JOB_TIMEOUT_MS = 5 * 60 * 1000
let jobStatusNotify: (message: string) => void = () => {}
export function setJobStatusListener(cb: (message: string) => void): void {
  jobStatusNotify = cb
}

// 소스별 마지막 폴링 시각 — 확장 탭이 그 사이트를 폴링 중이면 새 탭 안 엶.
const lastPoll: Record<string, number> = {}
// 작업이 들어왔는데 해당 사이트를 폴링하는 탭이 없으면 진짜 크롬에서 사이트를 연다.
let siteOpener: (source: string) => void = () => {}
export function setSiteOpener(fn: (source: string) => void): void {
  siteOpener = fn
}
const POLL_FRESH_MS = 8000

/** 작업을 큐에 넣고, 확장이 완료/실패를 보고할 때 resolve 되는 Promise 를 반환. */
export function enqueueJob(input: Omit<BridgeJob, 'id'>): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    const job: BridgeJob = { id: crypto.randomUUID(), ...input }
    const timer = setTimeout(() => {
      const i = jobQueue.findIndex((p) => p.job.id === job.id)
      if (i >= 0) jobQueue.splice(i, 1)
      resolve({
        ok: false,
        message: '시간 초과 — 크롬에서 해당 사이트 탭이 열려있고 TB MTOOL 확장이 켜져있는지 확인하세요.'
      })
    }, JOB_TIMEOUT_MS)
    jobQueue.push({ job, resolve, timer, taken: false })
    jobStatusNotify(`크롬 확장에 ${job.source} 생성 작업 전달 — 크롬 탭에서 실행 대기 중…`)
    // 해당 사이트를 폴링하는 탭이 없으면(최근 폴링 없음) 크롬에서 사이트를 연다.
    if (Date.now() - (lastPoll[job.source] || 0) > POLL_FRESH_MS) {
      siteOpener(job.source)
      lastPoll[job.source] = Date.now() // 디바운스: 탭 로딩 동안 중복 오픈 방지
    }
  })
}

function takeJob(source: string): BridgeJob | null {
  const p = jobQueue.find((q) => !q.taken && q.job.source === source)
  if (!p) return null
  p.taken = true
  return p.job
}

function finishJob(id: string, ok: boolean, message?: string): void {
  const i = jobQueue.findIndex((p) => p.job.id === id)
  if (i < 0) return
  const [p] = jobQueue.splice(i, 1)
  clearTimeout(p.timer)
  p.resolve({ ok, message })
}

// 취소된 작업 id 집합 — 확장(실행 중인 content script)이 /job-canceled 로 확인해 즉시 중단.
const canceledJobs = new Set<string>()

/** 모든 대기/진행 작업 취소: 큐 비우고, 실행 중인 작업은 취소 표시(확장이 폴링해 중단). */
export function cancelAllJobs(): void {
  while (jobQueue.length) {
    const p = jobQueue.shift()!
    clearTimeout(p.timer)
    canceledJobs.add(p.job.id) // 실행 중일 수 있으니 취소 표시
    p.resolve({ ok: false, message: '취소됨' })
  }
  jobStatusNotify('생성을 정지했습니다.')
  // 메모리 보호: 오래된 취소 표시 정리(다음 작업 폴링에 영향 없도록 잠시 후)
  if (canceledJobs.size > 200) canceledJobs.clear()
}

function isJobCanceled(id: string): boolean {
  return canceledJobs.has(id)
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav'
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav'
}

// 저장된 미디어를 Range 지원으로 스트리밍 (영상 seek/썸네일 렌더에 필수)
async function serveMedia(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): Promise<void> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    json(res, 404, { ok: false, error: 'not found' })
    return
  }
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const type = EXT_MIME[ext] ?? 'application/octet-stream'
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] ? parseInt(m[1], 10) : 0
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return
    }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 })
    createReadStream(filePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Length': stat.size })
    createReadStream(filePath).pipe(res)
  }
}

function cors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  cors(res)
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function ensureDir(): Promise<void> {
  dir = path.join(app.getPath('userData'), 'imported')
  indexFile = path.join(dir, 'index.json')
  await fs.mkdir(dir, { recursive: true })
  try {
    items = JSON.parse(await fs.readFile(indexFile, 'utf-8'))
  } catch {
    items = []
  }
}

async function persistIndex(): Promise<void> {
  await fs.writeFile(indexFile, JSON.stringify(items, null, 2))
}

function normalizeSource(s: unknown): ImageSource {
  return s === 'chatgpt' || s === 'flow' || s === 'grok' || s === 'suno' ? s : 'other'
}

/** 임베드 창 세션 쿠키를 사용해 이미지 URL을 다운로드 (ChatGPT/Flow 인증 이미지용) */
function fetchWithEmbeddedSession(
  url: string
): Promise<{ status: number; mime: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, partition: 'persist:embedded', useSessionCookies: true })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.from(c)))
      res.on('end', () => {
        const ct = res.headers['content-type']
        const mime = String(Array.isArray(ct) ? ct[0] : ct || '')
          .split(';')[0]
          .toLowerCase()
        resolve({ status: res.statusCode, mime, buf: Buffer.concat(chunks) })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

/** dataUrl 또는 원격 url 로 이미지 바이트를 얻어 저장하고 메타를 반환 */
async function saveImage(payload: {
  source?: string
  dataUrl?: string
  url?: string
  filename?: string
  pageUrl?: string
}): Promise<ImportedImage> {
  let buf: Buffer
  let ext = 'png'

  if (payload.dataUrl && payload.dataUrl.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(payload.dataUrl)
    if (!m) throw new Error('잘못된 dataUrl')
    ext = MIME_EXT[m[1].toLowerCase()] ?? 'png'
    buf = Buffer.from(m[2], 'base64')
  } else if (payload.url) {
    // 임베드 창(ChatGPT/Flow)의 로그인 세션 쿠키를 그대로 써서 다운로드.
    // (쿠키 없는 일반 fetch 는 인증 이미지에서 403 이 난다)
    const r = await fetchWithEmbeddedSession(payload.url)
    if (r.status < 200 || r.status >= 300) throw new Error(`이미지 다운로드 실패: ${r.status}`)
    ext = MIME_EXT[r.mime] ?? 'png'
    buf = r.buf
  } else {
    throw new Error('dataUrl 또는 url 이 필요합니다')
  }

  const source = normalizeSource(payload.source)
  const id = crypto.randomUUID()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = payload.filename?.replace(/[^\w.-]/g, '_') || `${source}-${stamp}.${ext}`
  const filePath = path.join(dir, `${id}.${ext}`)
  await fs.writeFile(filePath, buf)

  const img: ImportedImage = {
    id,
    source,
    filename,
    path: filePath,
    pageUrl: payload.pageUrl,
    importedAt: new Date().toISOString()
  }
  items.unshift(img)
  await persistIndex()
  return img
}

/** HTTP·IPC 공통 진입점: 저장 후 렌더러로 알림. */
export async function importImage(payload: {
  source?: string
  dataUrl?: string
  url?: string
  filename?: string
  pageUrl?: string
}): Promise<ImportedImage> {
  const img = await saveImage(payload)
  notify(img)
  return img
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('이미지가 너무 큽니다'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

/** 서버 시작. onImport: 새 이미지가 들어올 때마다 호출(렌더러로 전달용). */
export async function startImageBridge(onImport: (img: ImportedImage) => void): Promise<BridgeInfo> {
  await ensureDir()
  notify = onImport

  server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      cors(res)
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'GET' && req.url === '/ping') {
      json(res, 200, { ok: true, app: 'ai-video-studio', port })
      return
    }
    if (req.method === 'POST' && req.url === '/debug') {
      try {
        const { target, js } = JSON.parse(await readBody(req))
        const result = debugEval ? await debugEval(target, js) : { error: 'no eval' }
        json(res, 200, { ok: true, result })
      } catch (err) {
        json(res, 200, { ok: false, error: String(err instanceof Error ? err.message : err) })
      }
      return
    }
    if (req.method === 'GET' && req.url && req.url.startsWith('/media/')) {
      const name = decodeURIComponent(req.url.slice('/media/'.length).split('?')[0])
      await serveMedia(req, res, path.join(dir, path.basename(name))) // basename: 경로 탈출 방지
      return
    }
    // 확장이 다음 작업을 가져감 — /poll?source=chatgpt
    if (req.method === 'GET' && req.url && req.url.startsWith('/poll')) {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams.get('source') || ''
      if (q) lastPoll[q] = Date.now() // 그 사이트 탭이 살아서 폴링 중임을 기록
      json(res, 200, { ok: true, job: takeJob(q) })
      return
    }
    // 실행 중인 작업이 취소됐는지 확인 — /job-canceled?id=xxx (확장이 폴링해 즉시 중단)
    if (req.method === 'GET' && req.url && req.url.startsWith('/job-canceled')) {
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id') || ''
      json(res, 200, { ok: true, canceled: isJobCanceled(id) })
      return
    }
    // 확장이 작업 진행/완료/실패를 보고 — { id, status:'progress'|'done'|'error', message? }
    if (req.method === 'POST' && req.url === '/job-status') {
      try {
        const { id, status, message } = JSON.parse(await readBody(req))
        if (message) jobStatusNotify(String(message))
        if (status === 'done') finishJob(String(id), true)
        else if (status === 'error') finishJob(String(id), false, message ? String(message) : '확장에서 생성 실패')
        json(res, 200, { ok: true })
      } catch (err) {
        json(res, 400, { ok: false, error: String(err instanceof Error ? err.message : err) })
      }
      return
    }
    if (req.method === 'POST' && req.url === '/import') {
      try {
        const payload = JSON.parse(await readBody(req))
        const img = await importImage(payload)
        json(res, 200, { ok: true, id: img.id })
      } catch (err) {
        json(res, 400, { ok: false, error: String(err instanceof Error ? err.message : err) })
      }
      return
    }
    json(res, 404, { ok: false, error: 'not found' })
  })

  // 선호 포트가 사용 중이면 다음 포트로 (최대 10회)
  await new Promise<void>((resolve, reject) => {
    let attempt = 0
    const tryListen = (p: number): void => {
      server!.once('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && attempt < 10) {
          attempt++
          tryListen(p + 1)
        } else {
          reject(e)
        }
      })
      server!.listen(p, '127.0.0.1', () => {
        port = p
        resolve()
      })
    }
    tryListen(PREFERRED_PORT)
  })

  return { port, dir, running: true }
}

export function getBridgeInfo(): BridgeInfo {
  return { port, dir, running: !!server }
}

export function listImported(): ImportedImage[] {
  return items
}

export async function clearImported(): Promise<void> {
  for (const it of items) {
    await fs.rm(it.path, { force: true }).catch(() => {})
  }
  items = []
  await persistIndex()
}

export async function removeImported(ids: string[]): Promise<void> {
  const set = new Set(ids)
  for (const it of items.filter((i) => set.has(i.id))) {
    await fs.rm(it.path, { force: true }).catch(() => {})
  }
  items = items.filter((i) => !set.has(i.id))
  await persistIndex()
}
