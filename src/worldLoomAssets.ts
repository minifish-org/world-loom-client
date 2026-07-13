import * as THREE from 'three'

const ASSET_CHANNEL = 'world-loom:assets-v1'
const ASSET_READY_CHANNEL = 'world-loom:assets-ready-v1'
const PROTOCOL_VERSION = 1
const MAX_PAYLOAD_BYTES = 65_536
const MAX_PRIMITIVES = 256
const MAX_TRIANGLES = 50_000
const MAX_MATERIALS = 32

type Vec3 = [number, number, number]

export interface SculptMaterial {
  id: string
  base_color: string
  emissive_color: string
  metalness: number
  roughness: number
  opacity: number
}

export interface SculptNode {
  id: string
  parent?: string
  kind: 'group' | 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane'
  material?: string
  position: Vec3
  rotation_degrees: Vec3
  scale: Vec3
  size?: number[]
  radius?: number
  radius_top?: number
  radius_bottom?: number
  height?: number
  segments?: number
  repeat?: { count: number, offset: Vec3 }
}

export interface SculptSpec {
  schema_version: 1
  asset_id: string
  version: number
  name: string
  materials: SculptMaterial[]
  nodes: SculptNode[]
  collision: { mode: 'none' | 'bounds' | 'compound_boxes', boxes?: Array<{ center: Vec3, size: Vec3 }> }
  lod: { max_distance: number }
  animations: Array<{ node: string, kind: 'rotate' | 'bob', axis: 'x' | 'y' | 'z', speed: number, amplitude: number }>
}

export interface AssetCatalogEntry {
  asset_id: string
  version: number
  spec_hash: string
  spec: SculptSpec
  budget: {
    source_bytes: number
    nodes: number
    expanded_primitives: number
    estimated_triangles: number
    estimated_draw_calls: number
    materials: number
    animations: number
    textures: number
  }
}

export interface AssetInstance {
  instance_id: string
  asset_id: string
  version: number
  position: Vec3
  rotation_degrees: Vec3
  scale: Vec3
  collision: unknown
  interaction_state: Record<string, unknown>
  owner: string
  created_at: string
  updated_at: string
}

export type AssetEvent =
  | { protocol_version: 1, event: 'catalog_snapshot', assets: AssetCatalogEntry[], instances: AssetInstance[] }
  | { protocol_version: 1, event: 'asset_published', asset: AssetCatalogEntry }
  | { protocol_version: 1, event: 'spawn_instance', instance: AssetInstance }
  | { protocol_version: 1, event: 'update_instance', instance: AssetInstance }
  | { protocol_version: 1, event: 'remove_instance', instance_id: string }

interface WorldRendererLike {
  scene: THREE.Scene
  sceneOrigin: {
    track: (object: THREE.Object3D, options?: { updateMatrix?: boolean }) => void
    removeAndUntrack: (object: THREE.Object3D) => void
  }
  camera: THREE.Camera
  cameraWorldPos: { x: number, y: number, z: number }
  renderer?: { domElement?: HTMLElement }
  onRender: Array<(deltaTime: number) => void>
}

interface RenderedInstance {
  instance: AssetInstance
  asset: AssetCatalogEntry
  root: THREE.Group
  mixer: THREE.AnimationMixer
  materials: Set<THREE.Material>
  geometries: Set<THREE.BufferGeometry>
  animatedNodes: Map<string, { object: THREE.Object3D, basePosition: THREE.Vector3, baseRotation: THREE.Euler }>
  elapsed: number
}

export class WorldLoomAssetRuntime {
  private readonly catalog = new Map<string, AssetCatalogEntry>()
  private readonly instances = new Map<string, RenderedInstance>()
  private readonly onRender = (deltaTime: number) => this.render(deltaTime)
  private readonly onPointerDown = (event: PointerEvent) => this.hitTestPointer(event)
  private disposed = false

  constructor (private readonly renderer: WorldRendererLike) {
    renderer.onRender.push(this.onRender)
    renderer.renderer?.domElement?.addEventListener('pointerdown', this.onPointerDown)
  }

