const Database = require('better-sqlite3')
const db = new Database('C:/Users/rayya/AppData/Roaming/@jewellery/desktop/shop.sqlite', { readonly: true })
const show = (label, rows) => {
  console.log('\n== ' + label + ' ==')
  for (const r of rows) console.log(JSON.stringify(r))
}
show('retail_bills', db.prepare(`
  SELECT id, bill_no, bill_date, bill_time, customer_name_snapshot, status, posted_at
    FROM retail_bills ORDER BY bill_no`).all())
show('retail_sales', db.prepare(`
  SELECT invoice_number, invoice_no, bill_id, slip_no, slip_label, sale_date, sale_time,
         customer_name_snapshot, rate_purity, rate_per_tola_paisa, gold_value_paisa,
         hallmark_charges_paisa, other_charges_paisa, discount_paisa,
         grand_total_paisa, amount_paid_paisa, balance_paisa, status
    FROM retail_sales ORDER BY invoice_number`).all())
show('retail_sale_items', db.prepare(`
  SELECT s.invoice_number, i.line_no, i.item_name, i.purity, i.gross_weight_mg,
         i.stone_weight_mg, i.purity_deduction_mg, i.net_weight_mg, i.wastage_bp,
         i.wastage_mg, i.fine_weight_mg, i.labour_charges_paisa, i.labour_mode,
         i.stone_charges_paisa, i.line_amount_paisa
    FROM retail_sale_items i JOIN retail_sales s ON s.id = i.sale_id
   ORDER BY s.invoice_number, i.line_no`).all())

console.log('\n== declared column types ==')
for (const t of ['retail_sales', 'retail_sale_items']) {
  for (const c of db.prepare(`PRAGMA table_info(${t})`).all()) {
    if (/_mg$|_paisa$|_bp$|invoice_number|slip_no|line_no/.test(c.name)) {
      console.log(`${t}.${c.name} -> ${c.type}`)
    }
  }
}

console.log('\n== stored SQLite storage class, per value ==')
const rows = db.prepare(`
  SELECT s.invoice_number, i.line_no,
         typeof(i.gross_weight_mg) tg, typeof(i.stone_weight_mg) ts,
         typeof(i.purity_deduction_mg) td, typeof(i.net_weight_mg) tn,
         typeof(i.wastage_bp) tb, typeof(i.wastage_mg) tw, typeof(i.fine_weight_mg) tf,
         typeof(i.labour_charges_paisa) tl, typeof(i.stone_charges_paisa) tsc,
         typeof(i.line_amount_paisa) ta
    FROM retail_sale_items i JOIN retail_sales s ON s.id = i.sale_id
   ORDER BY s.invoice_number, i.line_no`).all()
for (const r of rows) console.log(JSON.stringify(r))
const anyReal = db.prepare(`
  SELECT COUNT(*) n FROM retail_sale_items i
   WHERE typeof(i.gross_weight_mg)='real' OR typeof(i.net_weight_mg)='real'
      OR typeof(i.fine_weight_mg)='real' OR typeof(i.line_amount_paisa)='real'
      OR typeof(i.labour_charges_paisa)='real' OR typeof(i.wastage_mg)='real'`).get()
console.log('\nvalues stored as REAL anywhere in items:', anyReal.n)
const anyRealSale = db.prepare(`
  SELECT COUNT(*) n FROM retail_sales
   WHERE typeof(grand_total_paisa)='real' OR typeof(amount_paid_paisa)='real'
      OR typeof(balance_paisa)='real' OR typeof(rate_per_tola_paisa)='real'`).get()
console.log('values stored as REAL anywhere in sales:', anyRealSale.n)
db.close()
