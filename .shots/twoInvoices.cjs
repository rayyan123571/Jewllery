const { connect, sleep } = require('./cdp.cjs')

const INV1 = [
  { name: 'GOLD BANGLE', weight: '4.050', stone: '0.150', deduction: '0.090', polish: '14.00', labour: '4500', stoneCharges: '1200', rate: '500000' },
  { name: 'CHAIN 22K',   weight: '2.500', stone: '0',     deduction: '0.050', polish: '12.00', labour: '3000', stoneCharges: '0',    rate: '500000' },
  { name: 'TOPS PAIR',   weight: '1.250', stone: '0.080', deduction: '0.030', polish: '10.00', labour: '1800', stoneCharges: '600',  rate: '500000' },
]
const INV2 = [
  { name: 'RING 21K',    weight: '0.850', stone: '0.040', deduction: '0.020', polish: '8.00',  labour: '1200', stoneCharges: '450',  rate: '341500' },
  { name: 'BRACELET',    weight: '3.200', stone: '0.100', deduction: '0.070', polish: '15.00', labour: '5200', stoneCharges: '900',  rate: '341500' },
  { name: 'ANKLET PAIR', weight: '5.400', stone: '0',     deduction: '0.110', polish: '11.50', labour: '6800', stoneCharges: '0',    rate: '341500' },
]

const gaps = []

async function fresh(cdp) {
  // Any resume card gets discarded, so each invoice starts from nothing.
  await cdp.evaluate(`
    const discard = document.querySelector('[data-action="retail.draft.discard"]')
    if (discard) discard.click()
    return true
  `)
  await sleep(700)
}

async function enter(cdp, customer, items) {
  await cdp.evaluate(`document.querySelector('.customer--toolbar input')?.focus(); return true`)
  await cdp.type(customer)
  await sleep(300)
  await cdp.evaluate(`document.querySelector('[data-cell="r0c0"]')?.focus(); return true`)
  await sleep(200)

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]
    const fields = [it.name, it.weight, it.stone, it.deduction, it.polish, it.labour, it.stoneCharges, it.rate]
    for (let f = 0; f < fields.length; f += 1) {
      await cdp.type(fields[f])
      if (f < fields.length - 1) await cdp.key(null, 'Enter', 13)
    }
    await sleep(250)
    if (i < items.length - 1) {
      await cdp.key(null, 'Tab', 9)
      await sleep(500)
      const at = await cdp.evaluate(`return document.activeElement?.getAttribute('data-cell') || '?'`)
      if (at !== 'r0c' + (i + 1)) gaps.push('Tab-append landed at ' + at)
    }
  }
  await sleep(900)
}

async function payAndSave(cdp) {
  // The walk-in rule wants the bill paid in full; the amount comes from the
  // screen's own grand total, so no figure is invented here.
  const total = await cdp.evaluate(`
    const el = [...document.querySelectorAll('.calc__row')].find((r) => /TOTAL|GRAND/i.test(r.textContent))
    return el ? el.textContent : null
  `)
  await cdp.evaluate(`
    const paid = document.querySelector('[aria-label="Amount paid"], [aria-label="Advance / Paid"]')
    return paid ? paid.getAttribute('aria-label') : 'no paid field'
  `)
  return total
}

;(async () => {
  const cdp = await connect()
  await cdp.evaluate(`document.querySelector('[data-action="nav.sale-retail"]')?.click(); return true`)
  await sleep(1000)
  await fresh(cdp)

  await enter(cdp, 'AHMED ALI', INV1)
  const t1 = await payAndSave(cdp)
  console.log(JSON.stringify({ gaps, total1: t1 }, null, 1))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
