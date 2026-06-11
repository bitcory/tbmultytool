// 앱에 번들된 크롬 확장을 사용자가 접근 가능한 고정 폴더에 배포한다.
// 앱이 업데이트되면(번들 확장 버전이 올라가면) 이 폴더 내용도 갱신 → 사용자는
// chrome://extensions 에서 새로고침(또는 크롬 재시작) 한 번이면 최신 확장 적용.
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

let deployedDir = ''
let deployedVersion = '' // 디스크에 배포된 확장 버전(확장 자동 reload 판단용)

async function readVersion(dir: string): Promise<string | null> {
  try {
    const m = await fs.readFile(path.join(dir, 'manifest.json'), 'utf-8')
    return (JSON.parse(m).version as string) ?? null
  } catch {
    return null
  }
}

/** 번들 확장 → Documents/TB MTOOL/extension 로 (버전 다르면) 복사. 배포 경로 반환. */
export async function deployExtension(): Promise<string> {
  // 패키징: resources/extension, 개발: out/main 기준 프로젝트루트/extension
  const src = app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '../../extension')
  const dest = path.join(app.getPath('documents'), 'TB MTOOL', 'extension')
  deployedDir = dest
  try {
    const sv = await readVersion(src)
    if (!sv) return dest // 번들 확장 없음(이상)
    deployedVersion = sv // 복사 여부와 무관하게 디스크의 현재 버전
    const dv = await readVersion(dest)
    if (sv !== dv) {
      await fs.rm(dest, { recursive: true, force: true })
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.cp(src, dest, { recursive: true })
      console.log(`[extDeploy] 확장 배포 ${dv ?? '(없음)'} → ${sv} : ${dest}`)
    }
  } catch (e) {
    console.warn('[extDeploy] 실패:', e)
  }
  return dest
}

export function getExtensionDir(): string {
  return deployedDir
}

export function getDeployedExtVersion(): string {
  return deployedVersion
}
