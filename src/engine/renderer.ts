import * as THREE from 'three'
import type { Vec3 } from './math'

/** 单帧相机姿态（由 main 完成插值后下发） */
export interface CameraPose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

export class GameRenderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera

  constructor(canvas: HTMLCanvasElement, fov: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 12000)
    this.resize()
  }

  configure(sky: number, fogNear: number, fogFar: number): void {
    this.scene.background = new THREE.Color(sky)
    this.scene.fog = new THREE.Fog(sky, fogNear, fogFar)
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x7a705c, 0.85)
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.5)
    sun.position.set(800, 1200, 500)
    this.scene.add(hemi, sun)
  }

  addGroundGrid(size: number, divisions: number, y: number): void {
    const grid = new THREE.GridHelper(size, divisions, 0x555555, 0x8a8a72)
    grid.position.y = y
    this.scene.add(grid)
  }

  addBox(min: Vec3, max: Vec3, color: number, opacity = 1): void {
    const w = max.x - min.x
    const h = max.y - min.y
    const d = max.z - min.z
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }),
    )
    mesh.position.set(min.x + w / 2, min.y + h / 2, min.z + d / 2)
    this.scene.add(mesh)
  }

  setCamera(pose: CameraPose): void {
    this.camera.position.set(pose.x, pose.y, pose.z)
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = pose.yaw
    this.camera.rotation.x = pose.pitch
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}
