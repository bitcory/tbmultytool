// 팝업 — 앱 연결 상태 표시
const dot = document.getElementById('dot')
const label = document.getElementById('label')

chrome.runtime.sendMessage({ type: 'status' }, (r) => {
  if (chrome.runtime.lastError || !r) {
    label.textContent = '확장 오류'
    return
  }
  if (r.ok) {
    dot.classList.add('on')
    label.textContent = '앱 연결됨 (' + r.base.replace('http://', '') + ')'
  } else {
    dot.classList.remove('on')
    label.textContent = '앱을 찾을 수 없음'
  }
})
