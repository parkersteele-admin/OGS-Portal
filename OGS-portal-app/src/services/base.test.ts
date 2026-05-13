import { describe, expect, it } from 'vitest'
import { sanitizeForFirestore } from './base'

class Marker {
  constructor(public value: string) {}
}

describe('sanitizeForFirestore', () => {
  it('removes undefined recursively from objects and arrays', () => {
    const input = {
      name: 'Preston Steele',
      salesRepPhone: undefined,
      nested: {
        keep: 'ok',
        drop: undefined,
      },
      rows: [
        { a: 1, b: undefined },
        undefined,
        { c: 'x', d: undefined },
      ],
    }

    const output = sanitizeForFirestore(input)

    expect(output).toEqual({
      name: 'Preston Steele',
      nested: {
        keep: 'ok',
      },
      rows: [
        { a: 1 },
        { c: 'x' },
      ],
    })
  })

  it('preserves intentional empty values', () => {
    const input = {
      phone: '',
      title: null,
      active: false,
      count: 0,
    }

    expect(sanitizeForFirestore(input)).toEqual(input)
  })

  it('does not mutate class instances or other non-plain objects', () => {
    const marker = new Marker('keep-me')
    const date = new Date('2026-05-13T00:00:00.000Z')

    const output = sanitizeForFirestore({ marker, date, maybe: undefined })

    expect(output.marker).toBe(marker)
    expect(output.date).toBe(date)
    expect(output).toEqual({ marker, date })
  })
})
