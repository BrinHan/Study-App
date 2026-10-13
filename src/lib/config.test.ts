import { expect, test } from 'vitest'
import { aiConfigured } from './config'

test('aiConfigured needs proxy, sitekey and online', () => {
  expect(aiConfigured({ proxy: 'https://p', sitekey: 'k', online: true })).toBe(true)
  expect(aiConfigured({ proxy: undefined, sitekey: 'k', online: true })).toBe(false)
  expect(aiConfigured({ proxy: 'https://p', sitekey: undefined, online: true })).toBe(false)
  expect(aiConfigured({ proxy: 'https://p', sitekey: 'k', online: false })).toBe(false)
})
