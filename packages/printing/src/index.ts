// Documents. Renders from data it is handed; never reads the database.

export {
  FONT_STACK,
  NUMERIC_FONT,
  RECEIPT_WIDTH_DOTS,
  esc,
} from './thermal/receiptStyle.js'
export {
  buildWholesaleReceiptHtml,
  type ReceiptLine,
  type ReceiptShop,
  type WholesaleReceiptData,
} from './thermal/wholesaleReceipt.js'
export {
  buildRetailReceiptHtml,
  type RetailReceiptData,
  type RetailReceiptLine,
} from './thermal/retailReceipt.js'
