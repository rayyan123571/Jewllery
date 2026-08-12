const { connect, sleep } = require('./cdp.cjs')
const Database = require('better-sqlite3')

;(async () => {
  const cdp = await connect()
  await cdp.evaluate(`document.querySelector('[data-action="nav.sale-retail"]')?.click(); return true`)
  await sleep(1000)

  const db = new Database('C:/Users/rayya/AppData/Roaming/@jewellery/desktop/shop.sqlite', { readonly: true })
  const out = []

  for (const invoice of [4]) {
    // Type the number into the toolbar box and press Enter — the operator's way.
    await cdp.evaluate(`
      const el = document.querySelector('.toolbar__jump-input')
      el.focus(); el.select(); return true
    `)
    await cdp.type(String(invoice))
    await cdp.key(null, 'Enter', 13)
    await sleep(1800)

    const onScreen = await cdp.evaluate(`
      const cols = [...document.querySelectorAll('.item-column:not(.is-blank)')]
      return {
        state: document.querySelector('.record-state__what')?.textContent.trim(),
        customer: document.querySelector('.customer--toolbar input')?.value,
        items: cols.map((c) => {
          const cells = c.querySelectorAll('.item-column__cell')
          const v = (n) => { const i = cells[n]?.querySelector('input'); return i ? i.value : (cells[n]?.textContent || '').trim() }
          return { name: v(0), gross: v(1), stone: v(2), deduction: v(3), net: v(4), polishPct: v(5), polish: v(6), labour: v(7), stoneCharges: v(8), rate: v(9), amount: v(10) }
        }),
      }
    `)

    const stored = db.prepare(`
      SELECT i.item_name, i.gross_weight_mg, i.net_weight_mg, i.wastage_mg,
             i.labour_charges_paisa, i.line_amount_paisa
        FROM retail_sale_items i JOIN retail_sales s ON s.id = i.sale_id
       WHERE s.invoice_number = ? ORDER BY i.line_no`).all(invoice)

    out.push({ invoice, onScreen, stored })
  }
  db.close()
  console.log(JSON.stringify(out, null, 1))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
