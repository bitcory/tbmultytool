import { useEffect, useRef, useState } from 'react'
import { PenLine, FileText, Eye, Sparkles, Loader2, ImageIcon, RotateCw, X, Upload as UploadIcon } from 'lucide-react'
import type { ImageSource, ImportedImage } from '@shared/types'
import { usePersistedForm, isToday } from '../persist'

// ─────────────────────────────────────────────────────────────────────────
// 블로그 자동화 (1단계): 기사 입력 → GPT가 제목·본문·태그 작성 → 본문 사이 이미지/썸네일 생성
//  → '검토' 탭에서 확인·수정. (2단계: '블로그 올리기'로 티스토리 자동 발행)
// 텍스트는 bridge.generateText(ChatGPT 브릿지), 이미지는 bridge.generateBatch(ChatGPT/Flow) 사용.
// ─────────────────────────────────────────────────────────────────────────

type Block =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; prompt: string; dataUrl?: string; path?: string }

interface Post {
  title: string
  tags: string[]
  thumbPrompt?: string
  thumbDataUrl?: string
  thumbPath?: string
  blocks: Block[]
}

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(f) })

const isImagePath = (p: string): boolean => !/\.(mp4|webm|mov|mp3|wav)$/i.test(p)
const uid = (() => { let n = 0; return () => `b${++n}_${Math.round(performance.now())}` })()

const readImage = (p: string): Promise<string> =>
  window.electronAPI.fs.readImage(p).catch(() => '')

