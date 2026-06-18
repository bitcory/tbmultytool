// 스크롤영상 — 편집 가능한 레이아웃 모델 + 한글 텍스트/장식 PNG 렌더(렌더러 Canvas).
// 미리보기는 DOM(ScrollVideo.tsx)에서 이 모델로 그리고, 생성 시 여기서 PNG 로 래스터화해
// ScrollRenderSpec 을 만들어 메인(ffmpeg)으로 보낸다. 폰트는 앱 기본(Paperlogy)으로 통일.
import type { ScrollRenderSpec, ScrollRect } from '@shared/types'

const FONT_FAMILY = "'Paperlogy', 'Apple SD Gothic Neo', sans-serif"
export const COLORS = { bg: '#0f1115', border: '#2c313c', text: '#e6e9ef' }

export type Aspect = '9:16' | '16:9' | '1:1'
export const ASPECTS: Record<Aspect, [number, number]> = {
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
  '1:1': [1080, 1080]
}

export type Align = 'left' | 'center'

// 제목용 폰트 목록 (카드뉴스와 동일, css 이름은 styles.css @font-face 와 매칭)
export const FONTS: { label: string; css: string }[] = [
  { label: '페이퍼로지 (기본)', css: 'Paperlogy' },
  { label: '프리텐다드', css: 'Pretendard' },
  { label: '검은고딕', css: 'BlackHanSans' },
  { label: '카페24 써라운드', css: 'Cafe24Ssurround' },
  { label: '고도 B', css: 'GodoB' },
  { label: '고운돋움', css: 'GowunDodum' },
  { label: '레시피코리아', css: 'Recipekorea' },
  { label: '리아산스', css: 'RiaSansEB' },
  { label: '아리따부리', css: 'AritaBuriBold' },
  { label: '프리젠테이션', css: 'Freesentation' },
  { label: 'MBC1961 굴림', css: 'MBC1961Gulim' },
  { label: 'Swagger (영문)', css: 'Swagger' },
  { label: 'Palladium (영문)', css: 'Palladium' }
]

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 편집 가능한 스크롤영상 레이아웃(전부 풀해상도 px). 미리보기/렌더가 공유. */
export interface ScrollLayout {
  aspect: Aspect
  W: number
  H: number
  bg: string
  radius: number
  border: number
  titleSize: number
  titleY: number // 제목 상단 y (가로는 항상 가운데)
  safeTop: number // 쇼츠 상단 데드존 가이드 높이 (미리보기 전용, 제목과 독립)
  titleFont: string // 제목/부제목 폰트 css 이름
  titleColor: string // 제목 색
  subtitleSize: number // 부제목 크기
  subtitleColor: string // 부제목 색
  titleGap: number // 제목과 부제목 사이 간격(px)
  hasMedia: boolean
  video: Box // 영상 외곽 박스
  videoFit: 'contain' | 'cover' // 원본비율(여백) / 꽉채움(잘림)
  videoZoom: number // 확대 배율(cover에서 박힌 레터박스 크롭용). 기본 1
  vPadX: number // 영상 박스 좌우 여백
  vPadY: number // 영상 박스 상하 여백
  hasImage: boolean // 별도 이미지 레이어
  image: Box // 별도 이미지 외곽 박스
  imgPadX: number
  imgPadY: number
  imageZoom: number // 창 안에서 이미지 확대 배율(중앙 기준). 기본 1=전체 보임
  imageBordered: boolean // true=박스(테두리) 안 / false=그냥 배치(테두리 없음)
  section: Box // 텍스트 섹션 외곽 박스
  sectionBordered: boolean // true=텍스트창 테두리선 표시 / false=없음
  textSize: number
  lineSpacing: number
  align: Align
  padX: number // 섹션 좌우 여백(텍스트 안쪽)
  padY: number // 섹션 상하 여백
  speedPx: number // 스크롤 속도 px/s
}

const round = Math.round

