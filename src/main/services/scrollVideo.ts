// 스크롤영상 합성 — scroll_video.py(Pillow+ffmpeg)의 ffmpeg 파트를 Node 로 포팅.
// 한글 텍스트/장식 PNG 와 레이아웃은 렌더러(Canvas)가 만들어 ScrollRenderSpec 으로 넘겨주고,
// 여기서는 그 PNG 들을 임시 파일로 쓴 뒤 filter_complex 로 스크롤 합성·인코딩만 한다.
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { ScrollRenderSpec, ScrollRect } from '@shared/types'
import { FFMPEG, run, getDuration, hasAudioStream } from '../ffmpeg'

/** ffmpeg color 인자용: '#rrggbb' → '0xrrggbb' */
function normColor(c: string): string {
  return c.startsWith('#') ? '0x' + c.slice(1) : c
}

/** dataURL(base64) → Buffer */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('잘못된 dataURL')
  return Buffer.from(m[1], 'base64')
}

const EXT_FOR_DATAURL = (d: string): string => {
  const m = /^data:([^;]+);/.exec(d)
  const mime = (m?.[1] || '').toLowerCase()
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('quicktime') || mime.includes('mov')) return 'mov'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

/**
 * 스크롤영상을 렌더링하고 출력 mp4 경로를 반환한다.
 * onProgress 는 단계 메시지(렌더러 표시용).
 */
