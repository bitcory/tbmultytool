// Google Flow(labs.google/fx) 이미지 생성 자동화 — CDP 기반.
// Flow는 합성 클릭(react/native/pointer)을 isTrusted 검사로 전부 차단하므로,
// 핵심 클릭(에셋 피커 선택, 생성 버튼)은 메인 프로세스가 CDP(Input.dispatchMouseEvent)로
// "진짜 클릭"을 쏜다. 주입 스크립트는 좌표만 찾아 반환하고, 클릭은 main(ipc.ts)이 수행.
//
// 단계: setup(프로젝트·설정·업로드) → attachRef(피커 좌표) → typePrompt(좌표) → [CDP생성] → capture.

// 모든 단계 스크립트가 공유하는 헬퍼 (Flow 페이지 main world에서 실행)
const PRELUDE = `
  const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
  const qsa = (s,r=document)=>{try{return [...r.querySelectorAll(s)];}catch{return [];}};
  const isVisible = (el)=>{if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
  const log = (m)=>console.log('[AVS-GEN]', m);
  function rc(el){const k=Object.keys(el).find(x=>x.indexOf('__reactProps')===0);if(k&&el[k]&&typeof el[k].onClick==='function'){try{el[k].onClick({type:'click',target:el,currentTarget:el,bubbles:true,cancelable:true,isTrusted:true,preventDefault(){},stopPropagation(){},nativeEvent:{isTrusted:true},button:0});return;}catch(e){}}el.click();}
  function pointerClick(el){el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();const o={bubbles:true,cancelable:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,buttons:1};el.dispatchEvent(new PointerEvent('pointerdown',{...o,pointerId:1,pointerType:'mouse'}));el.dispatchEvent(new MouseEvent('mousedown',o));el.dispatchEvent(new PointerEvent('pointerup',{...o,pointerId:1,pointerType:'mouse'}));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));}
  function findPromptInput(){return document.querySelector('div[data-slate-editor="true"]');}
  function getSlateEditor(){const el=findPromptInput();if(!el)return null;const fk=Object.keys(el).find(k=>k.indexOf('__reactFiber')===0);if(!fk)return null;let f=el[fk];for(let i=0;i<30;i++){if(!f)break;const p=f.memoizedProps||f.pendingProps||{};if(p.editor&&p.editor.children)return p.editor;if(f.memoizedState){let s=f.memoizedState;while(s){if(s.memoizedState&&s.memoizedState.editor)return s.memoizedState.editor;if(s.queue&&s.queue.lastRenderedState&&s.queue.lastRenderedState.editor)return s.queue.lastRenderedState.editor;s=s.next;}}f=f.return;}return null;}
  function dataUrlToFile(dataUrl,name){const c=dataUrl.indexOf(',');const head=dataUrl.slice(0,c),b64=dataUrl.slice(c+1);const mime=(head.match(/data:([^;]+)/)||[])[1]||'image/png';const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new File([arr],name+'.'+(mime.split('/')[1]||'png'),{type:mime});}
  function findGenerateBtn(){for(const b of qsa('button')){if(b.disabled||b.getAttribute('aria-disabled')==='true'||!isVisible(b))continue;const i=b.querySelector('i');if(i&&(i.textContent||'').trim()==='arrow_forward')return b;}return null;}
  function genImgs(){return qsa('img').filter(im=>{const s=im.src||'';const r=im.getBoundingClientRect();return r.width>=150&&r.height>=150&&(s.indexOf('media.getMediaUrlRedirect')!==-1||s.indexOf('/fx/api/trpc/media')!==-1||(s.indexOf('googleusercontent')!==-1&&s.indexOf('/a/')===-1)||s.indexOf('fife')!==-1);}).map(im=>im.src);}
  function centerOf(el){const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};}
`

