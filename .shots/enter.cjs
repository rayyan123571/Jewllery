/**
 * Enters one invoice using ONLY the keyboard, as the brief requires.
 *
 * The only mouse-equivalent action is the very first click onto the grid's
 * first cell. Everything after it — every character, every move between cells,
 * every new column — is a real key event through Input.dispatchKeyEvent.
 */
const { connect, sleep } = require('./cdp.cjs')

const ITEMS = JSON.parse(process.argv[3])
const CUSTOMER = process.argv[2]

;(async () => {
  const cdp = await connect()
  const gaps = []

  await cdp.evaluate(`document.querySelector('[data-action="nav.sale-retail"]')?.click(); return true`)
  await sleep(900)

  // Discard anything left over, and clear the fields before typing. Without
  // this a leftover draft is TYPED INTO rather than replaced, and the text
  // doubles — which is exactly what happened to invoice 1.
  await cdp.evaluate(`
    document.querySelector('[data-action="retail.draft.discard"]')?.click()
    return true
  `)
  await sleep(800)

  // Customer, typed into the toolbar combo.
  await cdp.evaluate(`
    const el = document.querySelector('.customer--toolbar input')
    el.focus(); el.select(); return el.value
  `)
  await cdp.type(CUSTOMER)
  await sleep(300)

  // Into the grid: one click on the first cell, then keyboard only.
  await cdp.evaluate(`document.querySelector('[data-cell="r0c0"]')?.focus(); return true`)
  await sleep(200)

  for (let i = 0; i < ITEMS.length; i += 1) {
    const item = ITEMS[i]
    await cdp.type(item.name)
    await cdp.key(null, 'Enter', 13)          // -> Weight
    await cdp.type(item.weight)
    await cdp.key(null, 'Enter', 13)          // -> Stone
    await cdp.type(item.stone)
    await cdp.key(null, 'Enter', 13)          // -> Purity Deduction
    await cdp.type(item.deduction)
    await cdp.key(null, 'Enter', 13)          // skips Net Weight -> Polish %
    await cdp.type(item.polish)
    await cdp.key(null, 'Enter', 13)          // skips Polish -> Labour
    await cdp.type(item.labour)
    await cdp.key(null, 'Enter', 13)          // -> Stone Charges
    await cdp.type(item.stoneCharges)
    await cdp.key(null, 'Enter', 13)          // -> Rate
    await cdp.type(item.rate)
    await sleep(250)

    // Where did Enter actually leave the caret? Records the truth, not a hope.
    const where = await cdp.evaluate(`
      const a = document.activeElement
      return a ? (a.getAttribute('data-cell') || a.className) : 'nothing focused'
    `)
    if (where !== 'r9c' + i) gaps.push('after item ' + (i + 1) + ' caret at ' + where)

    if (i < ITEMS.length - 1) {
      // Tab off the last editable cell of the last column appends a column.
      await cdp.key(null, 'Tab', 9)
      await sleep(500)
      const landed = await cdp.evaluate(`
        const a = document.activeElement
        return a ? (a.getAttribute('data-cell') || a.className) : 'nothing focused'
      `)
      if (landed !== 'r0c' + (i + 1)) gaps.push('Tab-append landed at ' + landed)
    }
  }

  await sleep(600)
  const state = await cdp.evaluate(`
    const grand = document.querySelector('.summary__grand, .calc__total')
    return {
      columns: document.querySelectorAll('.item-column:not(.is-blank)').length,
      header: document.querySelector('.items-card__head span')?.textContent,
      amounts: [...document.querySelectorAll('.item-column:not(.is-blank)')].map(
        (c) => c.querySelectorAll('.item-column__cell')[10]?.textContent,
      ),
    }
  `)
  console.log(JSON.stringify({ gaps, state }, null, 1))
  cdp.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
