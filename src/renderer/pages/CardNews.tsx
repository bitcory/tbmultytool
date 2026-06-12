// 카드뉴스 만들기 — card-news.html(자체 카드 생성기)을 임베드.
// 상단 AI 패널: 기본 내용 입력 → ChatGPT 가 슬라이드 JSON(코드블록) 작성 → 제목/본문/핸들 자동 입력
// → 슬라이드별 1:1 배경 이미지를 ChatGPT 로 생성해 배경 교체 (모두 크롬 확장 브릿지 경유).
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Sparkles, Square, Wand2 } from 'lucide-react'

type AiItem = { n?: string | number; title?: string; desc?: string; imagePrompt?: string }
type AiSlide = { type?: string; kicker?: string; headline?: string; body?: string; imagePrompt?: string; items?: AiItem[] }
type AiCardNews = { handle?: string; slides: AiSlide[] }
type CardFormat = 'basic' | 'duo'

// 두 형식 공통 규칙
const COMMON_RULES = `- 핸들(@계정)은 handle 필드에만 넣어. 카드 하단에 자동 표시되니 headline/body 텍스트에는 절대 넣지 마
- 한국어로, 읽고 나면 하나라도 남는 실용적인 내용으로
- 슬라이드 텍스트는 [기본 내용]의 주제에 대한 실제 정보로 채워. 기본 내용에 적힌 사실을 최우선으로 쓰고, 네가 잘 모르는 최신 주제면 일반론으로 때우거나 지어내지 말고 기본 내용에 있는 것만 구체화해
- 기본 내용 안에 이미지/디자인 관련 지시(배경색, 캐릭터, 스타일, 배치 등)가 섞여 있으면 그건 슬라이드 텍스트에 절대 쓰지 말고 imagePrompt 에만 반영해`