/** 비율/미디어/제목 유무로 기본 레이아웃 계산(scroll_video.py 비율 그대로). */
export function autoLayout(aspect: Aspect, hasMedia: boolean, hasTitle: boolean): ScrollLayout {
  const [W, H] = ASPECTS[aspect]
  const margin = round(0.028 * W)
  const gap = round(0.018 * H)
  const pad = round(0.03 * W)
  const radius = round(0.022 * W)
  // 9:16(쇼츠)은 상단 데드존(UI 가림) 아래로 제목을 내림
  const titleY = aspect === '9:16' ? round(0.085 * H) : round(0.03 * H)
  const contentW = W - 2 * margin
  const titleSize = 64
  const titleLineH = round(titleSize * 1.25)
  const titleBottom = hasTitle ? titleY + titleLineH : margin

  // 영상 창은 4:3 고정 프레임(영상 비율과 무관). 영상은 cover로 창을 꽉 채움.
  const videoH = round((contentW * 3) / 4)
  let video: Box = { x: margin, y: titleBottom + gap, w: contentW, h: videoH }
  let secTop: number
  if (hasMedia) {
    secTop = video.y + video.h + gap
  } else {
    secTop = titleBottom + gap
    video = { x: margin, y: titleBottom + gap, w: contentW, h: videoH } // 보관용(미사용)
  }
  const section: Box = { x: margin, y: secTop, w: contentW, h: H - margin - secTop }
  // 별도 이미지 기본 박스: 화면 가운데 정사각(가로의 절반). 사용자가 드래그/리사이즈.
  const isz = round(0.5 * W)
  const image: Box = { x: round((W - isz) / 2), y: round((H - isz) / 2), w: isz, h: isz }

  return {
    aspect,
    W,
    H,
    bg: COLORS.bg,
    radius,
    border: 3,
    titleSize,
    titleY,
    safeTop: round(0.085 * H), // 쇼츠 상단 데드존 기본값
    titleFont: 'Paperlogy',
    titleColor: '#ffffff',
    subtitleSize: 38,
    subtitleColor: '#cfd6e4',
    titleGap: round(38 * 0.55), // 제목-부제목 기본 간격 (≈21px)
    hasMedia,
    video,
    videoFit: 'cover',
    videoZoom: 1,
    vPadX: 0,
    vPadY: 0,
    hasImage: false,
    image,
    imgPadX: 0,
    imgPadY: 0,
    imageZoom: 1,
    imageBordered: true,
    section,
    sectionBordered: true,
    textSize: 46,
    lineSpacing: 1.5,
    align: 'left',
    padX: pad,
    padY: pad,
    speedPx: 80
  }
}

/** 레이아웃을 다른 비율로 옮길 때 박스를 비례 변환(편집값 보존). */
export function rescaleLayout(L: ScrollLayout, aspect: Aspect): ScrollLayout {
  const [W, H] = ASPECTS[aspect]
  const sx = W / L.W
  const sy = H / L.H
  const sb = (b: Box): Box => ({
    x: round(b.x * sx),
    y: round(b.y * sy),
    w: round(b.w * sx),
    h: round(b.h * sy)
  })
  return {
    ...L,
    aspect,
    W,
    H,
    radius: round(L.radius * sx),
    titleY: round(L.titleY * sy),
    safeTop: round((L.safeTop ?? 0.085 * L.H) * sy),
    video: sb(L.video),
    image: sb(L.image),
    section: sb(L.section),
    padX: round(L.padX * sx),
    padY: round(L.padY * sy),
    vPadX: round(L.vPadX * sx),
    vPadY: round(L.vPadY * sy),
    imgPadX: round(L.imgPadX * sx),
    imgPadY: round(L.imgPadY * sy),
    textSize: round(L.textSize * sy),
    titleSize: round(L.titleSize * sy),
    subtitleSize: round(L.subtitleSize * sy),
    titleGap: round((L.titleGap ?? round(L.subtitleSize * 0.55)) * sy)
  }
}

/** 미디어(영상/이미지) 가로:세로 비율(w/h) 읽기 */
export function getMediaAspect(dataUrl: string, isVideo: boolean): Promise<number> {
  return new Promise((resolve) => {
    if (isVideo) {
      const v = document.createElement('video')
      v.onloadedmetadata = () => resolve(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9)
      v.onerror = () => resolve(16 / 9)
      v.src = dataUrl
    } else {
      const im = new Image()
      im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1)
      im.onerror = () => resolve(1)
      im.src = dataUrl
    }
  })
}

async function ensureFonts(sizes: number[], families: string[] = ['Paperlogy']): Promise<void> {
  try {
    const jobs: Promise<unknown>[] = []
    for (const fam of families) {
      for (const s of sizes) jobs.push((document as Document).fonts.load(`${Math.round(s)}px '${fam}'`))
    }
    await Promise.all(jobs)
    await (document as Document).fonts.ready
  } catch {
    /* fallback */
  }
}

function newCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