// 1단계: fetch 패치 + 새 프로젝트 진입 + 설정 + 레퍼런스 업로드(소재). { ok }
export function flowSetupScript(aspect: string, refs: string[], prefix: string): string {
  return `(async()=>{try{
  ${PRELUDE}
  const ASPECT=${JSON.stringify(aspect)};
  const REFS=${JSON.stringify(refs || [])};
  const PREFIX=${JSON.stringify(prefix)};
  if(!window.__avsFlowPatched){window.__avsFlowPatched=true;window.__avsFlow={urls:[]};const of=window.fetch;window.fetch=async function(){const res=await of.apply(this,arguments);try{const a0=arguments[0];const url=(a0&&(a0.url||a0))+'';if(/batchGenerateImages|GenerateImage|flowMedia|runImageFx|image/i.test(url)){res.clone().text().then(function(t){const f=t.match(/https:\\/\\/[^"'\\\\\\s]+/g)||[];f.forEach(u=>{if(/fife|googleusercontent|lh3|usercontent/i.test(u)&&window.__avsFlow.urls.indexOf(u)<0)window.__avsFlow.urls.push(u);});}).catch(()=>{});}}catch(e){}return res;};log('fetch 패치');}
  log('Flow 준비 중…');
  await sleep(1500);
  let input=findPromptInput();
  if(!input){for(let i=0;i<80;i++){input=findPromptInput();if(input){log('에디터 발견');break;}if(i%3===0){const c=qsa('button,a,[role="button"],div,span,p').filter(e=>{const t=(e.textContent||'').replace(/\\s+/g,' ').trim();return isVisible(e)&&t.includes('새 프로젝트')&&t.length<16;});if(c.length){const el=c[0];rc(el.closest('button,a,[role="button"]')||el);if(i%9===0)log('새 프로젝트 클릭');}else if(i%9===0)log('새 프로젝트 대기…');}await sleep(600);}}
  if(!findPromptInput())return {ok:false,error:'프로젝트 진입 실패'};
  // 설정: tune → 확인안함 → 비율 → 1x → 저장
  try{
    const tunes=qsa('button').filter(b=>{const i=b.querySelector('i');return i&&(i.textContent||'').trim()==='tune'&&isVisible(b);});
    if(tunes.length){rc(tunes[tunes.length-1]);await sleep(1200);
      if((document.body.innerText||'').includes('이미지 생성 기본값')||(document.body.innerText||'').includes('에이전트 설정')){
        const nc=qsa('button').filter(b=>{const i=b.querySelector('i');return i&&(i.textContent||'').trim()==='radio_button_unchecked'&&isVisible(b);})[0];if(nc){pointerClick(nc);await sleep(300);}
        const AI={'16:9':'crop_16_9','9:16':'crop_9_16','1:1':'crop_square','4:3':'crop_landscape','3:4':'crop_portrait'};const ic=AI[ASPECT]||'crop_16_9';
        const asp=qsa('button').filter(b=>{const i=b.querySelector('i');return i&&(i.textContent||'').trim()===ic&&isVisible(b);})[0];if(asp){pointerClick(asp);await sleep(300);}
        const one=qsa('button').filter(b=>(b.textContent||'').trim()==='1x'&&isVisible(b))[0];if(one){pointerClick(one);await sleep(300);}
        const save=qsa('button').find(b=>(b.textContent||'').trim()==='저장'&&isVisible(b));if(save){rc(save);await sleep(1000);log('설정 저장 (비율 '+ASPECT+', 1장)');}
      }
    }
  }catch(e){log('설정 스킵');}
  // 레퍼런스 업로드 (소재 라이브러리)
  if(REFS.length){log('레퍼런스 '+REFS.length+'장 업로드…');const fi=qsa('input[type="file"]')[0];if(fi){const dt=new DataTransfer();REFS.forEach((u,i)=>dt.items.add(dataUrlToFile(u,PREFIX+'-'+i)));fi.files=dt.files;fi.dispatchEvent(new Event('change',{bubbles:true}));await sleep(4500);}else log('파일 input 없음');}
  return {ok:true};
}catch(e){return {ok:false,error:String(e&&e.message||e)};}})()`
}

// 2-a단계: 컴포저 "+" 버튼 좌표 반환 (CDP로 열기). { ok, x, y }
export function flowPlusCoordsScript(): string {
  return `(()=>{try{
  ${PRELUDE}
  const ed=findPromptInput();if(!ed)return {ok:false,error:'no editor'};
  const edTop=ed.getBoundingClientRect().top;
  const plus=qsa('button').filter(b=>{const i=b.querySelector('i');const t=i?(i.textContent||'').trim():'';return ['add','add_2'].includes(t)&&isVisible(b)&&b.getBoundingClientRect().top>edTop-20;})[0];
  if(!plus)return {ok:false,error:'+ 버튼 없음'};
  const c=centerOf(plus);return {ok:true,x:c.x,y:c.y};
}catch(e){return {ok:false,error:String(e&&e.message||e)};}})()`
}