// tips=0 이면 장수를 ChatGPT 가 내용에 맞게 정한다 (명시된 개수 우선)
const buildPrompt = (content: string, tips: number, withImages: boolean, imageStyle: string, format: CardFormat): string => {
  const style = imageStyle.trim()
  if (format === 'duo') {
    return `다음 내용으로 인스타그램 "프롬프트 카드" 시리즈(1080x1080, 정사각형)를 만들 거야.
한 카드에 아이템 2개가 흰 패널로 나란히 들어가는 형식이야 (번호 + 제목 + 예시 이미지 + 짧은 설명).

[기본 내용]
${content}

아래 형식의 JSON 하나만 코드블록(\`\`\`json)에 담아 출력해. 코드블록 밖에는 아무 설명도 쓰지 마.

{
  "handle": "@브랜드핸들 (기본 내용에 없으면 생략)",
  "slides": [
    { "type": "cover", "kicker": "짧은 라벨", "headline": "시리즈 큰 제목 (예: 20 TOP AI 이미지 스타일)", "body": "부제 한 줄", "imagePrompt": "시리즈 전체에 깔 공통 배경 (영어)" },
    { "type": "duo", "headline": "", "body": "하단 CTA 한 줄",
      "items": [
        { "n": "1", "title": "아이템 제목", "desc": "2~3줄 설명", "imagePrompt": "이 아이템을 보여주는 1:1 예시 이미지 (영어)" },
        { "n": "2", "title": "...", "desc": "...", "imagePrompt": "..." }
      ] },
    { "type": "outro", "kicker": "SAVE & FOLLOW", "headline": "마무리 문구", "body": "저장/팔로우 유도 1~2줄", "imagePrompt": "" }
  ]
}

규칙:
- 아이템 수: ${tips > 0 ? `정확히 ${tips}개` : '기본 내용에 "N가지/N개"처럼 개수가 명시돼 있으면 정확히 그 수로, 아니면 내용에 맞게 6~20개'}. duo 카드 1장당 items 정확히 2개(아이템이 홀수면 마지막 카드만 1개), 번호 n 은 "1"부터 연속
- title 은 1~2단어로 짧고 임팩트 있게, desc 는 2~3줄(한 줄 18자 이내, 줄바꿈 \\n)
- 모든 duo 카드의 body(하단 CTA)는 동일한 문구로, duo 의 headline 은 비워("")
${COMMON_RULES}${
      withImages
        ? `
- imagePrompt 는 모두 영어, 이미지 안에 글자·텍스트·로고·워터마크 금지. cover 의 imagePrompt 는 시리즈 공통 배경(흰 패널이 올라가도 어울리는 추상/그라데이션 톤), item 의 imagePrompt 는 그 아이템의 스타일/주제를 한눈에 보여주는 1:1 예시 장면${style ? `. 공통 스타일 지시: "${style}"` : ''}`
        : `
- 모든 imagePrompt 는 빈 문자열("")로`
    }`
  }
  return `다음 내용으로 인스타그램 카드뉴스(1080x1080, 정사각형)를 만들 거야.

[기본 내용]
${content}

아래 형식의 JSON 하나만 코드블록(\`\`\`json)에 담아 출력해. 코드블록 밖에는 아무 설명도 쓰지 마.

{
  "handle": "@브랜드핸들 (기본 내용에 없으면 생략)",
  "slides": [
    { "type": "cover", "kicker": "짧은 상단 라벨", "headline": "표지 제목", "body": "어떤 내용인지 기대감을 주는 1~2줄 훅", "imagePrompt": "..." },
    { "type": "tip", "kicker": "주제 라벨", "headline": "팁 제목", "body": "구체적인 설명 3~4줄", "imagePrompt": "..." },
    { "type": "outro", "kicker": "SAVE & FOLLOW", "headline": "마무리 문구", "body": "핵심 요약 + 저장/팔로우 유도 2~3줄", "imagePrompt": "..." }
  ]
}

규칙:
- slides 는 cover 1장 + tip ${tips > 0 ? `${tips}장` : 'N장'} + outro 1장 순서${
    tips > 0
      ? ` (총 ${tips + 2}장)`
      : '. tip 수 N 은 기본 내용에 맞게 직접 정해: 내용에 "N가지/N개"처럼 개수가 명시돼 있으면 정확히 그 수로, 아니면 내용을 자연스럽게 나눠 3~8장'
  }
- headline 은 줄바꿈(\\n) 포함 최대 2줄, 한 줄 12자 이내로 짧고 임팩트 있게
- body 는 내용을 풍부하게: 왜 중요한지/어떻게 하는지를 구체적으로. 실제 예시·수치·바로 따라할 수 있는 행동 중 1개 이상 포함. tip 은 3~4줄, 한 줄 20자 이내, 줄바꿈은 \\n 으로
- kicker 는 "TIP" 같은 일반 단어 대신 그 슬라이드 주제를 드러내는 짧은 라벨로 (예: "역할 지정", "예시 첨부")
${COMMON_RULES}${
    withImages
      ? `
- imagePrompt 는 영어로 작성. 1:1 정사각형 카드 배경용 이미지 프롬프트. 이미지 안에 글자·텍스트·로고·워터마크 금지. 각 슬라이드 내용과 어울리게.${
          style
            ? ` 모든 슬라이드의 imagePrompt 에 다음 스타일 지시를 공통 반영해: "${style}" (밝은 배경이어도 됨 — 앱이 글씨색을 자동 조정함)`
            : ' 어둡고 분위기 있는 톤(위에 흰 글씨가 올라가도 잘 읽히게), 추상적/시네마틱 배경'
        }`
      : `
- imagePrompt 는 빈 문자열("")로`
  }`
}

// 갤러리 썸네일 생성 (원본 dataURL → 168px JPEG) — iframe 피커 그리드 표시용
const makeThumb = (dataUrl: string): Promise<string> =>
  new Promise((res) => {
    const im = new Image()
    im.onload = () => {
      const sc = 168 / Math.max(im.width, im.height, 1)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(im.width * sc))
      c.height = Math.max(1, Math.round(im.height * sc))
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
      res(c.toDataURL('image/jpeg', 0.75))
    }
    im.onerror = () => res(dataUrl)
    im.src = dataUrl
  })

const isImagePath = (p: string): boolean => !/\.(mp4|webm|mov|mp3|wav)$/i.test(p)

// ChatGPT 응답에서 JSON 추출 — 코드펜스가 섞여 있어도 첫 { ~ 마지막 } 를 파싱
function extractJson(text: string): AiCardNews | null {
  const t = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const j = JSON.parse(t.slice(a, b + 1))
    return Array.isArray(j?.slides) && j.slides.length ? (j as AiCardNews) : null
  } catch {
    return null
  }
}

