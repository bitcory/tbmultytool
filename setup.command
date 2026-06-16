#!/bin/bash
# TB MTOOL — 새 맥북 자동 셋업 스크립트
# Finder에서 더블클릭하거나, 터미널에서 `./setup.command` 로 실행하세요.
# 하는 일: Node 확인 → 의존성 설치(npm install) → 원하면 앱 패키징까지.

set -e

# 이 스크립트가 있는 폴더(=프로젝트 루트)로 이동 — 더블클릭해도 경로가 맞게.
cd "$(dirname "$0")"

echo "════════════════════════════════════════════"
echo "  TB MTOOL 셋업 시작"
echo "  위치: $(pwd)"
echo "════════════════════════════════════════════"
echo

# 1) Node.js 확인
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js가 설치돼 있지 않습니다."
  echo
  echo "   아래 중 하나로 먼저 설치하세요 (권장: LTS 20 이상):"
  echo "   • https://nodejs.org 에서 LTS 설치 파일 다운로드"
  echo "   • 또는 Homebrew:  brew install node"
  echo
  read -n 1 -s -r -p "설치 후 이 창을 닫고 다시 실행하세요. (아무 키나 누르면 종료)"
  exit 1
fi
echo "✅ Node.js $(node -v) / npm $(npm -v)"
echo

# 2) 의존성 설치 — package-lock.json 기준으로 동일 버전 설치
echo "📦 의존성 설치 중... (네트워크 상태에 따라 수 분 걸릴 수 있어요)"
if [ -f package-lock.json ]; then
  npm ci || npm install   # lock이 어긋나면 install로 폴백
else
  npm install
fi
echo "✅ 의존성 설치 완료"
echo

# 3) 다음 동작 선택
echo "다음 중 무엇을 할까요?"
echo "  [1] 개발 모드로 실행          (npm run dev)"
echo "  [2] 패키징 앱 빌드            (npm run package → dist/ 에 .app 생성)"
echo "  [3] 아무것도 안 함 (설치만 완료)"
read -r -p "번호 입력 (기본 1): " CHOICE
CHOICE="${CHOICE:-1}"

case "$CHOICE" in
  1)
    echo "▶ 개발 모드 실행 (창을 닫으면 종료됩니다)"
    npm run dev
    ;;
  2)
    echo "▶ 패키징 빌드"
    npm run package
    echo
    echo "✅ 완료! dist/mac-*/ 안에 'TB MTOOL.app' 이 생성됐습니다."
    echo "   (서명되지 않은 앱이라 처음 열 때 우클릭 → '열기' 로 Gatekeeper를 통과시키세요)"
    ;;
  *)
    echo "설치만 완료했습니다. 나중에 'npm run dev' 또는 'npm run package' 로 실행하세요."
    ;;
esac

echo
read -n 1 -s -r -p "끝났습니다. 아무 키나 누르면 창을 닫습니다."
