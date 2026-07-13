import type { SculptNode, SculptSpec } from './worldLoomAssets'

const MAX_BYTES = 65_536
const MAX_NODES = 128
const MAX_MATERIALS = 32
const MAX_PRIMITIVES = 256
const MAX_TRIANGLES = 50_000

export interface AssetStudioReport {
  valid: boolean
  errors: string[]
  budget: {
    source_bytes: number
    nodes: number
    expanded_primitives: number
    estimated_triangles: number
    estimated_draw_calls: number
    materials: number
    animations: number
    textures: 0
  }
}

interface PreviewPrimitive {
  id: string
  kind: SculptNode['kind']
  center: [number, number, number]
  size: [number, number, number]
  color: string
}

export const inspectSculptSpec = (input: unknown): AssetStudioReport => {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalidReport(['spec must be an object'])
  }
  const spec = input as SculptSpec
  const sourceBytes = new TextEncoder().encode(JSON.stringify(spec)).byteLength
  const materialList = Array.isArray(spec.materials) ? spec.materials : []
  const nodeList = Array.isArray(spec.nodes) ? spec.nodes : []
  const animationList = Array.isArray(spec.animations) ? spec.animations : []
  if (sourceBytes > MAX_BYTES) errors.push(`source exceeds ${MAX_BYTES} bytes`)
  if (spec.schema_version !== 1) errors.push('schema_version must be 1')
  if (!/^[a-z][a-z\d_-]{0,63}$/.test(spec.asset_id ?? '')) errors.push('asset_id is invalid')
  if (!Number.isInteger(spec.version) || spec.version < 1 || spec.version > 65_535) errors.push('version is invalid')
  if (typeof spec.name !== 'string' || new TextEncoder().encode(spec.name).byteLength < 1 || new TextEncoder().encode(spec.name).byteLength > 80) errors.push('name is invalid')
  if (!Array.isArray(spec.materials) || spec.materials.length < 1 || spec.materials.length > MAX_MATERIALS) errors.push('material count is invalid')
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 1 || spec.nodes.length > MAX_NODES) errors.push('node count is invalid')
  if (!Array.isArray(spec.animations) || spec.animations.length > 32) errors.push('animation count is invalid')
  if (JSON.stringify(spec).includes('://')) errors.push('URLs are forbidden')

  const materials = new Set<string>()
  for (const material of materialList) {
    if (!material || typeof material !== 'object') {
      errors.push('material must be an object')
      continue
    }
    if (!/^[a-z][a-z\d_-]{0,63}$/.test(material.id) || materials.has(material.id)) errors.push(`invalid or duplicate material ${material.id}`)
    materials.add(material.id)
    if (!/^#[\da-fA-F]{6}$/.test(material.base_color) || !/^#[\da-fA-F]{6}$/.test(material.emissive_color)) errors.push(`invalid color on ${material.id}`)
    if (![material.metalness, material.roughness, material.opacity].every(unitNumber)) errors.push(`invalid material parameters on ${material.id}`)
  }

  let primitives = 0
  let triangles = 0
  const nodes = new Set<string>()
  for (const node of nodeList) {
    if (!node || typeof node !== 'object') {
      errors.push('node must be an object')
      continue
    }
    if (!/^[a-z][a-z\d_-]{0,63}$/.test(node.id) || nodes.has(node.id)) errors.push(`invalid or duplicate node ${node.id}`)
    if (node.parent && !nodes.has(node.parent)) errors.push(`node ${node.id} parent must be earlier`)
    nodes.add(node.id)
    if (!vector(node.position, -64, 64) || !vector(node.rotation_degrees, -3600, 3600) || !vector(node.scale, 0.01, 16)) errors.push(`invalid transform on ${node.id}`)
    const count = node.repeat?.count ?? 1
    if (!Number.isInteger(count) || count < 1 || count > 32) errors.push(`invalid repeat on ${node.id}`)
    if (node.repeat && !vector(node.repeat.offset, -64, 64)) errors.push(`invalid repeat offset on ${node.id}`)
    if (node.kind !== 'group') {
      if (!node.material || !materials.has(node.material)) errors.push(`unknown material on ${node.id}`)
      const geometryTriangles = validateGeometry(node, errors)
      if (geometryTriangles !== undefined && Number.isInteger(count) && count >= 1 && count <= 32) {
        primitives += count
        triangles += geometryTriangles * count
      }
    } else if (node.material || hasGeometryFields(node)) {
      errors.push(`group ${node.id} cannot declare material or geometry`)
    }
  }
  if (primitives > MAX_PRIMITIVES) errors.push(`expanded primitives exceed ${MAX_PRIMITIVES}`)
  if (triangles > MAX_TRIANGLES) errors.push(`estimated triangles exceed ${MAX_TRIANGLES}`)
  if (!spec.lod || !bounded(spec.lod.max_distance, 8, 256)) errors.push('lod.max_distance is invalid')
  validateCollision(spec.collision, errors)
  for (const animation of animationList) {
    if (!animation || typeof animation !== 'object' || !nodes.has(animation.node) || !['rotate', 'bob'].includes(animation.kind) || !['x', 'y', 'z'].includes(animation.axis) || !bounded(animation.speed, -10, 10) || !bounded(animation.amplitude, 0, 16)) {
      errors.push('animation target or parameters are invalid')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    budget: {
      source_bytes: sourceBytes,
      nodes: nodeList.length,
      expanded_primitives: primitives,
      estimated_triangles: triangles,
      estimated_draw_calls: primitives,
      materials: materialList.length,
      animations: animationList.length,
      textures: 0
    }
  }
}

export const renderSculptPreview = (spec: SculptSpec) => {
  const report = inspectSculptSpec(spec)
  if (!report.valid) throw new Error(`invalid SculptSpec: ${report.errors.join('; ')}`)
  const primitives = expandPreviewPrimitives(spec)
  const views = [
    { id: 'front', title: 'Front', project: ([x, y]: [number, number, number]) => [x, -y] as const },
    { id: 'side', title: 'Side', project: (([, y, z]: [number, number, number]) => [z, -y] as const) },
    { id: 'isometric', title: 'Isometric', project: (([x, y, z]: [number, number, number]) => [(x - z) * 0.7, -y + (x + z) * 0.35] as const) }
  ]
  const width = 960
  const height = 360
  const panelWidth = width / views.length
  const markup = views.map((view, viewIndex) => {
    const projected = primitives.map(primitive => ({ primitive, point: view.project(primitive.center) }))
    const extents = projected.flatMap(item => [Math.abs(item.point[0]), Math.abs(item.point[1]), ...item.primitive.size])
    const scale = Math.min(70, 120 / Math.max(1, ...extents))
    const originX = viewIndex * panelWidth + panelWidth / 2
    const originY = height / 2 + 25
    const shapes = projected.map(({ primitive, point }) => {
      const sizeX = Math.max(2, primitive.size[0] * scale)
      const sizeY = Math.max(2, primitive.size[1] * scale)
      const x = originX + point[0] * scale - sizeX / 2
      const y = originY + point[1] * scale - sizeY / 2
      if (primitive.kind === 'sphere') {
        return `<ellipse data-node="${escapeXml(primitive.id)}" cx="${round(x + sizeX / 2)}" cy="${round(y + sizeY / 2)}" rx="${round(sizeX / 2)}" ry="${round(sizeY / 2)}" fill="${primitive.color}" stroke="#20252b"/>`
      }
      return `<rect data-node="${escapeXml(primitive.id)}" x="${round(x)}" y="${round(y)}" width="${round(sizeX)}" height="${round(sizeY)}" rx="2" fill="${primitive.color}" stroke="#20252b"/>`
    }).join('')
    return `<g id="${view.id}"><rect x="${viewIndex * panelWidth}" y="0" width="${panelWidth}" height="${height}" fill="#f5f7fa" stroke="#c9d1d9"/><text x="${viewIndex * panelWidth + 16}" y="28" font-family="system-ui" font-size="16" fill="#20252b">${view.title}</text>${shapes}</g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.name)} fixed-camera preview">${markup}</svg>\n`
}

const expandPreviewPrimitives = (spec: SculptSpec): PreviewPrimitive[] => {
  const materials = new Map(spec.materials.map(material => [material.id, material.base_color]))
  const positions = new Map<string, [number, number, number]>()
  const output: PreviewPrimitive[] = []
  for (const node of spec.nodes) {
    const parent = node.parent ? positions.get(node.parent)! : [0, 0, 0]
    const center = add(parent, node.position)
    positions.set(node.id, center)
    if (node.kind === 'group') continue
    const count = node.repeat?.count ?? 1
    const offset = node.repeat?.offset ?? [0, 0, 0]
    for (let index = 0; index < count; index++) {
      output.push({
        id: `${node.id}-${index}`,
        kind: node.kind,
        center: add(center, multiply(offset, index)),
        size: geometrySize(node),
        color: materials.get(node.material!)!
      })
    }
  }
  return output
}

const validateGeometry = (node: SculptNode, errors: string[]) => {
  const invalid = () => {
    errors.push(`invalid geometry on ${node.id}`)
    return undefined
  }
  switch (node.kind) {
    case 'box': return node.size?.length === 3 && node.size.every(dimension) && !hasRoundFields(node) ? 12 : invalid()
    case 'plane': return node.size?.length === 2 && node.size.every(dimension) && !hasRoundFields(node) ? 2 : invalid()
    case 'sphere': return dimension(node.radius) && validSegments(node.segments) && node.size === undefined && node.height === undefined && node.radius_top === undefined && node.radius_bottom === undefined ? 2 * node.segments * Math.ceil(node.segments / 2) : invalid()
    case 'cylinder': return dimension(node.radius_top) && dimension(node.radius_bottom) && dimension(node.height) && validSegments(node.segments) && node.size === undefined && node.radius === undefined ? 4 * node.segments : invalid()
    case 'cone': return dimension(node.radius) && dimension(node.height) && validSegments(node.segments) && node.size === undefined && node.radius_top === undefined && node.radius_bottom === undefined ? 2 * node.segments : invalid()
    default: return invalid()
  }
}

const validateCollision = (collision: SculptSpec['collision'], errors: string[]) => {
  if (!collision || typeof collision !== 'object') {
    errors.push('collision is invalid')
    return
  }
  const boxes = Array.isArray(collision.boxes) ? collision.boxes : []
  if ((collision.mode === 'none' || collision.mode === 'bounds') && boxes.length === 0) return
  if (collision.mode === 'compound_boxes' && boxes.length >= 1 && boxes.length <= 16 && boxes.every(box => box && vector(box.center, -64, 64) && vector(box.size, 0.01, 64))) return
  errors.push('collision is invalid')
}

const hasGeometryFields = (node: SculptNode) => node.size !== undefined || hasRoundFields(node)
const hasRoundFields = (node: SculptNode) => node.radius !== undefined || node.radius_top !== undefined || node.radius_bottom !== undefined || node.height !== undefined || node.segments !== undefined
const dimension = (value: number | undefined): value is number => typeof value === 'number' && bounded(value, 0.01, 64)
const validSegments = (value: number | undefined): value is number => typeof value === 'number' && Number.isInteger(value) && bounded(value, 3, 32)

const geometrySize = (node: SculptNode): [number, number, number] => {
  switch (node.kind) {
    case 'box': return node.size as [number, number, number]
    case 'plane': return [node.size![0], node.size![1], 0.01]
    case 'sphere': return [node.radius! * 2, node.radius! * 2, node.radius! * 2]
    case 'cylinder': return [Math.max(node.radius_top!, node.radius_bottom!) * 2, node.height!, Math.max(node.radius_top!, node.radius_bottom!) * 2]
    case 'cone': return [node.radius! * 2, node.height!, node.radius! * 2]
    default: return [0, 0, 0]
  }
}

const invalidReport = (errors: string[]): AssetStudioReport => ({
  valid: false,
  errors,
  budget: { source_bytes: 0, nodes: 0, expanded_primitives: 0, estimated_triangles: 0, estimated_draw_calls: 0, materials: 0, animations: 0, textures: 0 }
})
const bounded = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
const unitNumber = (value: number) => bounded(value, 0, 1)
const vector = (value: number[], min: number, max: number) => Array.isArray(value) && value.length === 3 && value.every(item => bounded(item, min, max))
const add = (a: number[], b: number[]): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const multiply = (value: number[], scalar: number): [number, number, number] => [value[0] * scalar, value[1] * scalar, value[2] * scalar]
const round = (value: number) => Math.round(value * 100) / 100
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
