import { describe, expect, it } from 'vitest'
import { inspectSculptSpec, renderSculptPreview } from './worldLoomAssetStudio'
import type { SculptSpec } from './worldLoomAssets'

const spec = (): SculptSpec => ({
  schema_version: 1,
  asset_id: 'studio_prop',
  version: 1,
  name: 'Studio Prop',
  materials: [{ id: 'blue', base_color: '#2266aa', emissive_color: '#000000', metalness: 0.1, roughness: 0.7, opacity: 1 }],
  nodes: [{ id: 'body', kind: 'box', material: 'blue', position: [0, 0.5, 0], rotation_degrees: [0, 0, 0], scale: [1, 1, 1], size: [1, 1, 1] }],
  collision: { mode: 'bounds' },
  lod: { max_distance: 64 },
  animations: []
})

describe('World Loom Asset Studio', () => {
  it('reports deterministic budgets and fixed camera SVG views', () => {
    const report = inspectSculptSpec(spec())
    expect(report.valid).toBe(true)
    expect(report.budget.estimated_triangles).toBe(12)
    const first = renderSculptPreview(spec())
    const second = renderSculptPreview(spec())
    expect(first).toBe(second)
    expect(first).toContain('id="front"')
    expect(first).toContain('id="side"')
    expect(first).toContain('id="isometric"')
  })

  it('rejects URLs and over-budget repetition', () => {
    const invalid = spec()
    invalid.name = 'https://example.test/prop'
    invalid.nodes[0].repeat = { count: 32, offset: [1, 0, 0] }
    for (let index = 0; index < 9; index++) invalid.nodes.push({ ...invalid.nodes[0], id: `body_${index}` })
    const report = inspectSculptSpec(invalid)
    expect(report.valid).toBe(false)
    expect(report.errors).toContain('URLs are forbidden')
    expect(report.errors.some(error => error.includes('expanded primitives'))).toBe(true)
  })

  it('rejects malformed primitive geometry before rendering', () => {
    const invalid = spec()
    invalid.nodes[0] = {
      id: 'body',
      kind: 'sphere',
      material: 'blue',
      position: [0, 0.5, 0],
      rotation_degrees: [0, 0, 0],
      scale: [1, 1, 1]
    }
    const report = inspectSculptSpec(invalid)
    expect(report.valid).toBe(false)
    expect(report.errors).toContain('invalid geometry on body')
    expect(() => renderSculptPreview(invalid)).toThrow('invalid geometry on body')
  })
})
