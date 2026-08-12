/**
 * A minimal DevTools-protocol driver for the running app.
 *
 * Used for the evidence pass: it measures the real page (scrollHeight against
 * clientHeight, which is the only honest test of "zero page scroll"), and it
 * types into the grid with real key events so the keyboard model is exercised
 * the way an operator exercises it rather than by calling React handlers.
 *
 * Not part of the application. Nothing here ships.
 */
const WebSocket = require('ws')
const http = require('node:http')

function targets() {
  return new Promise((resolve, reject) => {
    http
      .get('http://127.0.0.1:9222/json/list', (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })
}

async function connect() {
  const list = await targets()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('No page target — is the app running?')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id
      pending.set(next, { resolve, reject })
      ws.send(JSON.stringify({ id: next, method, params }))
    })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed')
    }
    return result.result.value
  }

  /** A real key, through the input pipeline — not a synthetic React event. */
  const key = async (text, code, keyCode, modifiers = 0) => {
    const base = { modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
    if (text && text.length === 1) {
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyDown', text, key: text, code })
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp', text, key: text, code })
      return
    }
    await send('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown', key: code, code })
    await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp', key: code, code })
  }

  const type = async (value) => {
    for (const ch of String(value)) {
      await send('Input.insertText', { text: ch })
      await sleep(12)
    }
  }

  return { send, evaluate, key, type, close: () => ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

module.exports = { connect, sleep }