  applyEvent (event: AssetEvent) {
    if (this.disposed) throw new Error('World Loom asset runtime is disposed')
    validateAssetEvent(event)
    switch (event.event) {
      case 'catalog_snapshot':
        this.clearInstances()
        this.catalog.clear()
        for (const asset of event.assets) this.addCatalogEntry(asset)
        for (const instance of event.instances) this.spawn(instance)
        break
      case 'asset_published':
        this.addCatalogEntry(event.asset)
        break
      case 'spawn_instance':
        this.spawn(event.instance)
        break
      case 'update_instance':
        this.update(event.instance)
        break
      case 'remove_instance':
        this.remove(event.instance_id)
        break
    }
    publishRuntimeDiagnostics(this.catalog.size, this.instances.size)
  }

  get activeInstanceCount () {
    return this.instances.size
  }

  get catalogSize () {
    return this.catalog.size
  }

  hitTest (raycaster: THREE.Raycaster) {
    const hits = raycaster.intersectObjects([...this.instances.values()].map(item => item.root), true)
    for (const hit of hits) {
      const { object: hitObject } = hit
      let object: THREE.Object3D | null = hitObject
      while (object) {
        const instanceId = object.userData.worldLoomInstanceId as string | undefined
        if (instanceId) return this.instances.get(instanceId)?.instance
        object = object.parent
      }
    }
    return undefined
  }

  dispose () {
    if (this.disposed) return
    this.disposed = true
    this.clearInstances()
    this.catalog.clear()
    const index = this.renderer.onRender.indexOf(this.onRender)
    if (index !== -1) this.renderer.onRender.splice(index, 1)
    this.renderer.renderer?.domElement?.removeEventListener('pointerdown', this.onPointerDown)
    publishRuntimeDiagnostics(0, 0)
  }

  private addCatalogEntry (asset: AssetCatalogEntry) {
    validateCatalogEntry(asset)
    this.catalog.set(assetKey(asset.asset_id, asset.version), asset)
  }

  private spawn (instance: AssetInstance) {
    validateInstance(instance)
    if (this.instances.has(instance.instance_id)) {
      this.update(instance)
      return
    }
    const asset = this.catalog.get(assetKey(instance.asset_id, instance.version))
    if (!asset) throw new Error(`World Loom asset ${instance.asset_id}@${instance.version} is not in the catalog`)
    const rendered = createRenderedInstance(this.renderer, asset, instance)
    this.instances.set(instance.instance_id, rendered)
  }

  private update (instance: AssetInstance) {
    validateInstance(instance)
    const rendered = this.instances.get(instance.instance_id)
    if (!rendered) {
      this.spawn(instance)
      return
    }
    if (rendered.instance.asset_id !== instance.asset_id || rendered.instance.version !== instance.version) {
      this.remove(instance.instance_id)
      this.spawn(instance)
      return
    }
    rendered.instance = instance
    applyTransform(rendered.root, instance)
    rendered.root.userData.worldLoomInteractionState = instance.interaction_state
    rendered.root.userData.worldLoomVisualBounds = new THREE.Box3().setFromObject(rendered.root)
  }

  private remove (instanceId: string) {
    const rendered = this.instances.get(instanceId)
    if (!rendered) return
    disposeRenderedInstance(this.renderer, rendered)
    this.instances.delete(instanceId)
  }

  private clearInstances () {
    for (const rendered of this.instances.values()) disposeRenderedInstance(this.renderer, rendered)
    this.instances.clear()
  }

  private render (deltaTime: number) {
    for (const rendered of this.instances.values()) {
      const distance = distanceToInstance(this.renderer.cameraWorldPos, rendered.instance.position)
      rendered.root.visible = distance <= rendered.asset.spec.lod.max_distance
      if (!rendered.root.visible) continue
      rendered.elapsed += deltaTime
      rendered.mixer.update(deltaTime)
      for (const animation of rendered.asset.spec.animations) {
        const target = rendered.animatedNodes.get(animation.node)
        if (!target) continue
        const { axis } = animation
        if (animation.kind === 'rotate') {
          target.object.rotation[axis] = target.baseRotation[axis] + rendered.elapsed * animation.speed * animation.amplitude
        } else {
          target.object.position[axis] = target.basePosition[axis] + Math.sin(rendered.elapsed * animation.speed) * animation.amplitude
        }
      }
    }
  }

  private hitTestPointer (event: PointerEvent) {
    const element = this.renderer.renderer?.domElement
    if (!element) return
    const rect = element.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(pointer, this.renderer.camera)
    const instance = this.hitTest(raycaster)
    if (instance) {
      window.dispatchEvent(new CustomEvent('world-loom:asset-select', { detail: instance }))
    }
  }
}

let activeRuntime: WorldLoomAssetRuntime | undefined

