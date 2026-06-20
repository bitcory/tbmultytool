// 고화질 프레임 추출 — ffmpeg 로 영상의 특정 시각 프레임을 원본 해상도 PNG(무손실)로 뽑는다.
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { FFMPEG, FFPROBE, run, getDuration } from './ffmpeg'

// 추출/임시 파일이 떨어지는 폴더 (앱 임시 경로 하위)
const framesDir = (): string => path.join(app.getPath('temp'), 'avs-frames')

/** 영상 정보: 길이(초) + 프레임 크기(px) */
export async function probeVideo(
  file: string
): Promise<{ duration: number; width: number; height: number }> {
  const duration = await getDuration(file)
  let width = 0
  let height = 0
  try {
    const out = await run(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0:s=x',
      file
    ])
    const [w, h] = out.trim().split('x')
    width = parseInt(w, 10) || 0
    height = parseInt(h, 10) || 0
  } catch {
    /* 크기를 못 읽어도 길이만으로 진행 */
  }
  return { duration, width, height }
}

/**
 * timeSec 위치의 프레임 한 장을 원본 해상도 PNG 로 추출.
 * 빠른 키프레임 시크(-ss 입력 앞) + 정밀 디코드(-ss 입력 뒤) 하이브리드로
 * 긴 영상에서도 빠르면서 프레임 정확도를 유지한다.
 */
export async function extractFrame(
  file: string,
  timeSec: number
): Promise<{ path: string; dataUrl: string; timeSec: number }> {
  const dir = framesDir()
  await fs.mkdir(dir, { recursive: true })

  // 영상 길이를 알면 시각을 안전 범위로 클램프한다.
  // 끝을 넘기면 ffmpeg 가 "Output file is empty" 로 exit 0 하면서 파일을 안 만들어
  // 뒤의 readFile 이 ENOENT 로 터진다(= 사용자가 본 에러).
  let dur = 0
  try {
    dur = await getDuration(file)
  } catch {
    /* 길이 못 읽어도 진행 */
  }
  let t = Math.max(0, timeSec)
  if (dur > 0 && t > dur - 0.05) t = Math.max(0, dur - 0.05)

  const stamp = `${Math.round(t * 1000)}_${Date.now()}`
  const out = path.join(dir, `frame_${stamp}.png`)

  // ffmpeg 실행 후 실제로 파일이 만들어졌는지 확인 (exit 0 이어도 빈 출력일 수 있음)
  const tryExtract = async (args: string[]): Promise<boolean> => {
    try {
      await run(FFMPEG, args)
    } catch {
      return false
    }
    try {
      await fs.access(out)
      return true
    } catch {
      return false
    }
  }

  // 1) 빠른 하이브리드 시크 (키프레임 점프 + 정밀 디코드)
  const pre = Math.max(0, t - 5)
  const post = t - pre
  let ok = await tryExtract([
    '-ss', String(pre), '-i', file, '-ss', String(post),
    '-frames:v', '1', '-q:v', '1', '-an', '-sn', '-update', '1', '-y', out
  ])
  // 2) 실패 시 정확 디코드 시크 (느리지만 끝부분/특수 인코딩에 강함)
  if (!ok) {
    ok = await tryExtract([
      '-i', file, '-ss', String(t),
      '-frames:v', '1', '-q:v', '1', '-an', '-sn', '-update', '1', '-y', out
    ])
  }
  // 3) 그래도 없으면 파일 끝 직전 프레임이라도
  if (!ok) {
    ok = await tryExtract([
      '-sseof', '-0.2', '-i', file,
      '-frames:v', '1', '-q:v', '1', '-an', '-sn', '-update', '1', '-y', out
    ])
  }
  if (!ok) {
    throw new Error(
      `프레임을 추출하지 못했습니다 (시각 ${t.toFixed(2)}s` +
        (dur > 0 ? `, 영상 길이 ${dur.toFixed(2)}s` : '') +
        `). 영상 끝을 넘었거나 손상된 파일일 수 있어요.`
    )
  }

  const buf = await fs.readFile(out)
  return { path: out, dataUrl: `data:image/png;base64,${buf.toString('base64')}`, timeSec: t }
}

/** dataURL 영상을 임시 파일로 떨어뜨려 실제 경로를 돌려준다 (파일 경로를 못 잡는 폴백용) */
export async function materializeVideo(dataUrl: string): Promise<string> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('잘못된 영상 데이터입니다.')
  const ext = m[1].includes('webm') ? 'webm' : m[1].includes('quicktime') ? 'mov' : 'mp4'
  const dir = framesDir()
  await fs.mkdir(dir, { recursive: true })
  const out = path.join(dir, `src_${Date.now()}.${ext}`)
  await fs.writeFile(out, Buffer.from(m[2], 'base64'))
  return out
}