/** scroll_video.py wrap_text 포팅: 한글은 글자 단위, 공백 있으면 단어 경계 우선. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')
      continue
    }
    let cur = ''
    for (const ch of paragraph) {
      const test = cur + ch
      if (ctx.measureText(test).width <= maxWidth || cur === '') {
        cur = test
      } else if (cur.includes(' ') && ch !== ' ') {
        const i = cur.lastIndexOf(' ')
        lines.push(cur.slice(0, i))
        cur = cur.slice(i + 1) + ch
      } else {
        lines.push(cur)
        cur = ch
      }
    }
    lines.push(cur)
  }
  return lines
}

function renderTextPng(
  text: string,
  fontPx: number,
  lineH: number,
  wrapWidth: number,
  color: string,
  align: Align
): { dataUrl: string; height: number } {
  const probe = newCanvas(10, 10).ctx
  probe.font = `${fontPx}px ${FONT_FAMILY}`
  const lines = wrapText(probe, text, wrapWidth)
  // 글자 위/아래가 잘리지 않도록 상하 여백(pad) 확보 — textBaseline 'top' 이라도 일부 폰트는 윗부분이 살짝 넘침.
  const pad = Math.ceil(fontPx * 0.22)
  const height = Math.max(lineH * lines.length, lineH) + pad * 2
  const { c, ctx } = newCanvas(wrapWidth, height)
  ctx.font = `${fontPx}px ${FONT_FAMILY}`
  ctx.textBaseline = 'top'
  let y = pad
  for (const line of lines) {
    if (line) {
      const x = align === 'center' ? (wrapWidth - ctx.measureText(line).width) / 2 : 0
      ctx.fillStyle = 'rgba(0,0,0,0.63)'
      ctx.fillText(line, x + 2, y + 2)
      ctx.fillStyle = color
      ctx.fillText(line, x, y)
    }
    y += lineH
  }
  return { dataUrl: c.toDataURL('image/png'), height }
}

// 스크롤 텍스트 가장자리 페이드용 그레이 마스크(가운데 흰색=불투명, 위/아래 가장자리 검정=투명).
// ffmpeg 에서 텍스트 알파에 곱해(blend multiply) 글자가 가장자리에서 투명하게 사라지게 한다.
// (배경색을 덧칠하던 옛 방식은 영상 위에서 검은 띠로 보였음)
function renderFadeMaskPng(w: number, h: number, fadeH: number): string {
  const { c, ctx } = newCanvas(w, h)
  const f = Math.max(1, Math.min(fadeH, Math.floor(h / 2)))
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const top = ctx.createLinearGradient(0, 0, 0, f)
  top.addColorStop(0, '#000000')
  top.addColorStop(1, '#ffffff')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, w, f)
  const bot = ctx.createLinearGradient(0, h - f, 0, h)
  bot.addColorStop(0, '#ffffff')
  bot.addColorStop(1, '#000000')
  ctx.fillStyle = bot
  ctx.fillRect(0, h - f, w, f)
  return c.toDataURL('image/png')
}

function renderFramePng(
  W: number,
  H: number,
  boxes: ScrollRect[],
  radius: number,
  borderColor: string,
  thickness: number
): string {
  const { c, ctx } = newCanvas(W, H)
  ctx.strokeStyle = borderColor
  ctx.lineWidth = thickness
  for (const b of boxes) {
    ctx.beginPath()
    ctx.roundRect(b.x + thickness / 2, b.y + thickness / 2, b.w - thickness, b.h - thickness, radius)
    ctx.stroke()
  }
  return c.toDataURL('image/png')
}

/** 박스 둥근 모서리 알파 마스크: 흰 라운드 사각형 / 검은 배경. */
function renderRoundMaskPng(w: number, h: number, radius: number): string {
  const { c, ctx } = newCanvas(w, h)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, Math.min(radius, w / 2, h / 2))
  ctx.fill()
  return c.toDataURL('image/png')
}

/** 섹션 안쪽(텍스트가 흐르는) 영역 */
export function innerSection(L: ScrollLayout): Box {
  return {
    x: L.section.x + L.padX,
    y: L.section.y + L.padY,
    w: Math.max(10, L.section.w - 2 * L.padX),
    h: Math.max(10, L.section.h - 2 * L.padY)
  }
}

export interface ScrollContent {
  text: string
  title: string
  subtitle: string
  media?: { path?: string; dataUrl?: string; isVideo: boolean } // 상단 영상/이미지
  image?: { dataUrl: string } // 별도 이미지
}

