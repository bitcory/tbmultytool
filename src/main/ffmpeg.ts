import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
// ffprobe 는 플랫폼 네이티브 바이너리를 주는 @ffprobe-installer 사용.
// (ffprobe-static 은 mac arm64 슬롯에도 x86_64 를 넣어 앱이 "Intel 포함"으로 잡히는 문제가 있어 교체)
import ffprobeInstaller from '@ffprobe-installer/ffprobe'

// 패키징(asar) 시 정적 바이너리는 app.asar.unpacked 로 풀려야 실행 가능.
// ffmpeg-static/ffprobe-static 이 주는 경로의 app.asar 를 unpacked 로 보정한다.
function unpacked(p: string | null | undefined): string | undefined {
  return p ? p.replace('app.asar', 'app.asar.unpacked') : undefined
}

// 번들된 정적 바이너리 우선, 없으면 PATH의 ffmpeg/ffprobe 사용
export const FFMPEG = unpacked(ffmpegStatic as unknown as string) || 'ffmpeg'
export const FFPROBE = unpacked(ffprobeInstaller?.path) || 'ffprobe'

/** ffmpeg/ffprobe 실행 (stderr 수집, 실패 시 throw) */
export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args)
    let stderr = ''
    let stdout = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve(stdout || stderr)
      else reject(new Error(`${bin} exited ${code}\n${stderr.slice(-2000)}`))
    })
  })
}

/** 오디오/비디오 파일 길이(초) */
export async function getDuration(file: string): Promise<number> {
  const out = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ])
  const sec = parseFloat(out.trim())
  if (!isFinite(sec)) throw new Error(`길이를 읽을 수 없습니다: ${file}`)
  return sec
}

/** 파일에 오디오 스트림이 있는지 */
export async function hasAudioStream(file: string): Promise<boolean> {
  try {
    const out = await run(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      file
    ])
    return out.trim() !== ''
  } catch {
    return false
  }
}
