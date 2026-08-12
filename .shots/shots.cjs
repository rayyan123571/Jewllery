const { connect, sleep } = require('./cdp.cjs')
const fs = require('node:fs')

const SIZES = [
  { file: 'retail-1550x830-collapsed.png', w: 1550, h: 830, collapse: true },
  { file: 'retail-1550x830-expanded.png', w: 1550, h: 830, collapse: false },
  { file: 'retail-1366x768.png', w: 1366, h: 768, collapse: true },
]

;(async () => {
  const cdp = await connect()
  await cdp.evaluate(`document.querySelector('[data-action="nav.sale-retail"]')?.click(); return true`)
  await sleep(1000)
  // Invoice 4 — three items, three different rates, real figures.
  await cdp.evaluate(`
    const el = document.querySelector('.toolbar__jump-input'); el.focus(); el.select(); return true
  `)
  await cdp.type('4')
  await cdp.key(null, 'Enter', 13)
  await sleep(1800)

  const out = []
  for (const s of SIZES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false,
    })
    await sleep(500)
    const collapsed = await cdp.evaluate(`return document.querySelector('.app').classList.contains('is-collapsed')`)
    if (collapsed !== s.collapse) {
      await cdp.evaluate(`document.querySelector('[data-action="app.sidebar-toggle"]').click(); return true`)
      await sleep(700)
    }
    const m = await cdp.evaluate(`
      const el = document.documentElement
      const c = document.querySelector('.content'); const r = document.querySelector('.retail')
      return {
        viewport: window.innerWidth + 'x' + window.innerHeight,
        collapsed: document.querySelector('.app').classList.contains('is-collapsed'),
        pageScrollH: el.scrollHeight, pageClientH: el.clientHeight,
        overflowY: el.scrollHeight - el.clientHeight,
        overflowX: el.scrollWidth - el.clientWidth,
        contentOverflow: c.scrollHeight - c.clientHeight,
        retailOverflow: r.scrollHeight - r.clientHeight,
      }
    `)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync('docs/evidence/' + s.file, Buffer.from(shot.data, 'base64'))
    out.push({ file: s.file, ...m })
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  console.log(JSON.stringify(out, null, 1))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
