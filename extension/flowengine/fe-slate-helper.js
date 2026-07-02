/* slate-helper.js — MAIN world (v1.4.9)
 *
 * React fiber 를 타고 들어가 Slate 에디터 인스턴스를 직접 얻고,
 * editor.apply({type:'remove_text'}) 로 잔여 '@' 문자를 안전하게 제거.
 *
 * drop-handler.js 가 document.dispatchEvent(new CustomEvent('__toolb_slate_remove_at'))
 * 를 쏘면 여기서 처리하고 결과를 '__toolb_slate_result' 이벤트로 회신.
 *
 * (nano-banana-auto/slate_helper.js 에서 이식, toolbflow 네이밍으로 변경)
 *
 * v1.4.9 변경 — 확장 재로드 후 구 인스턴스 리스너 중복 방지 가드.
 *   window.__toolbSlateHelperToken 에 로드마다 유일 토큰을 심고,
 *   리스너 진입부에서 자기 토큰과 다르면 조기 return.
 */

console.log('[ToolB] slate-helper.js 로드됨 (MAIN world, v1.4.9)');

(function () {
  'use strict';

  /* ── v1.4.9 sentinel 가드 ────────────────────
   * 이 인스턴스만의 고유 토큰을 만들어 window 에 심는다. */
  var MY_SLATE_TOKEN = 'slate-v1.4.9-' +
    Math.random().toString(36).slice(2, 10) + '-' + Date.now();
  window.__toolbSlateHelperToken = MY_SLATE_TOKEN;

  function getSlateEditor() {
    var editor = document.querySelector('div[data-slate-editor="true"]');
    if (!editor) return null;
    var fiberKey = Object.keys(editor).find(function (k) {
      return k.indexOf('__reactFiber') === 0;
    });
    if (!fiberKey) return null;
    var fiber = editor[fiberKey];
    for (var i = 0; i < 30; i++) {
      if (!fiber) break;
      var props = fiber.memoizedProps || fiber.pendingProps || {};
      if (props.editor && props.editor.children) return props.editor;
      if (fiber.memoizedState) {
        var state = fiber.memoizedState;
        while (state) {
          if (state.memoizedState && state.memoizedState.editor) {
            return state.memoizedState.editor;
          }
          if (
            state.queue &&
            state.queue.lastRenderedState &&
            state.queue.lastRenderedState.editor
          ) {
            return state.queue.lastRenderedState.editor;
          }
          state = state.next;
        }
      }
      fiber = fiber.return;
    }
    return null;
  }

  /**
   * Slate 의 모든 text leaf 를 순회하며 '@' 를 제거.
   * mention/character 타입 voids 는 children 에 text 가 없어서 영향 없음.
   */
  function removeStrayAt(slateEditor) {
    var removed = 0;
    for (var p = 0; p < slateEditor.children.length; p++) {
      var para = slateEditor.children[p];
      if (!para.children) continue;
      for (var i = para.children.length - 1; i >= 0; i--) {
        var child = para.children[i];
        // text 노드만 (mention/character 같은 inline void 는 type 이 있음)
        if (child.text !== undefined && child.type === undefined) {
          var text = child.text;
          while (text.indexOf('@') !== -1) {
            var offset = text.indexOf('@');
            slateEditor.apply({
              type: 'remove_text',
              path: [p, i],
              offset: offset,
              text: '@'
            });
            removed++;
            // children 참조가 바뀌었을 수 있으므로 재조회
            if (
              !slateEditor.children[p] ||
              !slateEditor.children[p].children[i]
            ) {
              break;
            }
            text = slateEditor.children[p].children[i].text;
          }
        }
      }
    }

    if (removed > 0) {
      slateEditor.onChange();
      // 커서를 마지막 위치로
      var lastP = slateEditor.children.length - 1;
      if (lastP >= 0 && slateEditor.children[lastP].children) {
        var lastC = slateEditor.children[lastP].children.length - 1;
        var lastChild = slateEditor.children[lastP].children[lastC];
        var offset = (lastChild && lastChild.text) ? lastChild.text.length : 0;
        try {
          slateEditor.select({
            anchor: { path: [lastP, lastC], offset: offset },
            focus:  { path: [lastP, lastC], offset: offset }
          });
          slateEditor.onChange();
        } catch (_) { /* noop */ }
      }
    }

    return removed;
  }

  document.addEventListener('__toolb_slate_remove_at', function () {
    // v1.4.9 sentinel: 재로드로 교체된 구 인스턴스라면 즉시 탈출
    if (window.__toolbSlateHelperToken !== MY_SLATE_TOKEN) return;
    try {
      var slateEditor = getSlateEditor();
      if (!slateEditor) {
        document.dispatchEvent(new CustomEvent('__toolb_slate_result', {
          detail: { ok: false, error: 'no slate editor' }
        }));
        return;
      }
      var removed = removeStrayAt(slateEditor);
      console.log('[ToolB] slate-helper: @ ' + removed + '개 제거');
      document.dispatchEvent(new CustomEvent('__toolb_slate_result', {
        detail: { ok: true, removed: removed }
      }));
    } catch (e) {
      console.warn('[ToolB] slate-helper error:', e && e.message);
      document.dispatchEvent(new CustomEvent('__toolb_slate_result', {
        detail: { ok: false, error: e && e.message || String(e) }
      }));
    }
  });
})();
