import { promises as fs } from 'fs'
import path from 'path'
import type { AspectRatio, Project, ProgressEvent } from '@shared/types'
import { FFMPEG, getDuration, run } from '../ffmpeg'

const RES: Record<AspectRatio, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 }
}

// 한글 지원 폰트 (macOS 기본). 없으면 ffmpeg가 폴백.
const FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'

/** 자막 텍스트를 글자 수 기준으로 줄바꿈 */
function wrap(text: string, perLine: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine) {
      if (cur) lines.push(cur)
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) lines.push(cur)
  return lines.join('\n')
}

/** 한 씬을 정지영상+음성+자막 클립으로 렌더 */
async function renderClip(
  imagePath: string,
  audioPath: string,
  narration: string,
  aspect: AspectRatio,
  outFile: string,
  subDir: string,
  index: number
): Promise<void> {
  const { w, h } = RES[aspect]
  const fontSize = Math.round(h / 22)
  const perLine = aspect === '9:16' ? 18 : 38

  // 자막은 textfile로 전달(이스케이프 이슈 회피) + expansion=none
  const subFile = path.join(subDir, `sub_${index}.txt`)
  await fs.writeFile(subFile, wrap(narration, perLine), 'utf8')

  const fontExists = await fs
    .access(FONT)
    .then(() => true)
    .catch(() => false)

  const draw =
    `drawtext=textfile='${subFile}':` +
    (fontExists ? `fontfile='${FONT}':` : '') +
    `expansion=none:fontcolor=white:fontsize=${fontSize}:` +
    `box=1:boxcolor=black@0.55:boxborderw=24:line_spacing=12:` +
    `x=(w-text_w)/2:y=h-text_h-${Math.round(h / 12)}`

  const vf =
    `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
    `crop=${w}:${h},${draw}`

  // -loop 1 정지영상에는 -shortest 가 신뢰성이 없어(영상이 음성보다 길게 늘어짐),
  // 음성 길이를 직접 읽어 -t 로 클립 길이를 음성에 정확히 맞춘다.
  const dur = await getDuration(audioPath)

  await run(FFMPEG, [
    '-y',
    '-loop', '1', '-i', imagePath,
    '-i', audioPath,
    '-t', dur.toFixed(3),
    '-vf', vf,
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k',
    outFile
  ])
}

/** 프로젝트 전체를 최종 영상으로 렌더링 → 출력 파일 경로 */
export async function renderVideo(
  project: Project,
  outDir: string,
  emit?: (e: ProgressEvent) => void
): Promise<string> {
  const scenes = project.scenes.filter((s) => s.imagePath && s.audioPath)
  if (scenes.length === 0) throw new Error('렌더할 씬이 없습니다. (이미지/음성이 모두 필요)')

  const clipDir = path.join(outDir, 'clips')
  const subDir = path.join(outDir, 'subs')
  await fs.mkdir(clipDir, { recursive: true })
  await fs.mkdir(subDir, { recursive: true })

  const clipFiles: string[] = []
  for (const [i, s] of scenes.entries()) {
    emit?.({ phase: 'render', message: `씬 ${i + 1} 클립 생성`, current: i + 1, total: scenes.length })
    const clip = path.join(clipDir, `clip_${String(s.index).padStart(3, '0')}.mp4`)
    await renderClip(s.imagePath!, s.audioPath!, s.narration, project.options.aspect, clip, subDir, s.index)
    clipFiles.push(clip)
  }

  // concat demuxer 용 목록
  emit?.({ phase: 'render', message: '클립 병합 중' })
  const listFile = path.join(outDir, 'concat.txt')
  await fs.writeFile(listFile, clipFiles.map((f) => `file '${f}'`).join('\n'), 'utf8')

  const safeTitle = (project.title || 'video').replace(/[^\w가-힣 -]/g, '').trim() || 'video'
  const outFile = path.join(outDir, `${safeTitle}.mp4`)
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile])

  emit?.({ phase: 'render', message: '완료', done: true })
  return outFile
}
