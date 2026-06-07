// Grok(grok.com/imagine) 이미지→영상 자동화.
// grokauto 확장의 검증된 DOM 로직 참조:
//   비디오 모드 칩 → 종횡비 → 이미지 업로드(blob 프리뷰 검증) → 프롬프트(execCommand)
//   → 제출버튼 활성 대기 → Enter 제출 → video#hd-video/[src*=generated_video] 회수.
// Radix UI라 메뉴는 풀 포인터 시퀀스 필요. 창은 숨김, 진행 로그는 [AVS-GEN].

export function grokVideoScript(
  prompt: string,
  imageDataUrl: string,
  settings: { duration?: string; resolution?: string; aspect?: string } = {}
): string {
  const P = JSON.stringify(prompt || '')
  const IMG = JSON.stringify(imageDataUrl || '')
  const A = JSON.stringify(settings.aspect || '16:9')
  const DUR = JSON.stringify(settings.duration || '6')
  const RES = JSON.stringify(settings.resolution || '720p')
  return `(() => {
  const PROMPT = ${P};
  const IMG = ${IMG};
  const ASPECT = ${A};
  const DURATION = ${DUR};
  const QUALITY = ${RES};                                  // '480p' | '480p-upscale' | '720p'
  const RES_CHIP = QUALITY === '720p' ? '720p' : '480p';   // 업스케일은 480p로 생성 후 업스케일
  const log = (m) => console.log('[AVS-GEN]', m);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qs = (s, r = document) => { try { return r.querySelector(s); } catch { return null; } };
  const qsa = (s, r = document) => { try { return [...r.querySelectorAll(s)]; } catch { return []; } };

  const getInput = () => qs('div[contenteditable="true"]') || qs('textarea[placeholder]') || qs('[data-testid="prompt-textarea"]');
  const getForm = () => { const i = getInput(); return (i && i.closest('form')) || qs('form'); };

  function realClick(el){
    el.scrollIntoView({ block:'center' });
    const r = el.getBoundingClientRect();
    const o = { bubbles:true, cancelable:true, view:window, clientX:r.left+r.width/2, clientY:r.top+r.height/2, button:0, buttons:1 };
    el.dispatchEvent(new PointerEvent('pointerdown',{...o,pointerId:1,pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mousedown',o));
    el.dispatchEvent(new PointerEvent('pointerup',{...o,pointerId:1,pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mouseup',o));
    el.dispatchEvent(new MouseEvent('click',o));
  }
  function menuClick(el){
    el.scrollIntoView({ block:'center' });
    const r = el.getBoundingClientRect();
    const o = { bubbles:true, cancelable:true, view:window, clientX:r.left+r.width/2, clientY:r.top+r.height/2, button:0 };
    el.dispatchEvent(new PointerEvent('pointerenter',{...o,pointerId:1,pointerType:'mouse'}));
    el.dispatchEvent(new PointerEvent('pointermove',{...o,pointerId:1,pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mouseover',o));
    el.focus && el.focus();
    el.dispatchEvent(new PointerEvent('pointerdown',{...o,buttons:1,pointerId:1,pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mousedown',{...o,buttons:1}));
    el.dispatchEvent(new PointerEvent('pointerup',{...o,pointerId:1,pointerType:'mouse'}));
    el.dispatchEvent(new MouseEvent('mouseup',o));
    el.dispatchEvent(new MouseEvent('click',o));
  }
  function dataUrlToFile(dataUrl, name){
    const c = dataUrl.indexOf(','); const head = dataUrl.slice(0,c), b64 = dataUrl.slice(c+1);
    const mime = (head.match(/data:([^;]+)/)||[])[1] || 'image/png';
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new File([arr], name + '.' + (mime.split('/')[1]||'png'), { type:mime });
  }

  async function switchVideoMode(){
    const form = getForm(); if (!form) return false;
    for (const b of form.querySelectorAll('button')) {
      const t = (b.innerText||'').trim();
      if (t === '비디오' || t.toLowerCase() === 'video') {
        b.click(); await sleep(400);
        const d = b.querySelector('div'); if (d) { d.click(); await sleep(200); }
        return true;
      }
    }
    return false;
  }
  function chipActive(b){ return b.getAttribute('aria-checked')==='true' || b.getAttribute('aria-pressed')==='true' || b.getAttribute('data-state')==='on' || b.getAttribute('aria-selected')==='true'; }
  async function setChip(label){
    const form = getForm(); if (!form) return false;
    for (const b of form.querySelectorAll('button')) {
      if ((b.innerText||'').trim() === label) {
        if (chipActive(b)) return true;
        b.click(); await sleep(300); return true;
      }
    }
    return false;
  }
  async function setAspect(){
    const RAT = { '16:9':['16:9','16∶9'], '9:16':['9:16','9∶16'], '1:1':['1:1','1∶1'], '4:3':['4:3'], '3:4':['3:4'] };
    const labels = RAT[ASPECT]; if (!labels) return;
    let trig = qs('button[aria-label="종횡비"], button[aria-label="Aspect ratio"]');
    if (!trig) trig = qsa('button[aria-haspopup="menu"]').find(b => /^\\d+\\s*[∶:]\\s*\\d+$/.test((b.innerText||'').trim()));
    if (!trig) { log('종횡비 버튼 없음(스킵)'); return; }
    if (labels.some(l => (trig.innerText||'').trim() === l)) return;
    realClick(trig);
    for (let i=0;i<30;i++){ await sleep(100); if (qs('[data-radix-menu-content]')) break; }
    const item = qsa('[data-radix-menu-content] [role="menuitem"]').find(it => labels.some(l => (it.innerText||'').trim().includes(l)));
    if (item) { menuClick(item); await sleep(400); log('종횡비 ' + ASPECT + ' 적용'); }
    else { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); log('종횡비 항목 못찾음(스킵)'); }
  }
  async function uploadImage(){
    const form = getForm();
    const before = form ? form.querySelectorAll('img[src^="blob:"]').length : 0;
    let fi = qs('input[type="file"][accept*="image"]') || qs('input[type="file"]');
    const file = dataUrlToFile(IMG, 'board');
    if (fi) {
      const dt = new DataTransfer(); dt.items.add(file);
      fi.files = dt.files; fi.dispatchEvent(new Event('change',{bubbles:true}));
    } else {
      const target = getInput() || form;
      const dt = new DataTransfer(); dt.items.add(file);
      ['dragenter','dragover','drop'].forEach(t => target && target.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt})));
    }
    // blob 프리뷰가 before+1 도달 + 로드 완료까지 대기
    const start = Date.now();
    while (Date.now()-start < 8000) {
      const f = getForm();
      const imgs = f ? [...f.querySelectorAll('img[src^="blob:"]')] : [];
      const loaded = imgs.filter(im => im.complete && im.naturalWidth>0);
      if (loaded.length >= before+1) return true;
      await sleep(150);
    }
    log('주의: 업로드 프리뷰 확인 못함(계속 진행)');
    return false;
  }
  async function typePrompt(text){
    if (!text) return true;
    let input = getInput(); if (!input) return false;
    input.focus(); await sleep(150);
    // 기존 내용 제거
    try { const sel=window.getSelection(); const rng=document.createRange(); rng.selectNodeContents(input); sel.removeAllRanges(); sel.addRange(rng); document.execCommand('delete',false); } catch {}
    document.execCommand('insertText', false, text); await sleep(300);
    if ((input.textContent||'').includes(text.slice(0,10))) return true;
    // 폴백
    input = getInput(); input.focus(); input.textContent = text;
    input.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));
    await sleep(200);
    return (input.textContent||'').length > 0;
  }
  async function waitSubmitReady(timeout){
    const start = Date.now();
    while (Date.now()-start < timeout) {
      const btn = qs('form button[type="submit"]');
      if (btn && !btn.disabled) return true;
      await sleep(100);
    }
    return false;
  }
  function submitEnter(){
    const input = getInput(); if (!input) return false;
    input.focus();
    const p = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true };
    input.dispatchEvent(new KeyboardEvent('keydown',p));
    input.dispatchEvent(new KeyboardEvent('keypress',p));
    input.dispatchEvent(new KeyboardEvent('keyup',p));
    return true;
  }
  function clickSend(){
    const c = qs('form div.absolute.right-2.bottom-0');
    if (c) { const b = c.querySelector('button'); if (b) { b.click(); return true; } }
    const b = qs('button[aria-label="제출"], button[aria-label="Send"], button[aria-label="Submit"], button[data-testid="send-button"]');
    if (b) { b.click(); return true; }
    return false;
  }
  function foundVideo(){
    const vids = qsa('video#hd-video, video#sd-video, video[src*="generated_video"]');
    for (const v of vids) { const s = v.src || (v.querySelector('source') && v.querySelector('source').src); if (s) return { v, s }; }
    return null;
  }

  // 480p → 720p 업스케일: "추가 옵션" 메뉴 → "동영상 업스케일"
  async function clickUpscale(){
    let more = null; const start = Date.now();
    while (Date.now()-start < 30000) {
      const byLabel = qsa('button[aria-label="추가 옵션"], button[aria-label="More options"]');
      if (byLabel.length) { more = byLabel[byLabel.length-1]; break; }
      const menuBtns = qsa('button[aria-haspopup="menu"]');
      for (let i=menuBtns.length-1;i>=0;i--){ if (menuBtns[i].querySelector('circle') || menuBtns[i].querySelector('.lucide-ellipsis')) { more = menuBtns[i]; break; } }
      if (more) break;
      await sleep(1000);
    }
    if (!more) { log('업스케일: 추가옵션 버튼 못찾음'); return false; }
    for (let a=0;a<3;a++){ realClick(more); await sleep(700); if (qs('[data-radix-popper-content-wrapper]') || qs('[data-radix-menu-content]')) break; }
    for (let a=0;a<6;a++){
      const up = qsa('[role="menuitem"]').find(it => { const t=(it.innerText||''); return t.includes('업스케일') || t.toLowerCase().includes('upscale'); });
      if (up) { menuClick(up); return true; }
      await sleep(600);
    }
    document.body.click(); log('업스케일 메뉴 항목 못찾음'); return false;
  }
  async function waitUpscale(timeout){
    const start = Date.now(); let lastChange = Date.now();
    const getSrc = () => { const vs=qsa('video'); const v=vs[vs.length-1]; return v ? (v.src || (v.querySelector('source') && v.querySelector('source').src) || '') : ''; };
    const initial = getSrc();
    const obs = new MutationObserver(()=>{ lastChange = Date.now(); });
    obs.observe(document.body, {childList:true,subtree:true,attributes:true});
    while (Date.now()-start < timeout) {
      await sleep(2000);
      const elapsed = Date.now()-start, since = Date.now()-lastChange;
      const upscaling = !!qs('[class*="animate-pulse-lg"]');
      const cur = getSrc();
      if (!upscaling && elapsed>5000 && since>3000) { obs.disconnect(); return true; }
      if (initial && cur && cur!==initial && since>3000) { obs.disconnect(); return true; }
      if (elapsed>15000 && since>8000) { obs.disconnect(); return true; }
    }
    obs.disconnect(); return false;
  }

  (async () => {
    try {
      log('Grok 준비 중…');
      let input = getInput(), t=0;
      while (!input && t++<24) { await sleep(500); input = getInput(); }
      if (!input) { log('실패: 입력창을 찾지 못함 (Grok 로그인/​/imagine 확인)'); return; }

      log('비디오 모드 선택 중…');
      if (!await switchVideoMode()) log('주의: 비디오 칩 못찾음(계속 진행)');
      await sleep(300);

      log('종횡비/화질/길이 설정 중…');
      await setAspect();
      await setChip(RES_CHIP);
      await setChip(DURATION + 's');

      log('이미지 업로드 중…');
      await uploadImage();
      await sleep(500);

      log('프롬프트 입력 중…');
      await typePrompt(PROMPT);
      await sleep(300);

      log('업로드 완료 대기 중…');
      await waitSubmitReady(120000);

      if (!submitEnter()) clickSend();
      await sleep(2000);
      // Enter 실패 대비 send 클릭
      if (qs('form button[type="submit"]') && !qs('form button[type="submit"]').disabled) clickSend();
      log('전송됨 · 영상 생성 대기 중…');

      // 영상 대기 (최대 ~6분)
      let res=null;
      for (let i=0;i<240;i++){
        await sleep(1500);
        if (i>0 && i%16===0) log('영상 생성 대기 중… (' + Math.round(i*1.5) + '초)');
        const f = foundVideo();
        if (f) { const s1=f.s; await sleep(3000); const f2=foundVideo(); if (f2 && f2.s===s1) { res=f2; break; } }
      }
      if (!res) { log('실패: 시간 초과 — 생성 영상을 찾지 못함'); return; }

      // 480p 업스케일 옵션이면 업스케일 실행 후 결과 영상으로 갱신
      if (QUALITY === '480p-upscale') {
        log('480p → 720p 업스케일 중…');
        if (await clickUpscale()) { await waitUpscale(180000); await sleep(1500); const f3 = foundVideo(); if (f3) res = f3; }
      }

      log('영상 가져오는 중…');
      const src = res.s;
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        const blob = await (await fetch(src)).blob();
        const dataUrl = await new Promise((rs,rj)=>{ const fr=new FileReader(); fr.onload=()=>rs(fr.result); fr.onerror=rj; fr.readAsDataURL(blob); });
        await window.__avsBridge.sendImage({ source:'grok', dataUrl, pageUrl: location.href });
      } else {
        await window.__avsBridge.sendImage({ source:'grok', url: src, pageUrl: location.href });
      }
      // 숨김 창에서 영상이 계속 재생/소리나지 않게 정지·음소거
      try { qsa('video').forEach(v => { v.pause(); v.muted = true; v.loop = false; }); } catch {}
      log('완료');
    } catch (e) {
      log('자동화 오류: ' + ((e && e.message) || e));
    }
  })();
  return 'started';
})();`
}
