import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The layer boundaries are enforced by lint rather than by a compiler, which
 * means the enforcement is only as trustworthy as the configuration — and a
 * misconfigured rule fails silently, reporting nothing and looking exactly like
 * a codebase with no violations.
 *
 * That is not hypothetical. The first version of eslint.config.js used the
 * plugin's default `mode: 'folder'`, under which a file sitting directly in a
 * package's src/ matched no element at all and escaped every rule. It lint-passed
 * while importing better-sqlite3 straight into the application layer.
 *
 * So these tests assert that illegal imports are actually rejected. They are the
 * check on the check. If someone weakens the config, this fails.
 */

const eslint = new ESLint({ cwd: process.cwd() })

async function lint(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false })
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? 'unknown'}: ${m.message}`)
}

function messagesFrom(messages: string[], rule: string): string[] {
  return messages.filter((m) => m.startsWith(rule))
}

describe('a screen cannot open a database connection', () => {
  const screen = 'packages/desktop/src/renderer/modules/wholesale/PartyScreen.tsx'

  it('rejects importing the persistence package', async () => {
    const messages = await lint(
      screen,
      `import { openDatabase } from '@jewellery/persistence'\nexport const x = openDatabase\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects importing the database driver directly', async () => {
    const messages = await lint(
      screen,
      `import Database from 'better-sqlite3'\nexport const x = Database\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects reaching the filesystem', async () => {
    const messages = await lint(
      screen,
      `import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects running a business calculation instead of asking over IPC', async () => {
    const messages = await lint(
      screen,
      `import { something } from '@jewellery/application'\nexport const x = something\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('allows domain types, so a screen can still display a Weight', async () => {
    const messages = await lint(
      screen,
      `import { Weight } from '@jewellery/domain'\nexport const x = Weight.ZERO\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(0)
  })
})

describe('calculations stay testable with no database and no window', () => {
  const service = 'packages/application/src/wholesale/PartySummary.ts'

  it('rejects a database import in the application layer', async () => {
    const messages = await lint(
      service,
      `import Database from 'better-sqlite3'\nexport const x = Database\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects an Electron import in the application layer', async () => {
    const messages = await lint(
      service,
      `import { app } from 'electron'\nexport const x = app\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects a React import in the application layer', async () => {
    const messages = await lint(
      service,
      `import { useState } from 'react'\nexport const x = useState\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects reaching into persistence rather than depending on an interface', async () => {
    const messages = await lint(
      service,
      `import { openDatabase } from '@jewellery/persistence'\nexport const x = openDatabase\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('allows the domain layer, which is all it should need', async () => {
    const messages = await lint(
      service,
      `import { Weight } from '@jewellery/domain'\nexport const x = Weight.ZERO\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(0)
  })
})

describe('the domain layer has no dependencies', () => {
  const entity = 'packages/domain/src/parties/Party.ts'

  it('rejects importing any other workspace package', async () => {
    const messages = await lint(
      entity,
      `import { x } from '@jewellery/application'\nexport const y = x\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })

  it('rejects the database driver', async () => {
    const messages = await lint(
      entity,
      `import Database from 'better-sqlite3'\nexport const x = Database\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })
})

describe('printing renders what it is handed and does not read the database', () => {
  it('rejects a persistence import', async () => {
    const messages = await lint(
      'packages/printing/src/a4/PartyStatement.ts',
      `import { openDatabase } from '@jewellery/persistence'\nexport const x = openDatabase\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
  })
})

describe('the composition root is allowed to see everything', () => {
  it('permits main to wire persistence together', async () => {
    const messages = await lint(
      'packages/desktop/src/main/container.ts',
      `import { openDatabase } from '@jewellery/persistence'\nexport const x = openDatabase\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(0)
  })

  it('permits main to reach Electron', async () => {
    const messages = await lint(
      'packages/desktop/src/main/index.ts',
      `import { app } from 'electron'\nexport const x = app\n`,
    )
    expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(0)
  })
})

describe('every layer is classified — none silently escapes the rules', () => {
  // The mode: 'folder' bug meant a file directly under src/ matched no element,
  // so no rule applied to it. This asserts each layer is actually recognised, at
  // both the top level of src/ and nested, by checking a known-illegal import is
  // still caught in both positions.
  const layers: ReadonlyArray<readonly [string, string, string]> = [
    ['domain', 'packages/domain/src/X.ts', 'packages/domain/src/a/b/X.ts'],
    ['application', 'packages/application/src/X.ts', 'packages/application/src/a/b/X.ts'],
    ['printing', 'packages/printing/src/X.ts', 'packages/printing/src/a/b/X.ts'],
    [
      'desktop-renderer',
      'packages/desktop/src/renderer/X.tsx',
      'packages/desktop/src/renderer/a/b/X.tsx',
    ],
  ]

  for (const [layer, topLevel, nested] of layers) {
    it(`classifies ${layer} at the top level of src/`, async () => {
      const messages = await lint(
        topLevel,
        `import { openDatabase } from '@jewellery/persistence'\nexport const x = openDatabase\n`,
      )
      expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
    })

    it(`classifies ${layer} when nested`, async () => {
      const messages = await lint(
        nested,
        `import { openDatabase } from '@jewellery/persistence'\nexport const x = openDatabase\n`,
      )
      expect(messagesFrom(messages, 'boundaries/external')).toHaveLength(1)
    })
  }
})
