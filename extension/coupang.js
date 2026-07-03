// TB MTOOL — 쿠팡 상품페이지 정보 추출 브릿지 (ISOLATED world).
// 사용자의 진짜 브라우저(로그인 세션)에서 DOM 을 직접 읽으므로 403/봇차단 없이 상품정보를 뽑는다.
// flow.js 와 같은 규약: 앱(로컬 서버)을 폴링해 source=coupang 작업을 받으면 그 URL 의 상품을
// 추출해 앱으로 보낸다. 더해서, 상품 위에 떠있는 "📥 앱으로 상품 보내기" 버튼으로 수동 전송도 가능.
;(() => {
  const log = (m) => console.log('[AVS-COUPANG]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r))
      } catch (e) {
        resolve(null)
      }
    })
  const WORKER_ID = 'w-' + Math.random().toString(36).slice(2, 10)
  let busy = false

  // ── DOM 추출 유틸 ───────────────────────────────────────────────────────
  // 쿠팡은 마크업이 자주 바뀌므로 셀렉터를 여러 개 두고 처음 잡히는 걸 쓴다.
  const qs = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s)
      if (el) return el
    }
    return null
  }
  const text = (sels) => {
    const el = qs(sels)
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : ''
  }
  // "12,900원" → 12900
  const numFrom = (s) => {
    const m = String(s || '').replace(/[^\d]/g, '')
    return m ? parseInt(m, 10) : null
  }
  // '//' 프로토콜 상대경로·webp 확장자 정규화
  const absUrl = (u) => {
    if (!u) return ''
    if (u.startsWith('//')) return 'https:' + u
    return u
  }

  // JSON-LD 구조화 데이터에서 상품 정보 추출 (가장 안정적 — 클래스 변경 영향 없음).
  // 쿠팡은 application/ld+json 에 Product 스키마(offers.price 등)를 넣어둔다.
  function fromJsonLd() {
    const nodes = []
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const j = JSON.parse(s.textContent)
        Array.isArray(j) ? nodes.push(...j) : nodes.push(j)
        if (j && Array.isArray(j['@graph'])) nodes.push(...j['@graph'])
      } catch (e) {
        /* 파싱 실패 무시 */
      }
    })
    const isProduct = (n) => {
      const t = n && n['@type']
      return t === 'Product' || (Array.isArray(t) && t.includes('Product'))
    }
    const prod = nodes.find(isProduct)
    if (!prod) return {}
    const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers
    const price = offers && offers.price != null ? numFrom(String(offers.price)) : null
    const image = Array.isArray(prod.image) ? prod.image[0] : prod.image
    return { name: prod.name || '', price, image }
  }

  function onProductPage() {
    return /\/vp\/products\/\d+/.test(location.pathname)
  }
  function productIdFromUrl(u) {
    const m = String(u || location.href).match(/\/vp\/products\/(\d+)/)
    return m ? m[1] : null
  }

  // 상품명 추출 — 클래스가 자주 바뀌므로 og:title/h1/document.title 폴백을 둔다.
  function extractName() {
    const byClass = text([
      'h1.prod-buy-header__title',
      '.prod-buy-header__title',
      'h2.prod-buy-header__title',
      '.product-title',
      '[class*="ProductTitle"]'
    ])
    if (byClass) return byClass
    const og = document.querySelector('meta[property="og:title"]')
    if (og && og.content) return og.content.trim()
    const h1 = document.querySelector('h1')
    if (h1 && h1.textContent.trim()) return h1.textContent.trim().replace(/\s+/g, ' ')
    // document.title: "상품명 - 쿠팡!" 형태 → 접미사 제거
    return (document.title || '').replace(/\s*[-|]\s*쿠팡!?.*$/, '').trim()
  }

  // 상품 대표/썸네일 이미지 URL 수집 (소재 후보). lazy-load 의 data-src 도 본다.
  function collectImages() {
    const urls = []
    const seen = new Set()
    // 리뷰사진/프로필/뱃지/배너/아이콘 등 상품과 무관한 이미지 제외
    const bad = /(PRODUCTREVIEW|productreview|\/profile\/|\/icon|badge|logo|rocket|event|banner|sprite|coupang_logo|\.gif)/i
    const push = (u) => {
      u = absUrl(u)
      if (!u) return
      u = u.split('?')[0]
      if (!/coupangcdn\.com|coupang\.com/.test(u)) return
      if (bad.test(u)) return
      if (seen.has(u)) return
      seen.add(u)
      urls.push(u)
    }
    // 1) og:image, 2) JSON-LD image (가장 안정적인 대표 이미지)
    const ogImg = document.querySelector('meta[property="og:image"]')
    if (ogImg && ogImg.content) push(ogImg.content)
    const ld = fromJsonLd()
    if (ld.image) push(ld.image)
    // 3) 상세 대표 + 썸네일 갤러리 (상품 이미지 영역으로 한정)
    document
      .querySelectorAll('img.prod-image__detail, .prod-image__detail img, .prod-image__items img, ul.prod-image__items img')
      .forEach((img) => push(img.getAttribute('src') || img.getAttribute('data-src')))
    // 썸네일은 보통 .../...4xN.jpg 처럼 작은 사이즈 → 원본 큰 사이즈로 치환 시도
    return urls.slice(0, 8).map((u) => u.replace(/\/\d+x\d+(ex)?\//, '/492x492ex/'))
  }

  // 제품 영상 URL 수집 (있을 때만). mp4 직링크 / og:video / 페이지 소스의 mp4·m3u8 스캔.
  function collectVideos() {
    const urls = new Set()
    const push = (u) => {
      u = absUrl(u)
      if (u && /\.(mp4|m3u8)(\?|#|$)/i.test(u)) urls.add(u.split('#')[0])
    }
    document.querySelectorAll('video').forEach((v) => {
      push(v.getAttribute('src') || v.currentSrc)
      v.querySelectorAll('source').forEach((s) => push(s.getAttribute('src')))
    })
    const og = document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]')
    if (og && og.content) push(og.content)
    // 베스트에포트: 페이지 소스(JSON 포함)에서 영상 URL 스캔
    try {
      const m = document.documentElement.innerHTML.match(/https?:\\?\/\\?\/[^"'\\]+\.(?:mp4|m3u8)[^"'\\]*/gi)
      ;(m || []).slice(0, 8).forEach((u) => push(u.replace(/\\\//g, '/')))
    } catch (e) {
      /* 무시 */
    }
    return [...urls].slice(0, 5)
  }

  // 신형 마크업(twc- Tailwind, 클래스 수시 변경)용 가격 추출 — 클래스 대신 스타일 휴리스틱.
  // 판매가: 취소선 없는 "N원" 중 글자가 가장 큰 것(구매박스의 큰 빨간 가격).
  // 원가: 취소선(line-through / del·s 조상) 있는 "N원" 중 판매가와 세로로 가장 가까운 것.
  // 할인율: 판매가 근처의 "55%" 형태 단독 텍스트.
  function extractPricesByStyle() {
    const cands = []
    document.querySelectorAll('span, strong, div, del, s, b, em, ins').forEach((el) => {
      if (el.childElementCount > 2) return
      const t = (el.textContent || '').trim()
      if (!/^[\d,]{2,}원$/.test(t)) return
      const v = numFrom(t)
      if (!v || v < 100) return
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const absTop = r.top + window.scrollY
      if (absTop > 3000) return // 구매박스는 페이지 상단 — 리뷰/추천상품 가격 제외
      const cs = getComputedStyle(el)
      const lineThrough =
        ((cs.textDecorationLine || cs.textDecoration || '').indexOf('line-through') !== -1) || !!el.closest('del, s, strike')
      cands.push({ v, absTop, fs: parseFloat(cs.fontSize) || 0, lineThrough })
    })
    if (!cands.length) return {}
    const sale = cands.filter((c) => !c.lineThrough).sort((a, b) => b.fs - a.fs || a.absTop - b.absTop)[0]
    if (!sale) return {}
    const orig = cands
      .filter((c) => c.lineThrough && c.v > sale.v)
      .sort((a, b) => Math.abs(a.absTop - sale.absTop) - Math.abs(b.absTop - sale.absTop))[0]
    // 판매가 근처(세로 ±200px)의 "NN%" 단독 요소 = 할인율
    let discount = null
    document.querySelectorAll('span, div, b, em, strong').forEach((el) => {
      if (discount != null || el.childElementCount > 0) return
      const t = (el.textContent || '').trim()
      const m = t.match(/^(\d{1,2})\s*%$/)
      if (!m) return
      const r = el.getBoundingClientRect()
      if (r.width <= 0) return
      const absTop = r.top + window.scrollY
      if (Math.abs(absTop - sale.absTop) <= 200) discount = parseInt(m[1], 10)
    })
    return { price: sale.v, originalPrice: orig ? orig.v : null, discount }
  }

  // 별점: 보통 너비 %(예: width:96%)로 표현 → 5점 만점 환산
  function extractRating() {
    const star = qs(['.rating-star-num', '.rds-rating__star-foreground', '[class*="rating"] [style*="width"]'])
    if (star) {
      const w = (star.getAttribute('style') || '').match(/width:\s*([\d.]+)%/)
      if (w) return Math.round((parseFloat(w[1]) / 20) * 10) / 10 // 100%→5.0
    }
    const num = text(['.rds-rating__score', '.prod-buy-header__rating'])
    const f = parseFloat(num)
    return isNaN(f) ? null : f
  }

  // 상품평 개수: "상품평 (13)" 탭에서 (숫자가 붙은 첫 요소).
  function extractReviewCount() {
    const els = [...document.querySelectorAll('a, button, h2, h3, span')]
    for (const e of els) {
      const m = ((e.textContent || '').trim()).match(/상품평\s*\(?\s*([\d,]+)\s*\)?/)
      if (m) return numFrom(m[1])
    }
    return null
  }

  // 한 article 의 별점(채워진 별 개수, 반별 0.5)
  function ratingOf(article) {
    const full = article.querySelectorAll('i[class*="full-star"]').length
    const half = article.querySelectorAll('i[class*="half-star"]').length
    return full ? full + half * 0.5 : null
  }

  // 개별 상품평 추출 → [{rating, date, title, body}]. 평점 높은 순 정렬.
  function extractReviews(limit) {
    const out = []
    document.querySelectorAll('article').forEach((a) => {
      if (!a.querySelector('[data-review-id]')) return // 리뷰 article 만
      const rating = ratingOf(a)
      // 날짜 (YYYY.MM.DD)
      let date = ''
      a.querySelectorAll('div').forEach((d) => {
        const t = (d.textContent || '').trim()
        if (!date && /^\d{4}\.\d{2}\.\d{2}$/.test(t)) date = t
      })
      const titleEl = a.querySelector('div[class*="twc-mb-[8px]"][class*="font-bold"]')
      const title = titleEl ? titleEl.textContent.trim() : ''
      const bodyEl = a.querySelector('div[class*="break-all"]')
      const body = bodyEl ? bodyEl.textContent.trim().replace(/\s+/g, ' ') : ''
      if (rating || title || body) out.push({ rating, date, title, body })
    })
    // 텍스트(제목/본문) 있는 후기 우선 → 평점 desc → 본문 긴 순(정보량) 정렬
    const hasText = (r) => (r.body || r.title ? 1 : 0)
    out.sort(
      (x, y) =>
        hasText(y) - hasText(x) ||
        (y.rating || 0) - (x.rating || 0) ||
        (y.body || '').length - (x.body || '').length
    )
    return limit ? out.slice(0, limit) : out
  }

  // 속성 만족도 요약: [{label:'전송 속도', value:'아주 빨라요', percent:100}]
  function extractAttributes() {
    const out = []
    document.querySelectorAll('div').forEach((row) => {
      const kids = row.children
      if (kids.length !== 3) return
      const label = (kids[0].textContent || '').trim()
      const value = (kids[1].textContent || '').trim()
      const pct = (kids[2].textContent || '').trim()
      // 라벨이 짧은 한글 속성명 + 값이 "~해요/~빨라요" + % 형태일 때만
      if (label && value && /%$/.test(pct) && label.length <= 8 && value.length <= 12 && !/%/.test(value)) {
        out.push({ label, value, percent: numFrom(pct) })
      }
    })
    // 중복 라벨 제거(요약 패널과 상세가 겹칠 수 있음)
    const seen = new Set()
    return out.filter((a) => (seen.has(a.label) ? false : seen.add(a.label)))
  }

  function extractProduct() {
    const ld = fromJsonLd()
    const name = extractName() || ld.name
    // 가격: 스타일 휴리스틱(신형 마크업) → 구형 셀렉터 → JSON-LD offers.price.
    // JSON-LD 는 할인 전 정가를 넣는 경우가 있어 마지막 폴백으로만 쓴다.
    const styled = extractPricesByStyle()
    let price = numFrom(
      text([
        '.total-price strong',
        '.prod-sale-price .total-price strong',
        '.prod-price .total-price',
        '.price-amount'
      ])
    )
    let originalPrice = numFrom(text(['.origin-price', '.prod-origin-price', 'del.origin-price']))
    if (styled.price != null && styled.originalPrice != null) {
      // 판매가+취소선 원가를 모두 찾음 = 확실한 할인 상품 — 스타일 결과 우선
      price = styled.price
      originalPrice = styled.originalPrice
    } else {
      if (price == null) price = styled.price != null ? styled.price : ld.price
      if (originalPrice == null) originalPrice = styled.originalPrice != null ? styled.originalPrice : null
    }
    // 원가가 현재가보다 낮거나 같으면(잘못 잡힘) 버림
    if (originalPrice != null && price != null && originalPrice <= price) originalPrice = null
    let discount = numFrom(text(['.discount-percentage', '.prod-discount-rate']))
    if (discount == null && styled.discount != null) discount = styled.discount
    // 할인율 못 찾고 원가>현재가면 계산
    if (discount == null && price && originalPrice && originalPrice > price) {
      discount = Math.round((1 - price / originalPrice) * 100)
    }
    const images = collectImages()
    const videos = collectVideos()
    // 1페이지 리뷰에서 텍스트 있는 후기 우선 정렬, 상위 일부만
    const reviews = extractReviews(15)
    let reviewCount = extractReviewCount() // "상품평 (13)" 탭 숫자 우선
    if (reviewCount == null) reviewCount = numFrom(text(['.prod-buy-header__rating-count', '.js_reviewArticleCountWithBreak']))
    if (reviewCount == null && reviews.length) reviewCount = reviews.length
    let rating = extractRating()
    if (rating == null && reviews.length) {
      const rated = reviews.filter((r) => r.rating)
      if (rated.length) rating = Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10
    }
    return {
      productId: productIdFromUrl(),
      url: location.href.split('?')[0],
      name,
      price,
      originalPrice,
      discount,
      rating,
      reviewCount,
      images,
      videos,
      reviews,
      attributes: extractAttributes(),
      capturedAt: new Date().toISOString()
    }
  }

  // ── 앱 전송 ────────────────────────────────────────────────────────────
  async function sendProduct(product, jobId) {
    const r = await send({ type: 'product', source: 'coupang', product, pageUrl: location.href, jobId })
    if (!r || !r.ok) throw new Error((r && r.error) || '앱 전송 실패')
    return r
  }

  // 상품평은 스크롤해야 lazy-load 되므로, 추출 전에 리뷰 영역으로 스크롤해 로딩을 유도한다.
  async function loadReviews() {
    try {
      const anchor = [...document.querySelectorAll('a, h2, h3, h4')].find((e) =>
        /상품평|상품 리뷰/.test(e.textContent || '')
      )
      const target = anchor || document.querySelector('article')
      if (!target) return
      target.scrollIntoView({ block: 'center' })
      await sleep(1200)
      window.scrollBy(0, 700)
      await sleep(900)
    } catch (e) {
      /* 스크롤 실패는 무시 — 리뷰 없이 진행 */
    }
  }

  // ── 떠있는 수동 버튼 ────────────────────────────────────────────────────
  function mountButton() {
    if (!onProductPage() || document.getElementById('__avs_coupang_btn')) return
    const btn = document.createElement('button')
    btn.id = '__avs_coupang_btn'
    btn.textContent = '📥 앱으로 상품 보내기'
    Object.assign(btn.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '2147483647',
      padding: '11px 16px',
      fontSize: '14px',
      fontWeight: '700',
      color: '#fff',
      background: '#346aff',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      fontFamily: 'system-ui, sans-serif'
    })
    btn.addEventListener('click', async () => {
      const label = btn.textContent
      btn.disabled = true
      try {
        btn.textContent = '리뷰 불러오는 중…'
        await loadReviews()
        const product = extractProduct()
        log(product)
        if (!product.name) throw new Error('상품명을 못 찾음(페이지 구조 변경?)')
        btn.textContent = '보내는 중… (리뷰 ' + (product.reviews ? product.reviews.length : 0) + ')'
        await sendProduct(product)
        btn.textContent = '✓ 보냈어요 (리뷰 ' + (product.reviews ? product.reviews.length : 0) + ')'
      } catch (e) {
        btn.textContent = '✕ ' + String((e && e.message) || e)
      }
      setTimeout(() => {
        btn.textContent = label
        btn.disabled = false
      }, 2200)
    })
    document.documentElement.appendChild(btn)
  }

  // ── 앱 주도 폴링(앱이 상품 URL 작업을 큐에 넣고, 그 탭에서 추출) ──────────
  async function tick() {
    if (!onProductPage()) return
    const r = await send({ type: 'poll', source: 'coupang', worker: WORKER_ID, ready: busy ? 0 : 1 })
    if (busy) return
    const job = r && r.job
    if (!job) return
    busy = true
    const report = (m) => {
      log(m)
      send({ type: 'job-status', id: job.id, status: 'progress', message: m })
    }
    try {
      // 작업 URL 이 현재 페이지와 다르면 이동(이동 후 새 content script 가 이어받음)
      if (job.url && job.url.split('?')[0] !== location.href.split('?')[0]) {
        report('상품 페이지로 이동…')
        location.href = job.url
        return
      }
      report('리뷰·상품 정보 추출 중…')
      await sleep(800) // lazy-load 이미지 대기
      await loadReviews()
      const product = extractProduct()
      if (!product.name) throw new Error('상품명을 못 찾음')
      await sendProduct(product, job.id)
      await send({ type: 'job-status', id: job.id, status: 'done', message: '완료', text: JSON.stringify(product) })
      log('완료: ' + product.name)
    } catch (e) {
      const m = (e && e.message) || String(e)
      await send({ type: 'job-status', id: job.id, status: 'error', message: m })
      log('오류: ' + m)
    } finally {
      busy = false
    }
  }

  setInterval(mountButton, 1500)
  setInterval(tick, 3000)
  mountButton()
  log('TB MTOOL 쿠팡 추출 대기 시작')
})()
