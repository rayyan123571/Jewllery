const { connect, sleep } = require('./cdp.cjs')

const SIZES = [
  { name: '1550x830 sidebar collapsed', w: 1550, h: 830, collapse: true },
  { name: '1550x830 sidebar expanded', w: 1550, h: 830, collapse: false },
  { name: '1366x768', w: 1366, h: 768, collapse: true },
]

;(async () => {
  const cdp = await connect()
  await cdp.evaluate(`
    const nav = document.querySelector('[data-action="nav.sale-retail"]')
    if (nav) nav.click()
    return true
  `)
  await sleep(900)

  for (const size of SIZES) {
    // Exact CSS pixels, independent of the 125% display scaling. This is the
    // only way to measure the sizes the brief names on this machine: at 1.25
    // device scale a 1920 screen tops out at 1536 CSS px, so 1550 is otherwise
    // unreachable and every "measurement" would be of a size nobody asked for.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: size.w,
      height: size.h,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(500)

    const collapsed = await cdp.evaluate(`
      return document.querySelector('.app').classList.contains('is-collapsed')
    `)
    if (collapsed !== size.collapse) {
      await cdp.evaluate(`
        document.querySelector('[data-action="app.sidebar-toggle"]').click(); return true
      `)
      await sleep(600)
    }

    const m = await cdp.evaluate(`
      const el = document.documentElement
      const content = document.querySelector('.content')
      const retail = document.querySelector('.retail')
      const items = document.querySelector('.items-card')
      return {
        viewport: window.innerWidth + 'x' + window.innerHeight,
        collapsed: document.querySelector('.app').classList.contains('is-collapsed'),
        pageScrollH: el.scrollHeight,
        pageClientH: el.clientHeight,
        pageOverflowY: el.scrollHeight - el.clientHeight,
        pageOverflowX: el.scrollWidth - el.clientWidth,
        contentOverflow: content ? content.scrollHeight - content.clientHeight : null,
        retailOverflow: retail ? retail.scrollHeight - retail.clientHeight : null,
        itemsCardH: items ? Math.round(items.getBoundingClientRect().height) : null,
      }
    `)
    console.log(size.name, JSON.stringify(m))
  }

  await cdp.send('Emulation.clearDeviceMetricsOverride')
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
