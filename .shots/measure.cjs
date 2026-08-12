const { connect, sleep } = require('./cdp.cjs')

;(async () => {
  const cdp = await connect()
  // Navigate to the retail screen the way the operator does.
  await cdp.evaluate(`
    const nav = document.querySelector('[data-action="nav.sale-retail"]')
    if (nav) nav.click()
    return true
  `)
  await sleep(1200)

  const m = await cdp.evaluate(`
    const el = document.documentElement
    const body = document.body
    const app = document.querySelector('.app')
    const content = document.querySelector('.content')
    const retail = document.querySelector('.retail')
    return {
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollH: el.scrollHeight,
      docClientH: el.clientHeight,
      docScrollW: el.scrollWidth,
      docClientW: el.clientWidth,
      bodyScrollH: body.scrollHeight,
      appH: app ? app.scrollHeight : null,
      contentScrollH: content ? content.scrollHeight : null,
      contentClientH: content ? content.clientHeight : null,
      retailScrollH: retail ? retail.scrollHeight : null,
      retailClientH: retail ? retail.clientHeight : null,
      screenName: document.querySelector('.retail') ? 'retail' : 'other',
    }
  `)
  console.log(JSON.stringify(m, null, 2))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
