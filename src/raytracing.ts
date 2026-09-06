import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { WebGLPathTracer, DenoiseMaterial } from 'three-gpu-pathtracer';

export type GraphicsQuality = 'performance' | 'balanced' | 'ultra';
export interface RenderStatus { mode: string; samples: number; status: string; error?: string }

export function getPathTracingSettings(quality: GraphicsQuality) {
  const bounces = quality === 'ultra' ? 7 : quality === 'performance' ? 3 : 5;
  return { bounces, transmissiveBounces: 15 - bounces };
}

export interface PathTracingSnapshot {
  scene: THREE.Scene;
  dispose(): void;
}

const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** An original floating-point sky, used for sampled indirect illumination. */
function makeSky(night: boolean): THREE.DataTexture {
  const width = 128, height = 64;
  const pixels = new Float32Array(width * height * 4);
  const sky = new THREE.Color(night ? 0x6b8ba8 : 0xc8e4ef);
  const horizon = new THREE.Color(night ? 0x5e707b : 0xf2e3c9);
  const ground = new THREE.Color(night ? 0x26302f : 0x8f9c87);
  const current = new THREE.Color();
  for (let y = 0; y < height; y++) {
    const altitude = Math.cos(y / (height - 1) * Math.PI);
    if (altitude > 0) current.copy(horizon).lerp(sky, Math.pow(altitude, 0.45));
    else current.copy(horizon).lerp(ground, Math.pow(-altitude, 0.25));
    current.multiplyScalar(night ? 0.22 : 0.82);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = current.r; pixels[offset + 1] = current.g; pixels[offset + 2] = current.b; pixels[offset + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeWater(): THREE.MeshPhysicalMaterial {
  // The realtime water uses a custom shader. The path tracer instead gets a
  // physical water surface so reflection and refraction are actually traced.
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const heightAt = (x: number, z: number) => Math.sin(x / size * Math.PI * 16 + Math.sin(z / size * Math.PI * 8)) * 0.5 + Math.sin(z / size * Math.PI * 24) * 0.25;
  const normal = new THREE.Vector3();
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    normal.set((heightAt(x - 1, z) - heightAt(x + 1, z)) * 0.4, (heightAt(x, z - 1) - heightAt(x, z + 1)) * 0.4, 1).normalize();
    const index = (z * size + x) * 4;
    data[index] = Math.round((normal.x * 0.5 + 0.5) * 255);
    data[index + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
    data[index + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
    data[index + 3] = 255;
  }
  const normalMap = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.minFilter = normalMap.magFilter = THREE.LinearFilter;
  normalMap.repeat.set(8, 8);
  normalMap.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({ color: 0x6aafb3, roughness: 0.12, metalness: 0.05, transmission: 0.2, ior: 1.333, thickness: 0.35, clearcoat: 0.85, clearcoatRoughness: 0.08, normalMap, normalScale: new THREE.Vector2(0.65, 0.65) });
}

/**
 * Isolated immutable geometry for the photo renderer. The pathtracer does not
 * support InstancedMesh: expand its transforms and bake instance colors into
 * vertex colors, then merge the result. No live materials/geometries are owned
 * or modified by this snapshot.
 */
export async function createPathTracingSnapshot(source: THREE.Scene, night = false, isCanceled: () => boolean = () => false): Promise<PathTracingSnapshot> {
  const checkCanceled = () => {
    if (isCanceled()) throw new DOMException('Raytracing-Vorbereitung abgebrochen.', 'AbortError');
  };
  checkCanceled();
  source.updateMatrixWorld(true);
  const result = new THREE.Scene();
  result.background = source.background instanceof THREE.Color ? source.background.clone() : new THREE.Color(0xcbded8);
  const sky = makeSky(night);
  result.environment = sky;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const extras = new Set<THREE.Texture>([sky]);
  const capturedGeometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    extras.forEach(texture => texture.dispose());
    result.clear();
    geometries.clear();
    materials.clear();
    extras.clear();
  };

  function materialFor(original: THREE.Material): THREE.MeshStandardMaterial {
    let material = materials.get(original);
    if (material) return material;
    if (original instanceof THREE.MeshStandardMaterial) material = original.clone();
    else if (original instanceof THREE.ShaderMaterial) {
      material = makeWater();
      if (material.normalMap) extras.add(material.normalMap);
    } else {
      const basic = original as THREE.MeshBasicMaterial;
      material = new THREE.MeshStandardMaterial({ color: basic.color ?? 0xffffff, side: original.side, roughness: 0.75 });
      if (basic.color) { material.emissive.copy(basic.color); material.emissiveIntensity = 1.5; }
    }
    materials.set(original, material);
    return material;
  }

  const objects: THREE.Object3D[] = [];
  function collect(object: THREE.Object3D) {
    if (!object.visible || object.userData.raytracingExclude) return;
    if (object instanceof THREE.Mesh) {
      // Pin all mutable inputs before the first yield. Terrain, vegetation and
      // instance buffers can be rebuilt by the next animation frame while the
      // expensive instance expansion below is yielding to keep Cancel usable.
      const copy = object.clone(false);
      let geometry = capturedGeometries.get(object.geometry);
      if (!geometry) {
        geometry = (object.geometry as THREE.BufferGeometry).clone();
        capturedGeometries.set(object.geometry, geometry);
      }
      copy.geometry = geometry;
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(materialFor);
      objects.push(copy);
    } else if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight || object instanceof THREE.RectAreaLight) {
      const copy = object.clone(false);
      if (copy instanceof THREE.DirectionalLight && object instanceof THREE.DirectionalLight) {
        copy.target.position.copy(object.target.getWorldPosition(new THREE.Vector3()));
      }
      objects.push(copy);
    }
    for (const child of object.children) collect(child);
  }
  try {
    collect(source);

    const transform = new THREE.Matrix4();
    const tint = new THREE.Color();
    for (let index = 0; index < objects.length; index++) {
      const object = objects[index];
      if (index % 32 === 0) { checkCanceled(); await yieldToBrowser(); checkCanceled(); }
      if (object instanceof THREE.Mesh) {
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const copyMaterials = sourceMaterials.map(materialFor);
        let geometry: THREE.BufferGeometry;
        if (object instanceof THREE.InstancedMesh) {
          if (object.count === 0) continue;
          const parts: THREE.BufferGeometry[] = [];
          for (let instance = 0; instance < object.count; instance++) {
            if (instance % 128 === 127) { checkCanceled(); await yieldToBrowser(); checkCanceled(); }
            const part = object.geometry.clone();
            geometries.add(part);
            object.getMatrixAt(instance, transform);
            transform.premultiply(object.matrixWorld);
            part.applyMatrix4(transform);
            if (object.instanceColor) {
              object.getColorAt(instance, tint);
              const count = part.getAttribute('position').count;
              const colors = new Float32Array(count * 3);
              const originalColors = part.getAttribute('color');
              for (let vertex = 0; vertex < count; vertex++) {
                colors[vertex * 3] = tint.r * (originalColors?.getX(vertex) ?? 1);
                colors[vertex * 3 + 1] = tint.g * (originalColors?.getY(vertex) ?? 1);
                colors[vertex * 3 + 2] = tint.b * (originalColors?.getZ(vertex) ?? 1);
              }
              part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
              copyMaterials.forEach(material => { material.vertexColors = true; });
            }
            parts.push(part);
          }
          const merged = mergeGeometries(parts, false);
          if (merged && sourceMaterials.length > 1) {
            let offset = 0;
            for (const part of parts) {
              for (const group of part.groups) merged.addGroup(offset + group.start, group.count, group.materialIndex);
              offset += part.index?.count ?? part.getAttribute('position').count;
            }
          }
          parts.forEach(part => { part.dispose(); geometries.delete(part); });
          if (!merged) throw new Error('Die Gelände-Geometrie konnte nicht für Raytracing vorbereitet werden.');
          geometry = merged;
        } else {
          geometry = object.geometry.clone();
          geometry.applyMatrix4(object.matrixWorld);
        }
        geometries.add(geometry);
        // Normalize before the upstream generator merges meshes. Its mixed
        // RGB/RGBA conversion path can leave vertex colors zero-initialized.
        const positions = geometry.getAttribute('position');
        const originalColor = geometry.getAttribute('color');
        if (!originalColor || originalColor.itemSize !== 4) {
          const rgba = new Float32Array(positions.count * 4);
          for (let vertex = 0; vertex < positions.count; vertex++) {
            rgba[vertex * 4] = originalColor?.getX(vertex) ?? 1;
            rgba[vertex * 4 + 1] = originalColor?.getY(vertex) ?? 1;
            rgba[vertex * 4 + 2] = originalColor?.getZ(vertex) ?? 1;
            rgba[vertex * 4 + 3] = 1;
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
        }
        const mesh = new THREE.Mesh(geometry, Array.isArray(object.material) ? copyMaterials : copyMaterials[0]);
        mesh.castShadow = object.castShadow;
        mesh.receiveShadow = object.receiveShadow;
        result.add(mesh);
      } else if (object instanceof THREE.DirectionalLight && object.castShadow) {
        // A large sampled emitter gives genuine soft penumbras in photo mode.
        const light = new THREE.RectAreaLight(object.color, object.intensity * 52, 8, 8);
        light.position.setFromMatrixPosition(object.matrixWorld);
        light.lookAt(object.target.getWorldPosition(new THREE.Vector3()));
        result.add(light);
      } else {
        const light = object.clone();
        object.matrixWorld.decompose(light.position, light.quaternion, light.scale);
        result.add(light);
      }
    }
    checkCanceled();
    result.updateMatrixWorld(true);
    return { scene: result, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    capturedGeometries.forEach(geometry => geometry.dispose());
    capturedGeometries.clear();
    objects.length = 0;
  }
}

type Disposable = { dispose(): void };
type PhotoTracer = WebGLPathTracer & { isCompiling?: boolean };
interface PhotoBackend {
  tracer: PhotoTracer;
  worker: Disposable;
  denoiseMaterial: DenoiseMaterial;
  denoiseQuad: FullScreenQuad;
  snapshot?: PathTracingSnapshot;
}

/** Release resources omitted by the pinned pathtracer 0.0.24 dispose method. */
function disposeTracer(tracer: PhotoTracer, renderer: THREE.WebGLRenderer) {
  type PhysicalMaterial = THREE.Material & {
    bvh?: Disposable; attributesArray?: Disposable; materialIndexAttribute?: Disposable;
    materials?: Disposable; lights?: { tex?: Disposable }; envMapInfo?: Disposable;
    stratifiedTexture?: Disposable; stratifiedOffsetTexture?: Disposable;
    textures?: THREE.Texture; iesProfiles?: THREE.Texture;
  };
  type PhotoRenderer = Disposable & {
    material?: PhysicalMaterial; _blendQuad?: FullScreenQuad; _compileFunction?: () => void;
  };
  const internal = tracer as PhotoTracer & {
    _pathTracer?: PhotoRenderer; _lowResPathTracer?: PhotoRenderer;
    _colorBackground?: Disposable; _internalBackground?: Disposable;
    _generator?: { geometry?: Disposable; staticGeometryGenerator?: {
      _intermediateGeometry?: Map<string, THREE.BufferGeometry>; _dummyMesh?: THREE.Mesh;
    } };
  };
  const disposed = new Set<Disposable>();
  const release = (resource?: Disposable) => {
    if (resource && !disposed.has(resource)) { disposed.add(resource); resource.dispose(); }
  };
  const renderers = [internal._pathTracer, internal._lowResPathTracer];
  for (const pathRenderer of renderers) {
    const material = pathRenderer?.material;
    if (!material) continue;
    if (pathRenderer._compileFunction) material.removeEventListener('recompilation' as 'dispose', pathRenderer._compileFunction);
    if (!disposed.has(material)) {
      for (const resource of [material.bvh, material.attributesArray, material.materialIndexAttribute, material.materials,
        material.lights?.tex, material.envMapInfo, material.stratifiedTexture, material.stratifiedOffsetTexture]) release(resource);
      for (const texture of [material.textures, material.iesProfiles]) {
        if (!texture) continue;
        type ArrayTarget = THREE.WebGLRenderTarget & { fsQuad?: FullScreenQuad };
        // Three's array target replaces its texture after construction, losing
        // texture.renderTarget. Once uploaded, WebGLTextures records the real
        // framebuffer owner in renderer properties instead.
        const properties = renderer.properties?.get(texture) as { __renderTarget?: ArrayTarget } | undefined;
        const target = (texture.renderTarget ?? properties?.__renderTarget) as ArrayTarget | undefined;
        if (target) {
          release(target.fsQuad?.material as THREE.Material | undefined);
          release(target);
        } else release(texture); // No framebuffer was allocated for this one.
      }
      release(material);
    }
    release(pathRenderer._blendQuad?.material as THREE.Material | undefined);
  }
  // Never walk arbitrary scene textures: backgroundMap and source maps may be
  // borrowed. These two backgrounds and generator buffers are owned upstream.
  release(internal._colorBackground);
  release(internal._internalBackground);
  release(internal._generator?.geometry);
  const generator = internal._generator?.staticGeometryGenerator;
  generator?._intermediateGeometry?.forEach(release);
  generator?._intermediateGeometry?.clear();
  release(generator?._dummyMesh?.geometry);
  const dummyMaterials = generator?._dummyMesh?.material;
  (Array.isArray(dummyMaterials) ? dummyMaterials : [dummyMaterials]).forEach(release);
  release(internal._lowResPathTracer);
  tracer.dispose();
}

export class CityPathTracer {
  private backend?: PhotoBackend;
  private enabled = false;
  private disposed = false;
  private dirty = false;
  private building?: Promise<boolean>;
  private requestVersion = 0;
  private sceneVersion = 0;
  private quality: GraphicsQuality = 'balanced';
  private progress = 'Raytracing wird vorbereitet …';
  private error?: string;
  private previousShaderError: THREE.WebGLRenderer['debug']['onShaderError'];
  private cameraSignature = '';

  constructor(private renderer: THREE.WebGLRenderer, private source: THREE.Scene, private camera: THREE.Camera, private isNight: () => boolean) {
    this.previousShaderError = renderer.debug.onShaderError;
  }

  private configure(tracer = this.backend?.tracer) {
    if (!tracer) return;
    const settings = getPathTracingSettings(this.quality);
    tracer.bounces = settings.bounces;
    // three-gpu-pathtracer 0.0.24 allocates stratified random data with width
    // bounces + transmissiveBounces + 5, but its BSDF fetches columns up to 16.
    // Keep the complete 20 x 20 random texture, including shadow traversal.
    tracer.transmissiveBounces = settings.transmissiveBounces;
    tracer.renderScale = this.quality === 'ultra' ? 1 : this.quality === 'performance' ? 0.55 : 0.75;
    tracer.tiles.set(3, 3);
    tracer.minSamples = 1;
    tracer.renderDelay = 160;
    tracer.fadeDuration = 250;
    tracer.dynamicLowRes = false;
    tracer.filterGlossyFactor = 0.35;
    tracer.textureSize.set(256, 256);
  }

  setQuality(quality: GraphicsQuality) {
    this.quality = quality;
    this.configure();
    this.backend?.tracer.reset();
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (this.disposed) return false;
    const request = ++this.requestVersion;
    this.enabled = enabled;
    if (!enabled) {
      this.dirty = false;
      this.renderer.debug.onShaderError = this.previousShaderError;
      this.releaseActive();
      // A BVH worker owns transferred buffers until its promise settles. Its
      // candidate is released in rebuild.finally; Cancel never waits for it.
      return true;
    }
    this.error = undefined;
    const gl = this.renderer.getContext();
    if (gl.isContextLost() || !this.renderer.extensions.has('EXT_color_buffer_float') || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) {
      return this.fail('Raytracing benötigt WebGL 2 mit Float-Renderzielen. Die Stadt bleibt im Echtzeitmodus spielbar.');
    }
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      if (this.enabled) this.fail('Der Raytracing-Shader wird von diesem Grafiktreiber nicht unterstützt.');
      console.error('Raytracing shader:', context.getProgramInfoLog(program), context.getShaderInfoLog(fragment));
      this.previousShaderError?.(context, program, vertex, fragment);
    };
    this.dirty = true;
    // Re-entering while a canceled worker is finishing must serialize behind
    // its cleanup. No caller can reuse its generator or publish stale state.
    while (!this.disposed && this.enabled && request === this.requestVersion) {
      if (this.building) await this.building;
      else if (this.dirty) await this.rebuild();
      else return Boolean(this.backend);
    }
    return false;
  }

  invalidate() {
    this.sceneVersion++;
    if (this.enabled) this.dirty = true;
  }

  private fail(message: string) {
    this.error = message;
    this.enabled = false;
    this.dirty = false;
    this.requestVersion++;
    this.renderer.debug.onShaderError = this.previousShaderError;
    this.releaseActive();
    return false;
  }

  // A narrow private construction seam lets lifecycle tests run the actual
  // upstream scene generator without needing to mock an entire WebGL context.
  private async createBackend(isCanceled: () => boolean): Promise<PhotoBackend> {
    const [{ WebGLPathTracer: Tracer, DenoiseMaterial: Denoiser }, { GenerateMeshBVHWorker }] = await Promise.all([import('three-gpu-pathtracer'), import('three-mesh-bvh/worker')]);
    if (isCanceled()) throw new DOMException('Raytracing-Vorbereitung abgebrochen.', 'AbortError');
    const worker = new GenerateMeshBVHWorker() as InstanceType<typeof GenerateMeshBVHWorker> & Disposable;
    let tracer: PhotoTracer | undefined;
    let denoiseMaterial: DenoiseMaterial | undefined;
    let denoiseQuad: FullScreenQuad | undefined;
    try {
      tracer = new Tracer(this.renderer);
      tracer.enablePathTracing = false;
      tracer.setBVHWorker(worker);
      denoiseMaterial = new Denoiser({ sigma: 1.35, kSigma: 1.5, threshold: 0.12 });
      denoiseQuad = new FullScreenQuad(denoiseMaterial);
      const backend = { tracer, worker, denoiseMaterial, denoiseQuad };
      tracer.renderToCanvasCallback = (target, renderer, originalQuad) => {
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        try {
          // Filter only the displayed image; the progressive buffer retains
          // every original sample and regains finer detail as it converges.
          if (backend.tracer.samples >= 4 && originalQuad.material.opacity >= 1) {
            backend.denoiseMaterial.map = target.texture;
            const samples = backend.tracer.samples;
            backend.denoiseMaterial.sigma = 0.65 + 0.85 / Math.sqrt(samples / 12 + 1);
            backend.denoiseMaterial.threshold = 0.025 + 0.18 / Math.sqrt(samples / 8 + 1);
            backend.denoiseQuad.render(renderer);
          } else originalQuad.render(renderer);
        } finally { renderer.autoClear = autoClear; }
      };
      this.configure(tracer);
      return backend;
    } catch (error) {
      if (tracer) disposeTracer(tracer, this.renderer);
      worker.dispose();
      denoiseMaterial?.dispose();
      denoiseQuad?.dispose();
      throw error;
    }
  }

  private rebuild(): Promise<boolean> {
    if (this.building) return this.building;
    const request = this.requestVersion;
    const revision = this.sceneVersion;
    const isCanceled = () => this.disposed || !this.enabled || request !== this.requestVersion || revision !== this.sceneVersion;
    this.dirty = false;
    this.building = (async () => {
      let candidate: PhotoBackend | undefined;
      try {
        this.progress = 'Raytracing-Module werden geladen …';
        await yieldToBrowser();
        if (isCanceled()) return false;
        candidate = await this.createBackend(isCanceled);
        if (isCanceled()) return false;
        this.progress = 'Stadtgeometrie wird vorbereitet …';
        candidate.snapshot = await createPathTracingSnapshot(this.source, this.isNight(), isCanceled);
        if (isCanceled()) return false;
        this.progress = 'Beschleunigungsstruktur wird berechnet …';
        await candidate.tracer.setSceneAsync(candidate.snapshot.scene, this.camera, {
          onProgress: value => { if (!isCanceled()) this.progress = `Raytracing-Geometrie: ${Math.round(value * 100)} %`; },
        });
        if (isCanceled()) return false;
        // Build into a fresh backend. A rejected upstream generator retains a
        // rejected promise forever; it must never be retried. Atomic promotion
        // also keeps the last complete photo usable during scene rebuilding.
        this.configure(candidate.tracer);
        candidate.tracer.enablePathTracing = true;
        candidate.tracer.pausePathTracing = false;
        this.releaseActive();
        this.backend = candidate;
        candidate = undefined;
        this.cameraSignature = '';
        this.progress = 'Raytracing-Shader wird kompiliert …';
        return true;
      } catch (error) {
        if (isCanceled() || (error instanceof Error && error.name === 'AbortError')) return false;
        console.error('Raytracing initialization failed:', error);
        return this.fail(error instanceof Error ? `Raytracing konnte nicht gestartet werden: ${error.message}` : 'Raytracing konnte nicht gestartet werden.');
      } finally {
        // Only release after setSceneAsync settles: its worker may still own
        // buffers even when the user has already returned to realtime mode.
        if (candidate) this.releaseBackend(candidate);
        this.building = undefined;
      }
    })();
    return this.building;
  }

  /** Returns whether photo mode handled this frame. */
  render(): boolean {
    if (!this.enabled || this.disposed) return false;
    if (this.dirty && !this.building) void this.rebuild();
    const tracer = this.backend?.tracer;
    if (!tracer) return false;
    this.camera.updateMatrixWorld();
    const signature = [...this.camera.matrixWorld.elements, ...this.camera.projectionMatrix.elements].map(value => value.toFixed(5)).join(',');
    if (signature !== this.cameraSignature) {
      this.cameraSignature = signature;
      tracer.updateCamera();
      tracer.pausePathTracing = false;
    }
    const maximum = this.quality === 'ultra' ? 512 : this.quality === 'performance' ? 128 : 256;
    tracer.pausePathTracing = tracer.samples >= maximum;
    try {
      tracer.renderSample();
      return this.enabled;
    } catch (error) {
      console.error('Raytracing render failed:', error);
      this.fail('Raytracing wurde beendet, weil der Grafiktreiber den Renderdurchlauf nicht ausführen konnte.');
      return false;
    }
  }

  getStatus(): RenderStatus {
    if (!this.enabled) return { mode: 'realtime', samples: 0, status: this.error ? 'Raytracing nicht verfügbar' : 'Echtzeit', ...(this.error ? { error: this.error } : {}) };
    const tracer = this.backend?.tracer;
    if (!tracer || this.building || this.dirty) return { mode: 'raytracing', samples: tracer?.samples ?? 0, status: this.progress };
    const samples = tracer.samples;
    const status = tracer.isCompiling ? 'Raytracing-Shader wird kompiliert …' : samples < 1 ? 'Erste Lichtstrahlen werden berechnet …' : tracer.pausePathTracing ? 'Fotoberechnung abgeschlossen' : 'Indirektes Licht und Reflexionen verfeinern sich …';
    return { mode: 'raytracing', samples, status };
  }

  private releaseBackend(backend: PhotoBackend) {
    backend.tracer.enablePathTracing = false;
    disposeTracer(backend.tracer, this.renderer);
    backend.worker.dispose();
    backend.snapshot?.dispose();
    backend.denoiseMaterial.dispose();
    backend.denoiseQuad.dispose();
  }

  private releaseActive() {
    const backend = this.backend;
    this.backend = undefined;
    if (backend) this.releaseBackend(backend);
  }

  dispose() {
    this.disposed = true;
    this.enabled = false;
    this.dirty = false;
    this.requestVersion++;
    this.renderer.debug.onShaderError = this.previousShaderError;
    this.releaseActive();
  }
}
