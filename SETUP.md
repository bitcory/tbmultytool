# 새 맥북에서 시작하기 (TB MTOOL)

이 폴더를 다른 맥으로 옮긴 뒤, **의존성 설치부터 실행까지** 따라하는 안내입니다.
(이 프로젝트는 `node_modules` / `out` / `dist` 를 뺀 상태로 복사돼 있습니다 — 그 폴더들은 아래 과정에서 자동 생성됩니다.)

---

## 가장 빠른 방법 — 셋업 스크립트 더블클릭

1. 이 폴더(`ai-video-studio`)를 **외장드라이브가 아닌 맥 내장 디스크로 복사**합니다.
   (외장에서 바로 돌리면 느리고 권한 문제가 날 수 있어요.)
2. Finder에서 **`setup.command`** 파일을 더블클릭합니다.
   - 처음엔 "확인되지 않은 개발자" 경고가 뜰 수 있어요 → **우클릭 → 열기 → 열기**.
3. 스크립트가 자동으로:
   - Node.js 설치 여부 확인
   - `npm ci`(또는 `npm install`)로 의존성 설치
   - 개발 실행 / 패키징 빌드 중 선택 실행

> Node.js가 없다면 스크립트가 안내합니다. https://nodejs.org 에서 **LTS(20 이상)** 를 설치한 뒤 다시 실행하세요.

---

## 수동으로 하는 방법 (터미널)

```bash
# 1) 프로젝트 폴더로 이동
cd /경로/ai-video-studio

# 2) 의존성 설치 (package-lock.json 기준 동일 버전)
npm ci          # lock과 안 맞으면:  npm install

# 3) 실행
npm run dev      # 개발 모드 (HMR, 코드 바꾸면 자동 반영)

# 또는 배포용 앱 만들기
npm run package  # dist/mac-*/ 안에 'TB MTOOL.app' 생성
```

기타 명령:
```bash
npm run typecheck   # 타입 체크
npm run build       # 프로덕션 번들만 (out/)
```

---

## 사전 준비물

| 항목 | 필요 | 비고 |
|------|------|------|
| Node.js | ✅ 필수 | LTS 20 이상 권장 (https://nodejs.org 또는 `brew install node`) |
| 인터넷 | ✅ 필수 | `npm install` 시 패키지 다운로드 |
| FFmpeg | ❌ 불필요 | `ffmpeg-static`/`ffprobe-static`로 자동 번들됨 |
| Xcode CLT | 상황에 따라 | 네이티브 모듈 빌드가 필요할 때 (`xcode-select --install`) |
| API 키 | 실행 후 입력 | 앱 설정 화면에서 본인 키 입력 (로컬 암호화 저장, 코드에 없음) |

---

## 자주 막히는 부분

- **`npm ci` 실패** → `rm -rf node_modules && npm install` 로 재설치.
- **네이티브 모듈(better-sqlite 등) 오류** → `xcode-select --install` 후 다시 설치.
- **패키징한 앱이 안 열림 ("손상되었거나 개발자 확인 불가")** → 서명되지 않은 앱이라 그렇습니다.
  앱을 **우클릭 → 열기 → 열기**, 또는 터미널에서:
  ```bash
  xattr -dr com.apple.quarantine "dist/mac-arm64/TB MTOOL.app"
  ```
- **폰트가 깨져 보임** → `fonts/` 폴더가 같이 복사됐는지 확인 (한글 폰트 26종, 약 93MB).
- **칩 종류가 다른 맥(Intel ↔ Apple Silicon)** → `node_modules`는 절대 복사해 쓰지 말고 새로 `npm install` 하세요. (지금처럼 이미 빠져 있음)

---

## 옮길 때 체크리스트 (이미 반영됨)

- [x] `src/`, `package.json`, `package-lock.json`, 설정 파일들
- [x] `fonts/` (gitignore 대상이지만 앱 실행에 **필수**)
- [x] `build/`, `extension/`, `card/`
- [ ] `node_modules/`, `out/`, `dist/` — **복사 안 함** (위 과정에서 자동 생성)
- 비밀값(`.env`): 이 프로젝트엔 없음. API 키는 앱 안에서 입력.
