// content script — ChatGPT / Google Flow 페이지의 이미지 위에
// "📥 앱으로 보내기" 떠있는 버튼을 붙인다. 클릭하면 그 이미지를 앱으로 전송.
;(() => {
  const SOURCE = location.hostname.includes('labs.google') ? 'flow' : 'chatgpt'
  const MIN = 128 // 이 크기 미만(아이콘 등)은 무시

  let currentImg = null
  let hideTimer = null

  const btn = document.createElement('button')
  btn.textContent = '📥 앱으로 보내기'
  Object.assign(btn.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    padding: '7px 12px',
    fontSize: '13px',
    fontWeight: '700',
    color: '#fff',
    background: '#4f8cff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
    fontFamily: 'system-ui, sans-serif'
  })
  document.documentElement.appendChild(btn)

  function place(img) {
    const r = img.getBoundingClientRect()
    if (r.width < MIN || r.height < MIN) return hide()
    currentImg = img
    btn.style.display = 'block'
    btn.style.top = r.top + 8 + 'px'
    btn.style.left = r.left + 8 + 'px'
  }
  function hide() {
    btn.style.display = 'none'
    currentImg = null
  }

  document.addEventListener(
    'mouseover',
    (e) => {
      const img = e.target.closest && e.target.closest('img')
      if (img) {
        clearTimeout(hideTimer)
        place(img)
      }
    },
    true
  )
  document.addEventListener(
    'mouseout',
    (e) => {
      if (e.target === btn) return
      clearTimeout(hideTimer)
      hideTimer = setTimeout(hide, 400)
    },
    true
  )
  btn.addEventListener('mouseover', () => clearTimeout(hideTimer))
  btn.addEventListener('mouseout', () => {
    hideTimer = setTimeout(hide, 400)
  })
  // 스크롤하면 위치가 어긋나므로 숨김
  window.addEventListener('scroll', hide, true)

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = reject
      fr.readAsDataURL(blob)
    })
  }

  // background(우클릭 메뉴)가 blob:/data: 이미지를 부탁하면 페이지 안에서 변환해 전달
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'grab' && msg.src) {
      ;(async () => {
        try {
          const blob = await (await fetch(msg.src)).blob()
          const dataUrl = await blobToDataUrl(blob)
          const r = await chrome.runtime.sendMessage({
            type: 'image',
            source: msg.source,
            dataUrl,
            pageUrl: location.href
          })
          sendResponse(r)
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) })
        }
      })()
      return true
    }
    return false
  })

  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentImg) return
    const src = currentImg.src
    const label = btn.textContent
    btn.textContent = '보내는 중…'
    btn.disabled = true
    try {
      let payload
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        // blob:/data: 는 페이지 안에서만 접근 가능 → 여기서 dataURL로 변환
        const blob = await (await fetch(src)).blob()
        payload = { type: 'image', source: SOURCE, dataUrl: await blobToDataUrl(blob), pageUrl: location.href }
      } else {
        // http(s) 는 background가 받아서 다운로드(교차출처 우회)
        payload = { type: 'image', source: SOURCE, url: src, pageUrl: location.href }
      }
      const r = await chrome.runtime.sendMessage(payload)
      btn.textContent = r?.ok ? '✓ 보냈어요' : '✕ ' + (r?.error || '실패')
    } catch (err) {
      btn.textContent = '✕ ' + String(err?.message || err)
    }
    setTimeout(() => {
      btn.textContent = label
      btn.disabled = false
    }, 1800)
  })
})()
