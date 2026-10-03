import { parseMetadata, serializeMetadata, updateMetadata } from './metadata.js'

describe('parseMetadata', () => {
  it('parses valid metadata from body', () => {
    const body = '<!-- sb-meta {"x":45.2,"y":30.1} -->\nHello world'
    const { meta, text } = parseMetadata(body)
    expect(meta).toEqual({ x: 45.2, y: 30.1 })
    expect(text).toBe('Hello world')
  })

  it('parses metadata with extra whitespace', () => {
    const body = '<!--  sb-meta  {"resolved":true}  -->\nSome text'
    const { meta, text } = parseMetadata(body)
    expect(meta).toEqual({ resolved: true })
    expect(text).toBe('Some text')
  })

  it('returns null meta when no metadata block', () => {
    const body = 'Just a plain comment'
    const { meta, text } = parseMetadata(body)
    expect(meta).toBeNull()
    expect(text).toBe('Just a plain comment')
  })

  it('returns null meta and empty text for null body', () => {
    const { meta, text } = parseMetadata(null)
    expect(meta).toBeNull()
    expect(text).toBe('')
  })

  it('returns null meta and empty text for undefined body', () => {
    const { meta, text } = parseMetadata(undefined)
    expect(meta).toBeNull()
    expect(text).toBe('')
  })

  it('returns null meta and empty text for empty string', () => {
    const { meta, text } = parseMetadata('')
    expect(meta).toBeNull()
    expect(text).toBe('')
  })

  it('handles malformed JSON gracefully', () => {
    const body = '<!-- sb-meta {invalid json} -->\nText here'
    const { meta, text } = parseMetadata(body)
    expect(meta).toBeNull()
    expect(text).toBe('<!-- sb-meta {invalid json} -->\nText here')
  })

  it('trims whitespace from text', () => {
    const body = '<!-- sb-meta {"x":1} -->   \n  Trimmed  \n  '
    const { meta, text } = parseMetadata(body)
    expect(meta).toEqual({ x: 1 })
    expect(text).toBe('Trimmed')
  })

  it('parses complex metadata objects', () => {
    const body = '<!-- sb-meta {"x":10,"y":20,"resolved":true,"route":"/Overview"} -->\nComment'
    const { meta, text } = parseMetadata(body)
    expect(meta).toEqual({ x: 10, y: 20, resolved: true, route: '/Overview' })
    expect(text).toBe('Comment')
  })
})

describe('serializeMetadata', () => {
  it('serializes metadata and text into body', () => {
    const result = serializeMetadata({ x: 45.2, y: 30.1 }, 'Hello')
    expect(result).toBe('<!-- sb-meta {"x":45.2,"y":30.1} -->\nHello')
  })

  it('serializes empty text', () => {
    const result = serializeMetadata({ route: '/' }, '')
    expect(result).toBe('<!-- sb-meta {"route":"/"} -->\n')
  })

  it('roundtrips with parseMetadata', () => {
    const meta = { x: 10, y: 20, resolved: false }
    const text = 'A comment body'
    const body = serializeMetadata(meta, text)
    const parsed = parseMetadata(body)
    expect(parsed.meta).toEqual(meta)
    expect(parsed.text).toBe(text)
  })
})

describe('updateMetadata', () => {
  it('merges updates into existing metadata', () => {
    const body = '<!-- sb-meta {"x":10,"y":20} -->\nOriginal text'
    const result = updateMetadata(body, { resolved: true })
    const parsed = parseMetadata(result)
    expect(parsed.meta).toEqual({ x: 10, y: 20, resolved: true })
    expect(parsed.text).toBe('Original text')
  })

  it('overwrites existing fields', () => {
    const body = '<!-- sb-meta {"x":10,"y":20} -->\nText'
    const result = updateMetadata(body, { x: 50, y: 60 })
    const parsed = parseMetadata(result)
    expect(parsed.meta).toEqual({ x: 50, y: 60 })
    expect(parsed.text).toBe('Text')
  })

  it('handles body with no existing metadata', () => {
    const body = 'No metadata here'
    const result = updateMetadata(body, { x: 10 })
    const parsed = parseMetadata(result)
    expect(parsed.meta).toEqual({ x: 10 })
    expect(parsed.text).toBe('No metadata here')
  })
})