const S = {
  panel: { borderBottom: '1px solid #2a2e3a', background: '#15171f', padding: '14px 18px', flexShrink: 0 } as const,
  head: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontWeight: 800, fontSize: 14 } as const,
  row: { display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-start' } as const,
  ta: {
    flex: 1, background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 9, color: '#f4f5f7',
    padding: '10px 12px', fontFamily: 'inherit', fontSize: 13.5, resize: 'vertical', minHeight: 64
  } as const,
  side: { display: 'flex', flexDirection: 'column', gap: 8, width: 210, flexShrink: 0 } as const,
  ctl: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#8c93a6' } as const,
  sel: { background: '#1d2029', border: '1px solid #2a2e3a', borderRadius: 8, color: '#f4f5f7', padding: '6px 8px', fontFamily: 'inherit', fontSize: 12.5 } as const,
  btn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 9,
    border: 'none', background: '#3d5afe', color: '#fff', fontFamily: 'inherit', fontWeight: 800, fontSize: 13, cursor: 'pointer'
  } as const,
  msg: { marginTop: 10, fontSize: 12.5, color: '#8c93a6' } as const,
  label: { fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8c93a6' } as const,
  hint: { fontSize: 11.5, color: '#8c93a6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
}

export default function CardNews() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [open, setOpen] = useState(true)
  const [content, setContent] = useState('')
  const [imageStyle, setImageStyle] = useState('')
  const [format, setFormat] = useState<CardFormat>('basic')
  const [tips, setTips] = useState(0) // 0 = 자동(내용에 맞게 ChatGPT 가 결정)
  const [withImages, setWithImages] = useState(true)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')
  const runningRef = useRef(false)

  // 확장 작업 진행 메시지를 상태줄에 표시
  useEffect(() => {
    const off = window.electronAPI.bridge.onProgress((m) => {
      if (runningRef.current) setMsg(m)
    })
    return off
  }, [])

  // iframe(card-news.html)의 요청 처리 — 전체 zip 저장, 다운로드 폴더 열기
  const lastZipDir = useRef('')
  useEffect(() => {
    const onMsg = async (e: MessageEvent): Promise<void> => {
      const d = e.data as {
        type?: string
        items?: { name: string; dataUrl: string }[]
        name?: string
        message?: string
        id?: string
        target?: string
      }
      try {
        if (d?.type === 'cardnews:status' && d.message) {
          setMsg(d.message)
        } else if (d?.type === 'cardnews:export-zip' && d.items?.length) {
          setMsg('zip 저장 중…')
          const r = await window.electronAPI.bridge.exportZip(d.items, d.name || 'card-news')
          if (r.ok && r.path) {
            lastZipDir.current = r.path.replace(/[/\\][^/\\]*$/, '')
            setMsg('zip 저장 완료: ' + r.path)
          } else {
            setMsg(r.message || 'zip 저장 취소')
          }
        } else if (d?.type === 'cardnews:open-folder') {
          // 마지막 zip 저장 폴더, 없으면 시스템 다운로드 폴더 ('@downloads' 는 메인에서 매핑)
          await window.electronAPI.fs.openPath(lastZipDir.current || '@downloads')
        } else if (d?.type === 'cardnews:request-gallery') {
          // 앱 갤러리(확장으로 받아둔 이미지)의 최근 24장을 썸네일로 만들어 iframe 피커에 전달
          const all = await window.electronAPI.bridge.list()
          const imgs = all.filter((i) => isImagePath(i.path)).slice(0, 24)
          const items = (
            await Promise.all(
              imgs.map(async (i) => {
                try {
                  const full = await window.electronAPI.fs.readImage(i.path)
                  return { id: i.id, thumb: await makeThumb(full) }
                } catch {
                  return null
                }
              })
            )
          ).filter(Boolean)
          frameRef.current?.contentWindow?.postMessage({ type: 'cardnews:gallery-list', items }, '*')
        } else if (d?.type === 'cardnews:gallery-pick' && d.id) {
          // 선택된 이미지의 원본 dataURL 을 iframe 으로 (배경/자유배치/아이템 적용은 iframe 이 처리)
          const img = (await window.electronAPI.bridge.list()).find((x) => x.id === d.id)
          if (img) {
            const dataUrl = await window.electronAPI.fs.readImage(img.path)
            frameRef.current?.contentWindow?.postMessage({ type: 'cardnews:gallery-image', dataUrl, target: d.target }, '*')
          }
        }
      } catch (err) {
        // IPC 실패(구버전 메인 등)를 조용히 삼키지 않고 상태줄에 노출
        setMsg('오류: ' + ((err as Error)?.message || String(err)))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const post = (data: unknown): void => frameRef.current?.contentWindow?.postMessage(data, '*')

  const run = async (): Promise<void> => {
    if (!content.trim()) {
      setMsg('카드뉴스로 만들 기본 내용을 먼저 입력하세요.')
      return
    }
    setRunning(true)
    runningRef.current = true
    try {
      // 1) ChatGPT 텍스트 잡: 슬라이드 JSON 작성
      setMsg('ChatGPT가 카드뉴스 내용을 작성 중… (크롬 탭에서 자동 실행)')
      const r = await window.electronAPI.bridge.generateText(buildPrompt(content.trim(), tips, withImages, imageStyle, format))
      if (!runningRef.current) return
      if (!r.ok || !r.text) {
        setMsg(r.message || '내용 생성 실패 — 크롬에서 ChatGPT 로그인과 TB MTOOL 확장을 확인하세요.')
        return
      }
      const data = extractJson(r.text)
      if (!data) {
        setMsg('응답 파싱 실패 — 다시 시도해보세요.')
        return
      }

      // 2) 카드뉴스에 제목/본문/핸들 주입
      post({ type: 'cardnews:set-slides', slides: data.slides, handle: data.handle })
      setMsg(`슬라이드 ${data.slides.length}장 적용 완료${withImages ? ' · 이미지 생성 시작…' : ''}`)
      if (!withImages) return

      // 3) 1:1 이미지 생성 → 도착하는 대로 적용.
      //    동시 3개(확장 워커 탭 상한)까지만 — 전부 한꺼번에 큐에 넣으면 뒤 작업이 5분 타임아웃에 걸린다.
      //    기본형: 슬라이드별 배경. 프롬프트 카드: 공통 배경 1장(cover 프롬프트) + 아이템별 예시 이미지.
      type ImgJob = { kind: 'bg'; i?: number; j?: number; p: string } | { kind: 'item'; i: number; j: number; p: string }
      const jobs: ImgJob[] = []
      if (format === 'duo') {
        const bgPrompt = (data.slides.find((s) => s.type === 'cover')?.imagePrompt || '').trim()
        if (bgPrompt) jobs.push({ kind: 'bg', p: bgPrompt })
        data.slides.forEach((s, i) =>
          (s.items || []).forEach((it, j) => {
            const p = (it.imagePrompt || '').trim()
            if (p) jobs.push({ kind: 'item', i, j, p })
          })
        )
      } else {
        data.slides.forEach((s, i) => {
          const p = (s.imagePrompt || '').trim()
          if (p) jobs.push({ kind: 'bg', i, p })
        })
      }
      if (!jobs.length) {
        setMsg('완료 — 이미지 프롬프트가 응답에 없어 텍스트만 적용했습니다.')
        return
      }
      let done = 0
      let failed = 0
      const queue = [...jobs]
      const total = data.slides.length
      const worker = async (): Promise<void> => {
        for (;;) {
          const t = queue.shift()
          if (!t || !runningRef.current) return
          const g = await window.electronAPI.bridge.generate('chatgpt', t.p, undefined, '1:1')
          if (g.ok && g.imageId) {
            const img = (await window.electronAPI.bridge.list()).find((x) => x.id === g.imageId)
            if (img) {
              const dataUrl = await window.electronAPI.fs.readImage(img.path)
              if (t.kind === 'item') {
                post({ type: 'cardnews:set-item-img', index: t.i, item: t.j, dataUrl })
              } else if (format === 'duo') {
                // 프롬프트 카드의 공통 배경: 모든 슬라이드에 적용
                for (let i = 0; i < total; i++) post({ type: 'cardnews:set-bg', index: i, dataUrl })
              } else {
                post({ type: 'cardnews:set-bg', index: t.i, dataUrl })
              }
            }
          } else {
            failed++
          }
          done++
          if (runningRef.current) setMsg(`이미지 ${done}/${jobs.length} 완료${failed ? ` · 실패 ${failed}` : ''}`)
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker))
      if (runningRef.current)
        setMsg(failed ? `완료 — 이미지 ${jobs.length - failed}/${jobs.length}장 적용 (실패분은 다시 시도하세요)` : '카드뉴스 자동 생성 완료 ✓')
    } catch (e) {
      // 구버전 앱(핸들러 미등록) 등 예외를 상태줄에 표시
      setMsg('오류: ' + ((e as Error)?.message || String(e)))
    } finally {
      setRunning(false)
      runningRef.current = false
    }
  }

  const stop = async (): Promise<void> => {
    runningRef.current = false
    await window.electronAPI.bridge.cancel()
    setRunning(false)
    setMsg('정지했습니다.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={S.panel}>
        <div style={S.head} onClick={() => setOpen((o) => !o)}>
          <Wand2 size={15} color="#3d5afe" /> AI 카드뉴스 자동 생성
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {!open && msg && <span style={{ ...S.msg, marginTop: 0, fontWeight: 400 }}>{msg}</span>}
        </div>
        {open && (
          <>
            <div style={S.row}>
              <div style={{ flex: 1.4, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={S.label}>카드뉴스 내용</div>
                <textarea
                  style={S.ta}
                  rows={3}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="주제·핵심 포인트·타깃·핸들을 적어주세요."
                />
                <div style={S.hint}>예) 챗GPT 프롬프트 잘 쓰는 법 5가지 — 최신 주제는 핵심 포인트를 직접 적어주세요</div>
              </div>
              {withImages && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={S.label}>배경 스타일</div>
                  <textarea
                    style={S.ta}
                    rows={3}
                    value={imageStyle}
                    onChange={(e) => setImageStyle(e.target.value)}
                    placeholder="배경 이미지 스타일 (선택)"
                  />
                  <div style={S.hint}>예) 흰색 배경에 귀여운 아이콘 캐릭터를 우측 하단에</div>
                </div>
              )}
              <div style={S.side}>
                <label style={S.ctl}>
                  형식
                  <select
                    style={S.sel}
                    value={format}
                    onChange={(e) => {
                      setFormat(e.target.value as CardFormat)
                      setTips(0) // 형식 바뀌면 장수는 자동으로 리셋
                    }}
                    disabled={running}
                  >
                    <option value="basic">기본형</option>
                    <option value="duo">프롬프트 카드 (2단)</option>
                  </select>
                </label>
                <label style={S.ctl}>
                  {format === 'duo' ? '아이템 수' : '팁 슬라이드'}
                  <select style={S.sel} value={tips} onChange={(e) => setTips(+e.target.value)} disabled={running}>
                    <option value={0}>자동 (내용에 맞게)</option>
                    {(format === 'duo' ? [4, 6, 8, 10, 12, 16, 20] : [2, 3, 4, 5, 6, 8]).map((n) => (
                      <option key={n} value={n}>
                        {format === 'duo' ? `${n}개` : `${n}장 (총 ${n + 2}장)`}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={S.ctl}>
                  <input
                    type="checkbox"
                    checked={withImages}
                    onChange={(e) => setWithImages(e.target.checked)}
                    disabled={running}
                  />
                  1:1 배경 이미지도 생성
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ ...S.btn, flex: 1, opacity: running ? 0.6 : 1 }} onClick={run} disabled={running}>
                    {running ? <Loader2 size={14} className="igen-spin" /> : <Sparkles size={14} />}
                    {running ? '생성 중…' : '자동 생성'}
                  </button>
                  {running && (
                    <button style={{ ...S.btn, background: '#1d2029', border: '1px solid #2a2e3a' }} onClick={stop} title="정지">
                      <Square size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {msg && <div style={S.msg}>{msg}</div>}
            <div style={{ ...S.msg, marginTop: 4, fontSize: 11.5 }}>
              ※ 크롬에 ChatGPT 로그인 + TB MTOOL 확장이 필요
            </div>
          </>
        )}
      </div>
      <iframe
        ref={frameRef}
        src="card-news.html"
        title="카드뉴스 만들기"
        style={{ width: '100%', flex: 1, border: 'none', display: 'block', minHeight: 0 }}
      />
    </div>
  )
}
