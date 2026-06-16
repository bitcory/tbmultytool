// electron-builder afterPack 훅 — macOS 앱 번들을 "제대로" ad-hoc 서명한다.
//
// electron-builder가 Developer ID 인증서를 못 찾아 서명을 건너뛰면, 번들이 봉인(seal)되지
// 않은 깨진 상태로 남아 다른 맥에서 "손상되었기 때문에 열 수 없습니다" 가 뜬다.
// 여기서 번들 전체를 ad-hoc(-)으로 다시 서명하면 서명이 유효해져서, 그 메시지 대신
// "확인되지 않은 개발자" 단계가 되고 사용자는 '우클릭 → 열기' 한 번으로 실행할 수 있다.
// (완전 무조작 실행은 Apple 공증(notarize)이 있어야 하므로 그건 별개 작업.)
//
// afterSign 훅은 서명이 스킵되면 호출되지 않을 수 있어, 반드시 실행되는 afterPack을 쓴다.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  // macOS 빌드에서만 동작
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  console.log(`  • ad-hoc 서명(번들 전체): ${appPath}`)
  try {
    // --deep: 내부 Electron Framework/Helper 들까지 안쪽부터 서명
    // --force: 기존(깨진) 서명 덮어쓰기, -s -: ad-hoc 서명, --timestamp=none: 네트워크 불필요
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
      { stdio: 'inherit' }
    )
    // 서명 유효성 확인 (실패하면 빌드를 멈춰 문제를 빨리 드러냄)
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
    console.log('  • ad-hoc 서명 완료 및 검증 통과')
  } catch (e) {
    console.error('  ✗ ad-hoc 서명 실패:', e.message)
    throw e
  }
}