export async function renderScrollVideo(
  spec: ScrollRenderSpec,
  onProgress: (msg: string) => void = () => {}
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scroll-'))
  const written: string[] = []
  const write = async (name: string, dataUrl: string): Promise<string> => {
    const p = path.join(tmp, name)
    await fs.writeFile(p, dataUrlToBuffer(dataUrl))
    written.push(p)
    return p
  }

  try {
    onProgress('스크롤영상 준비 중…')
    const { width: W, height: H, fps } = spec
    const textPng = await write('text.png', spec.png.text)
    const fadePng = await write('fade.png', spec.png.fade)
    const framePng = await write('frame.png', spec.png.frame)
    const titlePng = spec.png.title ? await write('title.png', spec.png.title) : null

    // ── 미디어 레이어 입력 + 마스크 준비 ──
    interface LayerIn {
      idx: number
      maskIdx: number
      box: ScrollRect
      padX: number
      padY: number
      fit: 'contain' | 'cover'
      zoom: number
    }
    const layerIns: LayerIn[] = []
    const inputs: string[] = []
    let idx = 0
    let firstVideoIdx = -1
    let maxVideoDur = 0
    let anyAudio = false
    for (let i = 0; i < spec.mediaLayers.length; i++) {
      const L = spec.mediaLayers[i]
      let mpath: string | null = null
      if (L.path) mpath = L.path
      else if (L.dataUrl) mpath = await write(`media${i}.${EXT_FOR_DATAURL(L.dataUrl)}`, L.dataUrl)
      if (!mpath) continue
      if (L.isVideo) inputs.push('-stream_loop', '-1', '-i', mpath)
      else inputs.push('-loop', '1', '-i', mpath)
      const mIdx = idx++
      if (L.isVideo) {
        if (firstVideoIdx < 0) firstVideoIdx = mIdx
        const d = await getDuration(mpath).catch(() => 0)
        if (d > maxVideoDur) maxVideoDur = d
        if (await hasAudioStream(mpath)) anyAudio = true
      }
      let maskIdx = -1
      if (L.mask) {
        inputs.push('-loop', '1', '-i', await write(`mask${i}.png`, L.mask))
        maskIdx = idx++
      }
      layerIns.push({ idx: mIdx, maskIdx, box: L.box, padX: L.padX, padY: L.padY, fit: L.fit, zoom: L.zoom || 1 })
    }

    inputs.push('-loop', '1', '-i', textPng)
    const textIdx = idx++
    inputs.push('-loop', '1', '-i', fadePng)
    const fadeIdx = idx++
    inputs.push('-loop', '1', '-i', framePng)
    const frameIdx = idx++
    let titleIdx = -1
    if (titlePng) {
      inputs.push('-loop', '1', '-i', titlePng)
      titleIdx = idx++
    }

    // 스크롤 속도는 항상 사용자가 고른 자연 속도로 고정한다.
    // 영상이 있으면 영상 길이만큼(또는 최소 한 바퀴) 렌더하고, 텍스트는 mod() 로 계속 루프시킨다.
    const travel = Math.round(spec.travel)
    const textNatural = travel / spec.speed
    const speed = spec.speed
    const duration = maxVideoDur > 0 ? Math.max(maxVideoDur, textNatural) : textNatural

    // ── filter_complex 그래프 ──
    const bg = normColor(spec.bg)
    const fc: string[] = [`color=c=${bg}:s=${W}x${H}:r=${fps}[base]`]
    let cur = 'base'

    layerIns.forEach((L, i) => {
      const innerW = Math.max(2, L.box.w - 2 * L.padX)
      const innerH = Math.max(2, L.box.h - 2 * L.padY)
      // 박스 크기의 투명 캔버스를 만들고 그 위에 스케일한 미디어를 overlay 한다.
      // (pad 대신 overlay 를 쓰면 스케일 반올림으로 1px 초과해도 안전 — "padded smaller" 오류 방지)
      fc.push(`color=c=black@0.0:s=${L.box.w}x${L.box.h}:r=${fps},format=rgba[bgL${i}]`)
      if (L.fit === 'cover') {
        // 꽉채움: zoom 배율만큼 더 키워서(레터박스 크롭용) 안쪽 크기로 중앙 크롭 → 여백 위치에 배치
        const z = Math.max(1, L.zoom || 1)
        const zw = Math.round(innerW * z)
        const zh = Math.round(innerH * z)
        fc.push(
          `[${L.idx}:v]scale=${zw}:${zh}:force_original_aspect_ratio=increase,` +
            `crop=${innerW}:${innerH},setsar=1[sc${i}]`
        )
        fc.push(`[bgL${i}][sc${i}]overlay=${L.padX}:${L.padY}[ly${i}p]`)
      } else {
        // 원본비율(contain) + zoom: 안쪽 영역을 zoom배 한 크기에 맞춰 축소 → 박스 중앙 배치.
        // zoom 1이면 전체가 보이고(여백 투명), zoom>1이면 더 커져 overlay가 박스 밖을 잘라냄(중앙 크롭).
        const z = Math.max(1, L.zoom || 1)
        const tw = Math.round(innerW * z)
        const th = Math.round(innerH * z)
        fc.push(
          `[${L.idx}:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,setsar=1[sc${i}]`
        )
        fc.push(`[bgL${i}][sc${i}]overlay=(W-w)/2:(H-h)/2[ly${i}p]`)
      }
      if (L.maskIdx >= 0) {
        // 둥근 모서리: 원본 알파 × 마스크(곱)로 합성 → 투명 PNG 의 투명도를 보존하면서 모서리만 라운드.
        // (alphamerge 로 알파를 통째로 교체하면 투명 영역이 검게 채워지는 문제 방지)
        fc.push(`[ly${i}p]format=rgba,split[ly${i}a][ly${i}b]`)
        fc.push(`[ly${i}b]alphaextract[ly${i}pa]`)
        fc.push(`[${L.maskIdx}:v]format=gray[ly${i}mk]`)
        fc.push(`[ly${i}pa][ly${i}mk]blend=all_mode=multiply[ly${i}ca]`)
        fc.push(`[ly${i}a][ly${i}ca]alphamerge[ly${i}]`)
      } else {
        fc.push(`[ly${i}p]null[ly${i}]`)
      }
      fc.push(`[${cur}][ly${i}]overlay=${L.box.x}:${L.box.y}[lyc${i}]`)
      cur = `lyc${i}`
    })

    // 섹션 안쪽 크기의 투명 캔버스에서 텍스트를 위로 이동 → 위/아래 페이드 → 섹션 위치에 합성
    const S = spec.section
    fc.push(`color=c=black@0.0:s=${S.w}x${S.h}:r=${fps},format=rgba[band]`)
    // 영상이 있으면 mod() 로 무한 루프(자연 속도 유지), 텍스트 전용이면 한 바퀴.
    const yExpr =
      maxVideoDur > 0
        ? `${S.h}-mod(t*${speed.toFixed(4)}\\,${travel})`
        : `${S.h}-t*${speed.toFixed(4)}`
    fc.push(`[band][${textIdx}:v]overlay=0:'${yExpr}':shortest=0,format=rgba,split[bt_a][bt_b]`)
    // 위/아래 페이드 = 텍스트 알파 × 그레이 마스크(가장자리 0). 배경색을 덧칠하지 않아 영상 위에서도 검은 띠가 없다.
    fc.push(`[bt_b]alphaextract[bt_pa]`)
    fc.push(`[${fadeIdx}:v]format=gray[fade_mk]`)
    fc.push(`[bt_pa][fade_mk]blend=all_mode=multiply[bt_ca]`)
    fc.push(`[bt_a][bt_ca]alphamerge[scroll]`)
    fc.push(`[${cur}][scroll]overlay=${S.x}:${S.y}[withtext]`)
    cur = 'withtext'

    // 테두리(위) + 제목(맨 위)
    fc.push(`[${cur}][${frameIdx}:v]overlay=0:0[framed]`)
    cur = 'framed'
    if (titlePng) {
      fc.push(`[${cur}][${titleIdx}:v]overlay=(W-w)/2:${spec.titleY ?? 0}[out]`)
      cur = 'out'
    }

    const output = path.join(tmp, 'scroll_output.mp4')
    const args = ['-y', ...inputs, '-filter_complex', fc.join(';'), '-map', `[${cur}]`]
    if (firstVideoIdx >= 0 && anyAudio && !spec.mute) {
      args.push('-map', `${firstVideoIdx}:a`, '-c:a', 'aac', '-b:a', '192k')
    }
    args.push(
      '-t', duration.toFixed(3),
      '-r', String(fps),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      '-movflags', '+faststart',
      output
    )

    const mode = firstVideoIdx >= 0 ? '영상' : layerIns.length ? '이미지' : '텍스트'
    onProgress(`스크롤영상 렌더링 중… (${mode} / ${W}x${H} / ${duration.toFixed(1)}초)`)
    await run(FFMPEG, args)

    // 출력은 tmp 정리에서 지워지지 않도록 별도 위치로 이동(브릿지가 복사해 가기 전까지 보존)
    const keep = path.join(os.tmpdir(), `scroll-out-${crypto.randomUUID()}.mp4`)
    await fs.rename(output, keep).catch(async () => {
      await fs.copyFile(output, keep)
    })
    return keep
  } finally {
    // 임시 입력 PNG/미디어 정리 (원본 spec.media.path 는 건드리지 않음)
    for (const p of written) await fs.rm(p, { force: true }).catch(() => {})
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
