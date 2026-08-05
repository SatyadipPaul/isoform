/**
 * The exported VERSION sat at 0.5.0 through the entire 0.6.0 release. Nothing
 * failed, because nothing looked — and it is the string a consumer quotes when
 * reporting a bug against the wrong version of the library.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { VERSION } from './index.js'

describe('VERSION', () => {
  it('matches the version the package is published under', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })
})