// 2-b단계: (피커 열린 상태) 레퍼런스 행 좌표 반환 (CDP로 클릭). { ok, x, y }
export function flowFindRefScript(name: string): string {
  return `(async()=>{try{
  ${PRELUDE}
  const NAME=${JSON.stringify(name)};
  let item=null;
  for(let s=0;s<10;s++){item=qsa('button,[role="option"],[role="button"]').filter(e=>{const t=(e.textContent||'').trim();return e.getBoundingClientRect().width>40&&t.indexOf(NAME)===0;})[0];if(item)break;await sleep(500);}
  if(!item)return {ok:false,error:'피커에 '+NAME+' 없음'};
  const c=centerOf(item);return {ok:true,x:c.x,y:c.y};
}catch(e){return {ok:false,error:String(e&&e.message||e)};}})()`
}

// 3단계: 프롬프트 입력 + 생성 버튼 좌표 반환 (생성 클릭은 main CDP). { ok, x, y }
export function flowTypePromptScript(prompt: string): string {
  return `(async()=>{try{
  ${PRELUDE}
  const PROMPT=${JSON.stringify(prompt)};
  let input=findPromptInput();if(!input)return {ok:false,error:'no editor'};
  log('프롬프트 입력 중…');
  input.focus();await sleep(120);
  const ed=getSlateEditor();
  if(ed){try{ed.select({anchor:{path:[0,0],offset:0},focus:{path:[0,0],offset:999999}});ed.delete();}catch(e){}try{ed.insertText(PROMPT.replace(/@/g,' '));}catch(e){log('insertText 실패');}}
  else{try{const sel=window.getSelection();sel.removeAllRanges();const r=document.createRange();r.selectNodeContents(input);sel.addRange(r);}catch(e){}document.execCommand('insertText',false,PROMPT.replace(/@/g,' '));}
  await sleep(700);
  if(document.querySelector('[role="dialog"]')){document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true,cancelable:true}));await sleep(600);}
  window.__avsFlowBaseline=genImgs();
  let gen=findGenerateBtn(),t=0;while(!gen&&t++<20){await sleep(300);gen=findGenerateBtn();}
  if(!gen)return {ok:false,error:'생성 버튼 못찾음(활성 안됨)'};
  const c=centerOf(gen);
  return {ok:true,x:c.x,y:c.y};
}catch(e){return {ok:false,error:String(e&&e.message||e)};}})()`
}

// 4단계: 생성 결과 대기 + 회수 (fire-and-forget). 'started'
export function flowCaptureScript(): string {
  return `(()=>{
  ${PRELUDE}
  const baseline=new Set(window.__avsFlowBaseline||[]);
  (async()=>{try{
    log('생성 요청됨 · 이미지 대기 중…');
    let src=null;
    for(let i=0;i<160;i++){await sleep(1500);if(i>0&&i%8===0)log('이미지 생성 대기 중… ('+Math.round(i*1.5)+'초)');const fresh=genImgs().filter(s=>!baseline.has(s));if(fresh.length){const s1=fresh[fresh.length-1];await sleep(1500);if(genImgs().indexOf(s1)!==-1){src=s1;break;}}if(window.__avsFlow&&window.__avsFlow.urls.length){src=window.__avsFlow.urls[window.__avsFlow.urls.length-1];break;}}
    if(!src){log('실패: 시간 초과 — 생성 이미지 못찾음');return;}
    log('이미지 가져오는 중…');
    if(src.startsWith('blob:')||src.startsWith('data:')){const blob=await (await fetch(src)).blob();const du=await new Promise((rs,rj)=>{const fr=new FileReader();fr.onload=()=>rs(fr.result);fr.onerror=rj;fr.readAsDataURL(blob);});await window.__avsBridge.sendImage({source:'flow',dataUrl:du,pageUrl:location.href});}
    else{await window.__avsBridge.sendImage({source:'flow',url:src,pageUrl:location.href});}
    log('완료');
  }catch(e){log('회수 오류: '+(e&&e.message||e));}})();
  return 'started';
})()`
}
