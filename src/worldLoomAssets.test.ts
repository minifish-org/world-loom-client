import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  AssetCatalogEntry,
  AssetEvent,
  AssetInstance,
  validateCatalogEntry,
  WorldLoomAssetRuntime
} from './worldLoomAssets'

const asset = (): AssetCatalogEntry => ({
  asset_id: 'test_prop',
  version: 1,
  spec_hash: 'a'.repeat(64),
  spec: {
    schema_version: 1,
    asset_id: 'test_prop',
    version: 1,
    name: 'Test Prop',
    materials: [{
      id: 'wood',
      base_color: '#885522',
      emissive_color: '#000000',
      metalness: 0,
      roughness: 0.8,
      opacity: 1
    }],
    nodes: [{
      id: 'body',
      kind: 'box',
      material: 'wood',
      position: [0, 0.5, 0],
      rotation_degrees: [0, 0, 0],
      scale: [1, 1, 1],
      size: [1, 1, 1]
    }],
    collision: { mode: 'bounds' },
    lod: { max_distance: 64 },
    animations: []
  },
  budget: {
    source_bytes: 500,
    nodes: 1,
    expanded_primitives: 1,
    estimated_triangles: 12,
    estimated_draw_calls: 1,
    materials: 1,
    animations: 0,
    textures: 0
  }
})

const instance = (): AssetInstance => ({
  instance_id: 'instance-1',
  asset_id: 'test_prop',
  version: 1,
  position: [8, 65, 8],
  rotation_degrees: [0, 0, 0],
  scale: [1, 1, 1],
  collision: { mode: 'bounds' },
  interaction_state: {},
  owner: 'mcp',
  created_at: 'now',
  updated_at: 'now'
})

const renderer = () => {
  const scene = new THREE.Scene()
  return {
    scene,
    sceneOrigin: {
      track () {},
      removeAndUntrack: (object: THREE.Object3D) => object.removeFromParent()
    },
    camera: new THREE.PerspectiveCamera(),
    cameraWorldPos: { x: 8, y: 65, z: 8 },
    onRender: [] as Array<(delta: number) => void>
  }
}

describe('WorldLoomAssetRuntime', () => {
  it('creates, updates, removes, and disposes main-scene instances', () => {
    const target = renderer()
    const runtime = new WorldLoomAssetRuntime(target)
    runtime.applyEvent({
      protocol_version: 1,
      event: 'catalog_snapshot',
      assets: [asset()],
      instances: [instance()]
    })
    expect(runtime.catalogSize).toBe(1)
    expect(runtime.activeInstanceCount).toBe(1)
    expect(target.scene.children).toHaveLength(1)
    expect(target.onRender).toHaveLength(1)

    runtime.applyEvent({
      protocol_version: 1,
      event: 'update_instance',
      instance: { ...instance(), position: [9, 66, 9] }
    })
    expect(target.scene.children[0].position.toArray()).toEqual([9, 66, 9])

    runtime.applyEvent({
      protocol_version: 1,
      event: 'remove_instance',
      instance_id: 'instance-1'
    })
    expect(runtime.activeInstanceCount).toBe(0)
    expect(target.scene.children).toHaveLength(0)

    runtime.dispose()
    expect(target.onRender).toHaveLength(0)
  })

  it('rejects executable/remote-looking catalog content and over-budget metadata', () => {
    const withUrl = asset()
    withUrl.spec.name = 'https://example.test/asset'
    expect(() => validateCatalogEntry(withUrl)).toThrow(/URL/)

    const overBudget = asset()
    overBudget.budget.estimated_triangles = 50_001
    expect(() => validateCatalogEntry(overBudget)).toThrow(/budgets/)
  })

  it('rejects unsupported protocol versions before touching the scene', () => {
    const target = renderer()
    const runtime = new WorldLoomAssetRuntime(target)
    const bad = {
      protocol_version: 2,
      event: 'catalog_snapshot',
      assets: [],
      instances: []
    } as unknown as AssetEvent
    expect(() => runtime.applyEvent(bad)).toThrow(/protocol version/)
    expect(target.scene.children).toHaveLength(0)
    runtime.dispose()
  })
})
