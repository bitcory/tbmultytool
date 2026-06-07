// suno.com 음악 생성 자동화 — 주입 스크립트.
// SUNO는 합성 포인터 시퀀스(trustedClick)를 진짜 클릭으로 받아들이므로 CDP 불필요.
// 폼 채우기 → Create → 새 clip 2개의 songId 회수까지만 페이지에서 수행하고,
// 실제 오디오(mp3)는 main 이 https://cdn1.suno.ai/<songId>.mp3 를 재시도 폴링해서 받는다.

export type SunoMode = 'simple' | 'advanced'
export interface SunoFields {
  description?: string // simple
  instrumental?: boolean // simple
  style?: string // advanced
  lyrics?: string // advanced
  title?: string // advanced
}

// 폼 채우고 Create → 새 곡 songId 2개 반환. { ok, songIds:[...] } | { ok:false, error }
export function sunoMusicScript(mode: SunoMode, fields: SunoFields): string {
  const MODE = JSON.stringify(mode)
  const F = JSON.stringify(fields || {})
  return `(async()=>{try{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const log=m=>console.log('[AVS-GEN]', m);
  const isVisible=el=>{if(!el)return false;const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;const s=getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none';};
  const qV=(sels)=>{for(const sel of sels){try{for(const el of document.querySelectorAll(sel)){if(isVisible(el))return el;}}catch(e){}}return null;};
  const findByText=(tag,txt)=>[...document.querySelectorAll(tag)].find(e=>isVisible(e)&&(e.textContent||'').trim()===txt)||[...document.querySelectorAll(tag)].find(e=>isVisible(e)&&(e.textContent||'').trim().includes(txt));
  function trustedClick(el){const r=el.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const b={bubbles:true,cancelable:true,view:window,button:0,clientX:x,clientY:y,pointerType:'mouse',isPrimary:true};el.dispatchEvent(new PointerEvent('pointerdown',{...b,buttons:1}));el.dispatchEvent(new MouseEvent('mousedown',{...b,buttons:1}));el.dispatchEvent(new PointerEvent('pointerup',{...b,buttons:0}));el.dispatchEvent(new MouseEvent('mouseup',{...b,buttons:0}));el.dispatchEvent(new MouseEvent('click',{...b,buttons:0}));}
  async function setFieldValue(el,value){el.focus();await sleep(50);if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){const proto=el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));await sleep(80);return el.value===value;}return false;}
  function findSimpleDesc(){for(const el of document.querySelectorAll('textarea')){if(!isVisible(el))continue;if(el.closest('[data-testid="lyrics-textarea"]'))continue;if(el.closest('[data-testid="create-form-styles-wrapper"]'))continue;return el;}return null;}
  function snapshotIds(){const s=new Set();for(const row of document.querySelectorAll('[data-testid="clip-row"]')){const a=row.querySelector('a[href*="/song/"]');const m=a&&(a.getAttribute('href')||'').match(/\\/song\\/([\\w-]+)/);if(m)s.add(m[1]);}return s;}
  function newIds(before){const out=[];for(const row of document.querySelectorAll('[data-testid="clip-row"]')){const a=row.querySelector('a[href*="/song/"]');const m=a&&(a.getAttribute('href')||'').match(/\\/song\\/([\\w-]+)/);if(m&&!before.has(m[1])&&out.indexOf(m[1])<0)out.push(m[1]);}return out;}

  const MODE=${MODE};const F=${F};
  log('SUNO 준비 중…');
  if(!location.pathname.startsWith('/create')){return {ok:false,error:'create 페이지가 아님 (로그인 확인)'};}
  await sleep(1200);

  // 모드 전환
  const wantLabel=MODE==='simple'?'Simple':'Advanced';
  const tab=findByText('button',wantLabel);
  if(tab&&!tab.classList.contains('active')){trustedClick(tab);await sleep(900);}

  // 폼 입력
  if(MODE==='simple'){
    const ta=findSimpleDesc();
    if(!ta)return {ok:false,error:'설명 입력창을 찾지 못함'};
    await setFieldValue(ta,F.description||'');
    if(F.instrumental){const tog=qV(['button[aria-label*="instrumental" i]']);if(tog){const pressed=tog.getAttribute('aria-pressed')==='true'||tog.getAttribute('data-state')==='checked'||tog.getAttribute('aria-checked')==='true';if(!pressed)trustedClick(tog);}}
  }else{
    const style=qV(['[data-testid="create-form-styles-wrapper"] textarea','textarea[placeholder*="Describe the sound" i]']);
    if(style)await setFieldValue(style,F.style||'');
    const lyrics=qV(['textarea[data-testid="lyrics-textarea"]']);
    if(lyrics)await setFieldValue(lyrics,F.lyrics||'');
    const title=qV(['input[placeholder*="Song Title" i]']);
    if(title)await setFieldValue(title,F.title||'');
  }
  await sleep(500);

  // Create
  const before=snapshotIds();
  let btn=null;for(let i=0;i<24;i++){btn=qV(['button[aria-label="Create song"]','button[aria-label*="Create" i]']);if(btn&&!btn.disabled)break;await sleep(250);}
  if(!btn||btn.disabled)return {ok:false,error:'Create 버튼이 활성화되지 않음'};
  trustedClick(btn);
  log('생성 요청됨 · 새 곡 대기 중…');

  // 새 곡 2개의 songId 대기 (보통 수 초 내 생성 시작)
  let ids=[];
  for(let i=0;i<70;i++){await sleep(1000);ids=newIds(before);if(ids.length>=2)break;if(i>0&&i%10===0)log('곡 생성 시작 대기… ('+i+'초)');}
  if(ids.length===0)return {ok:false,error:'새 곡이 생성되지 않음 (크레딧/로그인 확인)'};
  log(ids.length+'곡 생성 시작 — songId 회수');
  return {ok:true,songIds:ids.slice(0,2)};
}catch(e){return {ok:false,error:String(e&&e.message||e)};}})()`
}