const publishRuntimeDiagnostics = (catalogSize: number, instanceCount: number) => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.worldLoomAssetProtocol = String(PROTOCOL_VERSION)
  document.documentElement.dataset.worldLoomAssetCatalogSize = String(catalogSize)
  document.documentElement.dataset.worldLoomAssetInstanceCount = String(instanceCount)
}

export const registerWorldLoomAssetChannels = () => {
  const packetStructure = [
    'container',
    [
      { name: 'eventJson', type: ['pstring', { countType: 'varint' }] }
    ]
  ]
  bot._client.registerChannel(ASSET_CHANNEL, packetStructure, true)
  bot._client.on(ASSET_CHANNEL as any, async ({ eventJson }) => {
    await appViewer.worldReady
    const bytes = new TextEncoder().encode(eventJson).byteLength
    if (bytes > MAX_PAYLOAD_BYTES) {
      console.warn(`Rejected oversized World Loom asset payload (${bytes} bytes)`)
      return
    }
    try {
      const event = JSON.parse(eventJson) as AssetEvent
      const renderer = (globalThis as any).world as WorldRendererLike | undefined
      if (!renderer) throw new Error('main-world Three.js renderer is unavailable')
      if (!activeRuntime || (activeRuntime as any).renderer !== renderer) {
        activeRuntime?.dispose()
        activeRuntime = new WorldLoomAssetRuntime(renderer)
      }
      activeRuntime.applyEvent(event)
      ;(window as any).worldLoomAssetRuntime = activeRuntime
    } catch (error) {
      console.warn('Rejected invalid World Loom asset event:', error)
    }
  })

  bot._client.registerChannel(ASSET_READY_CHANNEL, ['container', [{ name: 'protocolVersion', type: 'varint' }]], true)
  bot._client.writeChannel(ASSET_READY_CHANNEL, { protocolVersion: PROTOCOL_VERSION })
  bot.once('end', () => {
    activeRuntime?.dispose()
    activeRuntime = undefined
    ;(window as any).worldLoomAssetRuntime = undefined
  })
}

export const validateAssetEvent = (event: AssetEvent) => {
  if (!event || event.protocol_version !== PROTOCOL_VERSION) throw new Error('unsupported asset protocol version')
  if (!['catalog_snapshot', 'asset_published', 'spawn_instance', 'update_instance', 'remove_instance'].includes(event.event)) {
    throw new Error('unknown asset lifecycle event')
  }
}

export const validateCatalogEntry = (asset: AssetCatalogEntry) => {
  if (!asset || asset.asset_id !== asset.spec?.asset_id || asset.version !== asset.spec?.version || asset.spec?.schema_version !== 1) {
    throw new Error('asset catalog identity/schema mismatch')
  }
  if (!/^[a-z][a-z\d_-]{0,63}$/.test(asset.asset_id)) throw new Error('invalid asset id')
  if (asset.budget.expanded_primitives > MAX_PRIMITIVES || asset.budget.estimated_triangles > MAX_TRIANGLES || asset.budget.materials > MAX_MATERIALS || asset.budget.textures !== 0) {
    throw new Error('asset exceeds client visual budgets')
  }
  if (asset.spec.materials.length !== asset.budget.materials || asset.spec.nodes.length !== asset.budget.nodes) {
    throw new Error('asset budget does not match declarative source')
  }
  if (JSON.stringify(asset.spec).includes('://')) throw new Error('asset source contains a URL')
}

const validateInstance = (instance: AssetInstance) => {
  if (!instance?.instance_id || !instance.asset_id || !Number.isInteger(instance.version)) throw new Error('invalid asset instance identity')
  for (const value of [...instance.position, ...instance.rotation_degrees, ...instance.scale]) {
    if (!Number.isFinite(value)) throw new Error('asset transform must be finite')
  }
  if (instance.scale.some(value => value < 0.01 || value > 16)) throw new Error('asset scale is outside bounds')
}