// ChatGPT 응답에서 JSON 추출 (코드펜스 섞여도 첫 { ~ 마지막 } 파싱)
function extractJson(text: string): Record<string, unknown> | null {
  const t = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function buildPrompt(article: string, maxChars: number, imageCount: number, withThumb: boolean): string {
  return [
    '너는 한국어 블로그 글을 쓰는 전문 작가야. 아래 [기사]를 바탕으로 자연스러운 블로그 포스트를 작성해.',
    '반드시 아래 JSON 형식 하나만 출력해. 설명·코드펜스·다른 텍스트 금지.',
    '',
    '규칙:',
    `- 본문 텍스트(모든 text 블록 글자수 합계)는 ${maxChars}자 이내.`,
    `- 본문 중간중간에 image 블록을 정확히 ${imageCount}개 넣어. (text와 image를 번갈아 배치, 글 흐름에 맞는 위치)`,
    '- image 블록의 prompt는 그 위치 내용에 어울리는 사진/일러스트를 묘사하는 영어 프롬프트로 작성.',
    '- tags 는 핵심 키워드 5~8개(한국어).',
    withThumb ? '- thumbPrompt: 글 전체를 대표하는 썸네일 이미지를 묘사하는 영어 프롬프트.' : '- thumbPrompt 는 빈 문자열.',
    '- title 은 클릭하고 싶은 매력적인 제목.',
    '',
    'JSON 형식:',
    '{',
    '  "title": "글 제목",',
    '  "tags": ["키워드1","키워드2"],',
    `  "thumbPrompt": "${withThumb ? 'thumbnail image prompt (english)' : ''}",`,
    '  "blocks": [',
    '    { "type": "text", "text": "문단 내용..." },',
    '    { "type": "image", "prompt": "image prompt in english" },',
    '    { "type": "text", "text": "다음 문단..." }',
    '  ]',
    '}',
    '',
    '[기사]',
    article
  ].join('\n')
}

export default function Blog() {
  const [tab, setTab] = useState<'input' | 'review'>('input')
  const [article, setArticle] = useState('')
  const [maxChars, setMaxChars] = useState(2000)
  const [imageCount, setImageCount] = useState(3)
  const [withThumb, setWithThumb] = useState(true)
  const [imgSource, setImgSource] = useState<ImageSource>('chatgpt')
  const [aspect, setAspect] = useState('16:9')

  const [writing, setWriting] = useState(false)
  const [genImages, setGenImages] = useState(false)
  const [post, setPost] = useState<Post | null>(null)
  const [msg, setMsg] = useState('')

  // 도착하는 생성 이미지를 할당할 슬롯 큐 (제출 순서). 'thumb' 또는 블록 id.
  const pendingSlots = useRef<string[]>([])

  // 영구저장: 이미지 dataUrl(대용량)은 빼고 텍스트·프롬프트만 저장 (저장소 용량 보호)
  const postForSave: Post | null = post
    ? {
        ...post,
        thumbDataUrl: undefined,
        blocks: post.blocks.map((b) => (b.type === 'image' ? { ...b, dataUrl: undefined } : b))
      }
    : null
  usePersistedForm(
    'blog',
    { article, maxChars, imageCount, withThumb, imgSource, aspect, post: postForSave },
    (v) => {
      if (typeof v.article === 'string') setArticle(v.article)
      if (typeof v.maxChars === 'number') setMaxChars(v.maxChars)
      if (typeof v.imageCount === 'number') setImageCount(v.imageCount)
      if (typeof v.withThumb === 'boolean') setWithThumb(v.withThumb)
      if (v.imgSource) setImgSource(v.imgSource as ImageSource)
      if (typeof v.aspect === 'string') setAspect(v.aspect)
      if (v.post) setPost(v.post as Post)
    }
  )

  const [publishing, setPublishing] = useState(false)

  // 작업 중일 때만 확장의 실시간 진행상황(로그인 확인 / 프롬프트 입력 / 응답 대기 / 오류)을 표시.
  // (현재 진행 여부를 ref 로 추적 — 다른 뷰/쿨다운 잡음 메시지는 무시)
  const busyRef = useRef(false)
  busyRef.current = writing || genImages || publishing

  // 진입 시 항상 입력 탭에서 시작
  useEffect(() => { setTab('input') }, [])

  // 확장(automate.js)이 보내는 단계별 진행상황을 작업 중에만 메시지로 노출 → 어디서 막히는지 보임
  useEffect(() => {
    const off = window.electronAPI.bridge.onProgress((m: string) => {
      if (busyRef.current) setMsg(m)
    })
    return () => off()
  }, [])

  // 생성된 이미지가 도착하면 대기 중인 슬롯에 순서대로 채운다.
  useEffect(() => {
    const off = window.electronAPI.bridge.onImported((img: ImportedImage) => {
      if (img.source === 'other') return // 수동 업로드 이미지는 큐에서 소비하지 않음
      if (!isImagePath(img.path) || !isToday(img.importedAt)) return
      const slot = pendingSlots.current.shift()
      if (!slot) return
      readImage(img.path).then((dataUrl) => {
        if (!dataUrl) return
        setPost((p) => {
          if (!p) return p
          if (slot === 'thumb') return { ...p, thumbDataUrl: dataUrl, thumbPath: img.path }
          return {
            ...p,
            blocks: p.blocks.map((b) => (b.id === slot && b.type === 'image' ? { ...b, dataUrl, path: img.path } : b))
          }
        })
      })
      if (pendingSlots.current.length === 0) {
        setGenImages(false)
        setMsg('이미지 생성 완료')
      } else {
        setMsg(`이미지 받는 중… (남은 ${pendingSlots.current.length})`)
      }
    })
    return () => off()
  }, [])

  const textLen = post ? post.blocks.filter((b) => b.type === 'text').reduce((n, b) => n + (b as { text: string }).text.length, 0) : 0
  const imageBlocks = post ? post.blocks.filter((b): b is Extract<Block, { type: 'image' }> => b.type === 'image') : []

  // 새로고침 복원: 저장된 경로(path)는 있는데 dataUrl 이 비면 디스크에서 다시 읽어 미리보기 복구
  const pathsSig = post ? (post.thumbPath || '') + '|' + post.blocks.map((b) => (b.type === 'image' ? b.path || '' : '')).join(',') : ''
  useEffect(() => {
    if (!post) return
    if (post.thumbPath && !post.thumbDataUrl) readImage(post.thumbPath).then((d) => d && setPost((p) => (p ? { ...p, thumbDataUrl: d } : p)))
    post.blocks.forEach((b) => {
      if (b.type === 'image' && b.path && !b.dataUrl) readImage(b.path).then((d) => d && setPost((p) => (p ? { ...p, blocks: p.blocks.map((x) => (x.id === b.id && x.type === 'image' ? { ...x, dataUrl: d } : x)) } : p)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsSig])

  // 슬롯에 이미지 직접 업로드(붙여넣기/드롭/폴더) → 앱에 저장 후 슬롯 채움
  const uploadSlot = async (slotId: string, dataUrl: string) => {
    try {
      const img = await window.electronAPI.bridge.importImage({ source: 'other', dataUrl, filename: 'blog.png' })
      setPost((p) => {
        if (!p) return p
        if (slotId === 'thumb') return { ...p, thumbDataUrl: dataUrl, thumbPath: img.path }
        return { ...p, blocks: p.blocks.map((b) => (b.id === slotId && b.type === 'image' ? { ...b, dataUrl, path: img.path } : b)) }
      })
      setMsg('이미지 업로드 완료')
    } catch (e) {
      setMsg('이미지 업로드 실패')
    }
  }

  // 1) GPT로 글 작성
  const write = async () => {
    if (!article.trim()) { setMsg('기사 내용을 입력하세요.'); return }
    setWriting(true)
    setMsg('ChatGPT가 블로그 글을 작성 중… (크롬 탭에서 자동 실행)')
    try {
      const r = await window.electronAPI.bridge.generateText(buildPrompt(article.trim(), maxChars, imageCount, withThumb))
      if (!r.ok || !r.text) {
        setMsg(r.message || '글 작성 실패 — 크롬에서 ChatGPT 로그인과 TB MTOOL 확장을 확인하세요.')
        return
      }
      const j = extractJson(r.text)
      const rawBlocks = Array.isArray(j?.blocks) ? (j!.blocks as Array<Record<string, unknown>>) : null
      if (!j || !rawBlocks) { setMsg('응답 파싱 실패 — 다시 시도해보세요.'); return }
      const blocks: Block[] = rawBlocks
        .map((b): Block | null => {
          if (b.type === 'text' && typeof b.text === 'string') return { id: uid(), type: 'text', text: b.text }
          if (b.type === 'image' && typeof b.prompt === 'string') return { id: uid(), type: 'image', prompt: b.prompt }
          return null
        })
        .filter((b): b is Block => b !== null)
      setPost({
        title: typeof j.title === 'string' ? j.title : '',
        tags: Array.isArray(j.tags) ? (j.tags as unknown[]).map(String) : [],
        thumbPrompt: withThumb && typeof j.thumbPrompt === 'string' ? j.thumbPrompt : undefined,
        blocks
      })
      setTab('review')
      setMsg('글 작성 완료 — 검토 탭에서 확인하고 이미지를 생성하세요.')
    } finally {
      setWriting(false)
    }
  }

  // 2) 본문 이미지 + 썸네일 일괄 생성
  const generateImages = async () => {
    if (!post) return
    const slots: { id: string; prompt: string }[] = []
    if (post.thumbPrompt) slots.push({ id: 'thumb', prompt: post.thumbPrompt })
    imageBlocks.forEach((b) => slots.push({ id: b.id, prompt: b.prompt }))
    if (slots.length === 0) { setMsg('생성할 이미지 프롬프트가 없습니다.'); return }
    pendingSlots.current = slots.map((s) => s.id)
    setGenImages(true)
    const prompts = slots.map((s) => s.prompt)
    // Flow 는 쇼핑쇼츠와 동일하게 한 탭 파이프라인(generateFlowBatch)으로, ChatGPT 는 멀티탭 배치로.
    const r =
      imgSource === 'flow'
        ? (setMsg(`Flow 엔진으로 ${slots.length}장 생성 시작… (한 탭 순차 파이프라인) · 크롬 Flow 로그인 필요`),
          await window.electronAPI.bridge.generateFlowBatch(prompts, [], aspect))
        : (setMsg(`ChatGPT로 이미지 ${slots.length}장 생성 시작… (크롬 탭 ${slots.length}개)`),
          await window.electronAPI.bridge.generateBatch('chatgpt', prompts.map((p) => ({ prompt: p })), aspect))
    if (!r.ok) { pendingSlots.current = []; setGenImages(false); setMsg(r.message || '이미지 생성 실패 — 크롬 로그인/확장 확인') }
  }

  // 슬롯 1개만 재생성
  const regen = async (slotId: string, prompt: string) => {
    if (!prompt.trim()) return
    pendingSlots.current = [slotId, ...pendingSlots.current]
    setGenImages(true)
    setMsg(imgSource === 'flow' ? 'Flow 엔진으로 재생성 중…' : '이미지 재생성 중…')
    const r =
      imgSource === 'flow'
        ? await window.electronAPI.bridge.generateFlowBatch([prompt], [], aspect)
        : await window.electronAPI.bridge.generateBatch('chatgpt', [{ prompt }], aspect)
    if (!r.ok) {
      pendingSlots.current = pendingSlots.current.filter((s) => s !== slotId)
      if (pendingSlots.current.length === 0) setGenImages(false)
      setMsg(r.message || '재생성 실패')
    }
  }

  // 정지: 대기/진행 중인 모든 브릿지 작업 취소. 글 작성·이미지 생성 양쪽에서 사용.
  const stop = async () => {
    await window.electronAPI.bridge.cancel()
    pendingSlots.current = []
    setGenImages(false)
    setWriting(false)
    setPublishing(false)
    setMsg('정지했습니다.')
  }

  const patchBlock = (id: string, text: string) =>
    setPost((p) => (p ? { ...p, blocks: p.blocks.map((b) => (b.id === id && b.type === 'text' ? { ...b, text } : b)) } : p))

  const publish = async () => {
    if (!post) return
    if (!post.title.trim()) { setMsg('제목을 입력하세요.'); return }
    // 본문 블록을 발행 페이로드로 변환 (이미지 없는 image 블록은 건너뜀)
    const blocks = post.blocks
      .map((b) =>
        b.type === 'text'
          ? { type: 'text' as const, text: b.text }
          : b.dataUrl
            ? { type: 'image' as const, dataUrl: b.dataUrl }
            : null
      )
      .filter((b): b is { type: 'text'; text: string } | { type: 'image'; dataUrl: string } => b !== null)
    setPublishing(true)
    setMsg('티스토리 글쓰기 탭에 주입 중… (티스토리 글쓰기 페이지가 열려 있어야 합니다)')
    try {
      const r = await window.electronAPI.bridge.generateBlog({
        platform: 'tistory',
        title: post.title.trim(),
        tags: post.tags,
        thumbDataUrl: post.thumbDataUrl,
        blocks
      })
      setMsg(r.ok ? (r.message || '티스토리 에디터에 입력 완료 — 확인 후 ‘공개 발행’을 누르세요.') : (r.message || '발행 실패 — 티스토리 글쓰기 페이지와 블로그 확장을 확인하세요.'))
    } finally {
      setPublishing(false)
    }
  }

  const imagesDone = imageBlocks.filter((b) => b.dataUrl).length + (post?.thumbDataUrl ? 1 : 0)
  const imagesTotal = imageBlocks.length + (post?.thumbPrompt ? 1 : 0)

  const tabStyle = (active: boolean, disabled?: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9,
    border: '1px solid ' + (active ? '#346aff' : 'rgba(255,255,255,0.1)'),
    background: active ? '#346aff' : 'transparent',
    color: active ? '#fff' : disabled ? '#5a5f6b' : '#c9ccd6',
    cursor: disabled ? 'default' : 'pointer', fontSize: 13, fontWeight: 700, opacity: disabled ? 0.6 : 1
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 상단 탭 바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14 }}>
          <PenLine size={16} /> 블로그 자동화
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTab('input')} style={tabStyle(tab === 'input')}>
            <FileText size={14} /> 입력
          </button>
          <button onClick={() => setTab('review')} disabled={!post} style={tabStyle(tab === 'review', !post)}>
            <Eye size={14} /> 검토{post ? ' ✓' : ''}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 28px' }}>
        {/* ── 입력 탭 (좌: 기사 내용 · 우: 옵션) ── */}
        {tab === 'input' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 28, alignItems: 'stretch', minHeight: 'calc(100% - 2px)' }}>
            {/* 왼쪽: 기사 내용 */}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div className="igen-label">기사 내용</div>
              <textarea
                className="igen-textarea"
                style={{ flex: 1, minHeight: 'min(68vh, 620px)', resize: 'vertical', padding: 14, lineHeight: 1.6 }}
                value={article}
                onChange={(e) => setArticle(e.target.value)}
                placeholder={'블로그로 만들 기사/원문 내용을 붙여넣으세요.\nGPT가 이 내용을 바탕으로 제목·본문·태그를 작성하고, 본문 사이에 이미지를 배치합니다.'}
              />
              <div style={{ marginTop: 7, fontSize: 11, color: '#8b90a0' }}>{article.length.toLocaleString()}자 입력됨</div>
            </div>

            {/* 오른쪽: 생성 옵션 (카드) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, background: '#13151c', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 18, alignSelf: 'start' }}>
              <div>
                <div className="igen-label">글자수 (본문 최대)</div>
                <div className="igen-ratios">
                  {[1000, 1500, 2000, 3000].map((n) => (
                    <button key={n} className={`igen-ratio ${maxChars === n ? 'active' : ''}`} onClick={() => setMaxChars(n)}>
                      {n}자
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="igen-label">본문 이미지 수</div>
                <div className="igen-ratios">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button key={n} className={`igen-ratio ${imageCount === n ? 'active' : ''}`} onClick={() => setImageCount(n)}>
                      {n}장
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="igen-label">썸네일(대표이미지)</div>
                <div className="igen-ratios">
                  <button className={`igen-ratio ${withThumb ? 'active' : ''}`} onClick={() => setWithThumb(true)}>포함</button>
                  <button className={`igen-ratio ${!withThumb ? 'active' : ''}`} onClick={() => setWithThumb(false)}>없음</button>
                </div>
              </div>

              <div>
                <div className="igen-label">이미지 엔진</div>
                <div className="igen-seg">
                  <button className={`igen-seg-btn ${imgSource === 'chatgpt' ? 'active' : ''}`} onClick={() => setImgSource('chatgpt')}>ChatGPT</button>
                  <button className={`igen-seg-btn ${imgSource === 'flow' ? 'active' : ''}`} onClick={() => setImgSource('flow')}>Flow</button>
                </div>
                <div style={{ fontSize: 10.5, color: '#7a8090', marginTop: 5 }}>
                  {imgSource === 'flow' ? 'Flow: 한 탭에서 순차 생성(쇼핑쇼츠와 동일)' : 'ChatGPT: 여러 탭 동시 생성'}
                </div>
              </div>

              <div>
                <div className="igen-label">이미지 비율</div>
                <div className="igen-ratios">
                  {['16:9', '4:3', '1:1', '9:16', '3:4'].map((a) => (
                    <button key={a} className={`igen-ratio ${aspect === a ? 'active' : ''}`} onClick={() => setAspect(a)}>{a}</button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="igen-go" onClick={write} disabled={writing} style={{ flex: 1, marginTop: 0 }}>
                  {writing ? (<><Loader2 size={16} className="igen-spin" /> 글 작성 중…</>) : (<><Sparkles size={16} /> GPT로 블로그 글 작성</>)}
                </button>
                {writing && (
                  <button className="igen-go danger" onClick={stop} style={{ width: 'auto', whiteSpace: 'nowrap', marginTop: 0, padding: '12px 16px' }}>
                    <X size={16} /> 정지
                  </button>
                )}
              </div>
              {msg && <div className={`igen-msg ${/완료/.test(msg) ? 'ok' : ''}`}>{msg}</div>}
              <p className="igen-note" style={{ marginTop: 0 }}>※ ChatGPT 로그인 + TB MTOOL 확장 필요. 글 작성 후 ‘검토’ 탭에서 이미지를 생성합니다.</p>
            </div>
          </div>
        )}

        {/* ── 검토 탭 ── */}
        {tab === 'review' && post && (
          <div style={{ width: '100%' }}>
            {/* 액션 바 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <button className="igen-go" onClick={generateImages} disabled={genImages} style={{ width: 'auto', whiteSpace: 'nowrap', marginTop: 0 }}>
                {genImages ? (<><Loader2 size={16} className="igen-spin" /> 이미지 생성 중…</>) : (<><ImageIcon size={16} /> 이미지 생성 ({imagesTotal}장)</>)}
              </button>
              {genImages && (
                <button className="igen-go danger" onClick={stop} style={{ width: 'auto', whiteSpace: 'nowrap', marginTop: 0, padding: '12px 16px' }}>정지</button>
              )}
              <span className="igen-note" style={{ margin: 0 }}>이미지 {imagesDone}/{imagesTotal} · 본문 {textLen}/{maxChars}자</span>
              <div style={{ flex: 1 }} />
              <button className="igen-go" onClick={publish} disabled={publishing} style={{ width: 'auto', whiteSpace: 'nowrap', marginTop: 0 }}>
                {publishing ? (<><Loader2 size={16} className="igen-spin" /> 올리는 중…</>) : (<><UploadIcon size={16} /> 블로그 올리기</>)}
              </button>
              {publishing && (
                <button className="igen-go danger" onClick={stop} style={{ width: 'auto', whiteSpace: 'nowrap', marginTop: 0, padding: '12px 16px' }}>
                  <X size={16} /> 정지
                </button>
              )}
            </div>

            {/* 제목 */}
            <div className="igen-label">제목</div>
            <input className="igen-textarea" style={{ minHeight: 0 }} value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} />

            {/* 썸네일 */}
            {post.thumbPrompt && (
              <div style={{ marginTop: 16 }}>
                <div className="igen-label">썸네일(대표이미지)</div>
                <ImageSlot
                  dataUrl={post.thumbDataUrl}
                  prompt={post.thumbPrompt}
                  busy={genImages}
                  onPrompt={(t) => setPost({ ...post, thumbPrompt: t })}
                  onRegen={() => regen('thumb', post.thumbPrompt || '')}
                  onClear={() => setPost({ ...post, thumbDataUrl: undefined, thumbPath: undefined })}
                  onUpload={(d) => uploadSlot('thumb', d)}
                />
              </div>
            )}

            {/* 본문 블록 */}
            <div className="igen-label" style={{ marginTop: 18 }}>본문</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {post.blocks.map((b) =>
                b.type === 'text' ? (
                  <textarea
                    key={b.id}
                    className="igen-textarea"
                    rows={Math.max(2, Math.ceil(b.text.length / 50))}
                    value={b.text}
                    onChange={(e) => patchBlock(b.id, e.target.value)}
                  />
                ) : (
                  <ImageSlot
                    key={b.id}
                    dataUrl={b.dataUrl}
                    prompt={b.prompt}
                    busy={genImages}
                    onPrompt={(t) => setPost({ ...post, blocks: post.blocks.map((x) => (x.id === b.id && x.type === 'image' ? { ...x, prompt: t } : x)) })}
                    onRegen={() => regen(b.id, b.prompt)}
                    onClear={() => setPost({ ...post, blocks: post.blocks.map((x) => (x.id === b.id && x.type === 'image' ? { ...x, dataUrl: undefined, path: undefined } : x)) })}
                    onUpload={(d) => uploadSlot(b.id, d)}
                  />
                )
              )}
            </div>

            {/* 태그 */}
            <div className="igen-label" style={{ marginTop: 18 }}>태그 (쉼표로 구분)</div>
            <input
              className="igen-textarea"
              style={{ minHeight: 0 }}
              value={post.tags.join(', ')}
              onChange={(e) => setPost({ ...post, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
            />
            {msg && <div className={`igen-msg ${/완료/.test(msg) ? 'ok' : ''}`}>{msg}</div>}
            <p className="igen-note">※ 이미지는 도착하는 순서대로 슬롯에 채워집니다. 어긋나면 각 슬롯의 ↻(재생성)으로 맞추세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// 이미지 슬롯: 미리보기(드롭/붙여넣기/클릭 업로드) + 프롬프트 + 재생성/제거
function ImageSlot({
  dataUrl, prompt, busy, onPrompt, onRegen, onClear, onUpload
}: {
  dataUrl?: string
  prompt: string
  busy?: boolean
  onPrompt: (t: string) => void
  onRegen: () => void
  onClear: () => void
  onUpload: (dataUrl: string) => void
}) {
  const pick = async () => {
    const p = await window.electronAPI.fs.pickImage()
    if (!p) return
    const d = await window.electronAPI.fs.readImage(p)
    if (d) onUpload(d)
  }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const internal = e.dataTransfer.getData('text/avs-dataurl')
    if (internal) { onUpload(internal); return }
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
    if (f) onUpload(await fileToDataUrl(f))
  }
  const onPaste = async (e: React.ClipboardEvent) => {
    for (const it of Array.from(e.clipboardData?.items || [])) {
      if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); onUpload(await fileToDataUrl(f)); return } }
    }
  }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface-2)' }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div
          className="ss-drop"
          tabIndex={0}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onPaste={onPaste}
          onClick={() => !dataUrl && pick()}
          title={dataUrl ? '' : '클릭=폴더 · 드롭/붙여넣기로 업로드'}
          style={{
            width: 260, height: 146, flex: '0 0 auto',
            borderRadius: 8, overflow: 'hidden', background: '#0c0e14',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
            cursor: dataUrl ? 'default' : 'pointer'
          }}
        >
          {dataUrl ? (
            <img src={dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 6 }}>{busy ? '생성 중…' : '클릭·드롭·붙여넣기'}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            className="igen-textarea"
            style={{ minHeight: 0, fontSize: 12 }}
            rows={3}
            value={prompt}
            onChange={(e) => onPrompt(e.target.value)}
            placeholder="이미지 프롬프트 (영어 권장)"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="igen-act" onClick={onRegen} disabled={busy} title="이 이미지만 재생성">
              <RotateCw size={13} /> 재생성
            </button>
            <button className="igen-act" onClick={pick} title="폴더에서 이미지 업로드">
              <ImageIcon size={13} /> 업로드
            </button>
            {dataUrl && (
              <button className="igen-act" onClick={onClear} title="이미지 비우기">
                <X size={13} /> 비우기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
