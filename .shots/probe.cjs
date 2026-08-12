const { connect, sleep } = require('./cdp.cjs')
;(async () => {
  const cdp = await connect()
  const out = await cdp.evaluate(`
    return {
      inputs: [...document.querySelectorAll('input,select')].map((i) => i.getAttribute('aria-label') || i.className).filter((l)=>!/^Item /.test(l||'')),
      grand: (document.querySelector('.calc-card, .bill-calc')?.innerText||'').split(String.fromCharCode(10)).slice(-14),
      railText: (document.querySelector('.retail__rail')?.innerText || '').split(String.fromCharCode(10)).slice(0, 30),
      actions: [...document.querySelectorAll('.retail__actions [data-action]')].map((b) => b.getAttribute('data-action')),
    }
  `)
  console.log(JSON.stringify(out, null, 1))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