const createRenderedInstance = (renderer: WorldRendererLike, asset: AssetCatalogEntry, instance: AssetInstance): RenderedInstance => {
  const root = new THREE.Group()
  root.name = `world-loom:${instance.instance_id}`
  root.userData.worldLoomInstanceId = instance.instance_id
  root.userData.worldLoomInteractionState = instance.interaction_state
  const materials = createMaterials(asset.spec.materials)
  const geometries = new Set<THREE.BufferGeometry>()
  const nodeObjects = new Map<string, THREE.Object3D>()
  const animatedNodes = new Map<string, { object: THREE.Object3D, basePosition: THREE.Vector3, baseRotation: THREE.Euler }>()

  for (const node of asset.spec.nodes) {
    const nodeObject = new THREE.Group()
    nodeObject.name = node.id
    setNodeTransform(nodeObject, node)
    const parent = node.parent ? nodeObjects.get(node.parent) : root
    if (!parent) throw new Error(`asset node ${node.id} references missing parent ${node.parent}`)
    parent.add(nodeObject)
    nodeObjects.set(node.id, nodeObject)
    animatedNodes.set(node.id, {
      object: nodeObject,
      basePosition: nodeObject.position.clone(),
      baseRotation: nodeObject.rotation.clone()
    })
    if (node.kind === 'group') continue
    const geometry = createGeometry(node)
    geometries.add(geometry)
    const material = materials.get(node.material!)
    if (!material) throw new Error(`asset node ${node.id} references missing material ${node.material}`)
    const count = node.repeat?.count ?? 1
    const offset = node.repeat?.offset ?? [0, 0, 0]
    for (let index = 0; index < count; index++) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(offset[0] * index, offset[1] * index, offset[2] * index)
      mesh.frustumCulled = true
      mesh.userData.worldLoomInstanceId = instance.instance_id
      nodeObject.add(mesh)
    }
  }

  applyTransform(root, instance)
  renderer.scene.add(root)
  renderer.sceneOrigin.track(root, { updateMatrix: true })
  root.position.set(...instance.position)
  root.userData.worldLoomVisualBounds = new THREE.Box3().setFromObject(root)
  return {
    instance,
    asset,
    root,
    mixer: new THREE.AnimationMixer(root),
    materials: new Set(materials.values()),
    geometries,
    animatedNodes,
    elapsed: 0
  }
}

const createMaterials = (definitions: SculptMaterial[]) => {
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  for (const definition of definitions) {
    if (materials.has(definition.id)) throw new Error(`duplicate material ${definition.id}`)
    materials.set(definition.id, new THREE.MeshStandardMaterial({
      color: definition.base_color,
      emissive: definition.emissive_color,
      metalness: definition.metalness,
      roughness: definition.roughness,
      opacity: definition.opacity,
      transparent: definition.opacity < 1,
      side: THREE.FrontSide
    }))
  }
  return materials
}

const createGeometry = (node: SculptNode): THREE.BufferGeometry => {
  switch (node.kind) {
    case 'box': return new THREE.BoxGeometry(node.size![0], node.size![1], node.size![2])
    case 'sphere': return new THREE.SphereGeometry(node.radius, node.segments, Math.ceil(node.segments! / 2))
    case 'cylinder': return new THREE.CylinderGeometry(node.radius_top, node.radius_bottom, node.height, node.segments)
    case 'cone': return new THREE.ConeGeometry(node.radius, node.height, node.segments)
    case 'plane': return new THREE.PlaneGeometry(node.size![0], node.size![1])
    default: throw new Error(`unsupported primitive kind ${(node).kind}`)
  }
}

const setNodeTransform = (object: THREE.Object3D, node: SculptNode) => {
  object.position.set(...node.position)
  object.rotation.set(...node.rotation_degrees.map(THREE.MathUtils.degToRad) as Vec3)
  object.scale.set(...node.scale)
}

const applyTransform = (object: THREE.Object3D, instance: AssetInstance) => {
  object.position.set(...instance.position)
  object.rotation.set(...instance.rotation_degrees.map(THREE.MathUtils.degToRad) as Vec3)
  object.scale.set(...instance.scale)
  object.updateMatrix()
}

const disposeRenderedInstance = (renderer: WorldRendererLike, rendered: RenderedInstance) => {
  rendered.mixer.stopAllAction()
  rendered.mixer.uncacheRoot(rendered.root)
  renderer.sceneOrigin.removeAndUntrack(rendered.root)
  rendered.root.removeFromParent()
  for (const geometry of rendered.geometries) geometry.dispose()
  for (const material of rendered.materials) material.dispose()
  rendered.animatedNodes.clear()
}

const assetKey = (assetId: string, version: number) => `${assetId}@${version}`

const distanceToInstance = (camera: { x: number, y: number, z: number }, position: Vec3) => Math.hypot(
  camera.x - position[0],
  camera.y - position[1],
  camera.z - position[2]
)
