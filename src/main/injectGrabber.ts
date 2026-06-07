// 앱 내부 임베드 창(ChatGPT/Flow)에 주입하는 "이미지 잡기" 스크립트.
// 크롬 확장 없이도, 앱이 연 창에서 이미지 위에 📥 버튼을 띄우고
// preload(window.__avsBridge)를 통해 IPC로 앱에 전송한다(페이지 CSP 우회).
//
// ChatGPT/Flow는 이미지 위에 투명 오버레이(편집·다운로드 레이어)를 덮어
// 마우스가 <img>에 직접 안 닿는다. 그래서 mousemove + elementsFromPoint 로
// 커서 아래 쌓인 요소들을 모두 훑어 그 밑의 <img>를 찾는다.

export function grabberScript(_port: number): string {
  return `(() => {
  if (window.__avsGrabber) return; window.__avsGrabber = true;
  if (!window.__avsBridge) { console.warn('[AVS] bridge preload 없음 — 주입 실패'); return; }
  console.log('[AVS] grabber 주입됨');
  const SOURCE = location.hostname.includes('labs.google') ? 'flow' : 'chatgpt';
  const MIN = 100;
  let cur = null, hideT = null;

  const btn = document.createElement('button');
  btn.textContent = '📥 앱으로 보내기';
  Object.assign(btn.style, {
    position:'fixed', zIndex:'2147483647', display:'none', padding:'8px 12px',
    fontSize:'13px', fontWeight:'700', color:'#fff', background:'#4f8cff',
    border:'none', borderRadius:'8px', cursor:'pointer',
    boxShadow:'0 4px 14px rgba(0,0,0,0.45)', fontFamily:'system-ui, sans-serif'
  });
  document.documentElement.appendChild(btn);

  // 커서 아래(오버레이 포함) 쌓인 요소들에서 충분히 큰 <img>를 찾는다
  function imgAt(x, y){
    const stack = document.elementsFromPoint(x, y) || [];
    for (const el of stack) {
      if (el.tagName === 'IMG') {
        const r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) return el;
      }
    }
    return null;
  }
  function showFor(img){
    const r = img.getBoundingClientRect();
    cur = img; btn.style.display='block';
    btn.style.top = (r.top + 8) + 'px';
    btn.style.left = (r.left + 8) + 'px';
  }
  function hide(){ btn.style.display='none'; cur=null; }

  let lastMove = 0;
  document.addEventListener('mousemove', e => {
    if (e.target === btn) return;
    const now = Date.now();
    if (now - lastMove < 60) return; lastMove = now;
    const img = imgAt(e.clientX, e.clientY);
    if (img){ clearTimeout(hideT); showFor(img); }
    else { clearTimeout(hideT); hideT = setTimeout(hide, 500); }
  }, true);
  btn.addEventListener('mouseenter', () => clearTimeout(hideT));
  window.addEventListener('scroll', hide, true);

  function blobToDataUrl(blob){
    return new Promise((res, rej) => {
      const fr = new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(blob);
    });
  }
  async function send(body){
    const j = await window.__avsBridge.sendImage(body);
    if (!j || !j.id) throw new Error('전송 실패');
    return j;
  }

  btn.addEventListener('click', async e => {
    e.preventDefault(); e.stopPropagation();
    if (!cur) return;
    const src = cur.currentSrc || cur.src;
    const label = btn.textContent;
    btn.textContent = '보내는 중…'; btn.disabled = true;
    try {
      if (!src) throw new Error('이미지 주소 없음');
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        const blob = await (await fetch(src)).blob();
        await send({ source: SOURCE, dataUrl: await blobToDataUrl(blob), pageUrl: location.href });
      } else {
        await send({ source: SOURCE, url: src, pageUrl: location.href });
      }
      btn.textContent = '✓ 보냈어요';
    } catch (err) {
      console.warn('[AVS] 전송 실패', err);
      btn.textContent = '✕ ' + String((err && err.message) || err);
    }
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1800);
  });
})();`
}
