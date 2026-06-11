// render.js — JSON 슬라이드를 1080x1080 PNG 카드로 일괄 렌더
// 사용법: node render.js [입력.json] [출력폴더]
// 기본값: deck.json -> ./out
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const inputFile = process.argv[2] || 'deck.json';
  const outDir = process.argv[3] || 'out';
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  // data = { accent, handle, slides:[{type,kicker,headline,body}, ...] }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.goto('file://' + path.resolve(__dirname, 'card-template.html'));
  await page.waitForLoadState('networkidle');   // 폰트 CDN 로딩 대기
  await page.evaluate(() => document.fonts.ready);

  const files = [];
  for (let i = 0; i < data.slides.length; i++) {
    await page.evaluate(([idx, d]) => window.renderCard(idx, d), [i, data]);
    await page.waitForTimeout(80);
    const file = path.join(outDir, `card_${String(i + 1).padStart(2, '0')}.png`);
    await page.locator('#card').screenshot({ path: file });
    files.push(file);
    console.log('saved', file);
  }

  await browser.close();
  console.log(JSON.stringify({ ok: true, count: files.length, files }));
})().catch(e => { console.error(e); process.exit(1); });
