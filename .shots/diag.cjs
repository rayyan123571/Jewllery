const { connect, sleep } = require('./cdp.cjs')
;(async () => {
  const cdp = await connect()
  await cdp.evaluate(`document.querySelector('[data-action="nav.sale-retail"]')?.click(); return true`)
  await sleep(900)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1550, height: 830, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const out = await cdp.evaluate(`
    const r = document.querySelector('.retail')
    const rows = [...r.children].map((c) => ({
      cls: c.className,
      h: Math.round(c.getBoundingClientRect().height),
      scrollH: c.scrollHeight,
      clientH: c.clientHeight,
    }))
    const left = document.querySelector('.retail__left')
    const leftKids = left ? [...left.children].map((c) => ({
      cls: c.className, h: Math.round(c.getBoundingClientRect().height), scrollH: c.scrollHeight, clientH: c.clientHeight,
    })) : []
    const rail = document.querySelector('.retail__rail')
    return {
      cellHeight: getComputedStyle(r).getPropertyValue('--size-item-cell-height'),
      retail: { h: Math.round(r.getBoundingClientRect().height), scrollH: r.scrollHeight, clientH: r.clientHeight },
      rows,
      leftKids,
      rail: rail ? { h: Math.round(rail.getBoundingClientRect().height), scrollH: rail.scrollHeight, clientH: rail.clientHeight } : null,
    }
  `)
  console.log(JSON.stringify(out, null, 1))
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
