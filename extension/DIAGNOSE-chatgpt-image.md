# ChatGPT 이미지 감지 진단

이미지는 화면에 떴는데 확장(`automate.js`)이 못 잡을 때, 실제 DOM의 `alt`/`src`가 감지 패턴과 맞는지 확인한다.

## 진단 실행

ChatGPT 탭에서 **이미지가 생성된 직후**, 페이지에 포커스를 둔 채 **`Alt + Shift + D`** 를 누른다.
(content script 는 페이지와 격리된 world 라 콘솔 함수 호출은 안 보임 → 키 입력으로 트리거. 콘솔 붙여넣기는 정규식/펜스가 깨져서 쓰지 않는다.)

콘솔에 `[AVS-DIAG]` 로그가 출력된다:
- `=== 마지막 turn 이미지 개수` + 각 이미지 `alt`/`srcHead`/`w`/`h`
- `=== oaiusercontent류 img` 후보 목록
- `=== 현재 감지로직 결과 lastTurnImageUrls()` — 비어 있으면 감지 실패
- `=== fetch 테스트` — 감지된 URL 을 실제로 받아본 결과(status/type/sizeKB)

## 감지 로직 (automate.js `lastTurnImageUrls`)

마지막 `conversation-turn` 안의 `<img>` 중:
- `alt` 가 `생성된 이미지` / `Generated image` / `편집된 이미지` / `Edited image` 로 시작
- `src` 가 `blob:` / `data:` 가 아닌 실제 http URL

## 알려진 변화 (2026-06-09)

- 완료된 이미지 `alt` 가 `생성된 이미지: <설명>` 형태(콜론+설명) — 여전히 `생성된 이미지` 로 시작하므로 매치 OK.
- 이미지 `src` 도메인이 `oaiusercontent.com` → `chatgpt.com/backend-api/estuary/content?id=file_...&v=0` 로 변경. 감지는 도메인 무관(alt 기준)이라 영향 없음. fetch 는 `credentials:'include'` 로 정상(200).
- ChatGPT 가 이미지 완료를 "task" 로 처리(`MISSING_TRANSLATION task.image.completed`)하면서 완료 후에도 stop 버튼이 잠깐 남음 → 대기 루프가 `!isStreaming()` 에 막혀 타임아웃했던 버그를 "스트리밍 중이면 URL ~6초 안정 시 채택" 으로 수정.

## 결과 해석

| 보이는 값 | 의미 | 고칠 곳 |
|---|---|---|
| `alt` 가 gen/edit 패턴으로 시작 안 함 | alt 텍스트 변경 | `PAT.genAlt` / `PAT.editAlt` |
| `srcHead` 가 `blob:` | 표시는 blob, 실제 URL 따로 | `lastTurnImageUrls()` blob 제외 로직 |
| 마지막 turn 0개, 후보만 있음 | 이미지가 turn 밖 | 감지 범위 확장 |
| `fetch 테스트` status 401/403 | 인증 필요 | `credentials:'include'` 확인 |
