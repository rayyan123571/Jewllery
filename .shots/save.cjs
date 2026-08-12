const { connect, sleep } = require('./cdp.cjs')
;(async () => {
  const cdp = await connect()
  // Pay in full from the screen's OWN grand total — no figure is invented here.
  const total = await cdp.evaluate(`
    const rows = [...document.querySelectorAll('.retail__rail *')]
      .filter((n) => n.children.length === 0 && /^[0-9,]+\.[0-9]{2}$/.test((n.textContent||'').trim()))
      .map((n) => n.textContent.trim())
    return rows[rows.length - 1] || null
  `)
  console.log('grand total on screen:', total)
  if (!total) { cdp.close(); return }

  await cdp.evaluate(`
    const el = document.querySelector('[aria-label="Payment amount"]')
    el.focus(); return true
  `)
  await cdp.type(total.replace(/,/g, ''))
  await sleep(700)

  await cdp.evaluate(`document.querySelector('[data-action="retail.save"]').click(); return true`)
  await sleep(2500)
  const after = await cdp.evaluate(`
    return {
      messages: [...document.querySelectorAll('.message, .banner, .messages *')]
        .map((m) => (m.textContent || '').trim()).filter(Boolean).slice(0, 4),
      columns: document.querySelectorAll('.item-column:not(.is-blank)').length,
      invoiceBox: document.querySelector('.toolbar__jump-input')?.value,
    }
  `)
  console.log(JSON.stringify(after, null, 1))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