/** 제목 + 부제목을 하나의 PNG 로 (가운데 정렬, 지정 폰트/색). */
function renderTitleBlock(
  title: string,
  subtitle: string,
  tSize: number,
  sSize: number,
  tColor: string,
  sColor: string,
  fontCss: string,
  wrapWidth: number,
  gap: number
): { dataUrl: string; height: number } {
  const probe = newCanvas(10, 10).ctx
  const tLineH = round(tSize * 1.25)
  const sLineH = round(sSize * 1.4)
  probe.font = `700 ${tSize}px '${fontCss}'`
  const tLines = title.trim() ? wrapText(probe, title, wrapWidth) : []
  probe.font = `${sSize}px '${fontCss}'`
  const sLines = subtitle.trim() ? wrapText(probe, subtitle, wrapWidth) : []
  const pad = Math.ceil(tSize * 0.22)
  const gapTS = sLines.length && tLines.length ? Math.max(0, round(gap)) : 0
  const height = pad * 2 + tLines.length * tLineH + gapTS + sLines.length * sLineH
  const { c, ctx } = newCanvas(wrapWidth, height)
  ctx.textBaseline = 'top'
  let y = pad
  ctx.font = `700 ${tSize}px '${fontCss}'`
  for (const line of tLines) {
    const x = (wrapWidth - ctx.measureText(line).width) / 2
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillText(line, x + 2, y + 2)
    ctx.fillStyle = tColor
    ctx.fillText(line, x, y)
    y += tLineH
  }
  y += gapTS
  ctx.font = `${sSize}px '${fontCss}'`
  for (const line of sLines) {
    const x = (wrapWidth - ctx.measureText(line).width) / 2
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillText(line, x + 2, y + 2)
    ctx.fillStyle = sColor
    ctx.fillText(line, x, y)
    y += sLineH
  }
  return { dataUrl: c.toDataURL('image/png'), height }
}

/** 편집된 레이아웃 + 내용을 PNG 로 래스터화해 ScrollRenderSpec 생성. */
export async function renderSpecFromLayout(
  L: ScrollLayout,
  content: ScrollContent
): Promise<ScrollRenderSpec> {
  await ensureFonts([L.titleSize, L.textSize, L.subtitleSize], ['Paperlogy', L.titleFont])
  const inner = ((b) => ({ x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) }))(innerSection(L))
  const promptLineH = round(L.textSize * L.lineSpacing)
  const fadeH = round(0.05 * L.H)

  const boxes: ScrollRect[] = []
  // 드래그로 생긴 소수 좌표는 ffmpeg(color/overlay)가 거부하므로 정수로 반올림.
  const rb = (b: Box): ScrollRect => ({ x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) })

  const mediaLayers: ScrollRenderSpec['mediaLayers'] = []
  if (L.hasMedia && content.media) {
    const box = rb(L.video)
    boxes.push(box)
    mediaLayers.push({
      path: content.media.path,
      dataUrl: content.media.dataUrl,
      isVideo: content.media.isVideo,
      box,
      padX: round(L.vPadX),
      padY: round(L.vPadY),
      fit: L.videoFit,
      zoom: L.videoZoom,
      mask: renderRoundMaskPng(box.w, box.h, L.radius)
    })
  }
  if (L.hasImage && content.image) {
    const box = rb(L.image)
    if (L.imageBordered) boxes.push(box) // 테두리는 '박스 안'일 때만 그림
    mediaLayers.push({
      dataUrl: content.image.dataUrl,
      isVideo: false,
      box,
      padX: round(L.imgPadX),
      padY: round(L.imgPadY),
      // 박스를 꽉 채움(cover) + zoom 으로 중앙 확대·크롭 → 16:9 이미지를 16:4.5 박스에 넣으면 세로 절반만 보임.
      fit: 'cover',
      zoom: L.imageZoom ?? 1,
      // '그냥 배치'(테두리 없음)면 마스크 없이 PNG 투명도 그대로. '박스 안'이면 둥근 마스크.
      mask: L.imageBordered ? renderRoundMaskPng(box.w, box.h, L.radius) : undefined
    })
  }
  if (L.sectionBordered !== false) boxes.push(rb(L.section)) // 테두리는 켜져 있을 때만 (구 레이아웃=없음→있음)

  let titlePng: string | undefined
  const hasTitle = content.title.trim() !== '' || content.subtitle.trim() !== ''
  if (hasTitle) {
    titlePng = renderTitleBlock(
      content.title,
      content.subtitle,
      L.titleSize,
      L.subtitleSize,
      L.titleColor,
      L.subtitleColor,
      L.titleFont,
      round(L.section.w),
      L.titleGap ?? round(L.subtitleSize * 0.55)
    ).dataUrl
  }

  const txt = renderTextPng(content.text, L.textSize, promptLineH, inner.w, COLORS.text, L.align)
  const travel = inner.h + txt.height

  return {
    width: L.W,
    height: L.H,
    fps: 30,
    bg: L.bg,
    speed: L.speedPx,
    travel,
    mute: false,
    mediaLayers,
    section: inner,
    titleY: hasTitle ? round(L.titleY) : undefined,
    png: {
      text: txt.dataUrl,
      fade: renderFadeMaskPng(inner.w, inner.h, fadeH),
      frame: renderFramePng(L.W, L.H, boxes, L.radius, COLORS.border, L.border),
      title: titlePng
    }
  }
}
