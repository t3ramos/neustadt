import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const MAX_IMPACT_DEBRIS = 48;
export const IMPACT_DEBRIS_SECONDS = 12;
export const DISMEMBERMENT_SPEED = 5.5;
/** Vehicles use their actual sweep speed; 1 world unit represents ten metres. */
export const VEHICLE_DISMEMBERMENT_SPEED = 1.4;
const specs = {
  torso: { size: [0.16, 0.23, 0.115], mass: 3 },
  head: { size: [0.105, 0.125, 0.105], mass: 0.7 },
  leftArm: { size: [0.05, 0.215, 0.055], mass: 0.35 },
  rightArm: { size: [0.05, 0.215, 0.055], mass: 0.35 },
  leftLeg: { size: [0.063, 0.21, 0.075], mass: 0.65 },
  rightLeg: { size: [0.063, 0.21, 0.075], mass: 0.65 },
} as const;
type Part = keyof typeof specs;
type Vec = { x: number; y: number; z: number };
export interface ImpactDebrisSource {
  bodies: Record<Part, CANNON.Body>;
  scale: number;
  colors: {
    skin: THREE.ColorRepresentation;
    shirt: THREE.ColorRepresentation;
    pants: THREE.ColorRepresentation;
  };
  normal: Vec;
  speed: number;
  cause?: 'vehicle' | 'collision';
}
type Fragment = {
  body: CANNON.Body;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  wound: THREE.Mesh;
  age: number;
  active: boolean;
};
const finite = (v: Vec) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** Detached adult NPC parts: fixed pool, ground/building collisions, no person-person contacts. */
export class ImpactDebris {
  readonly group = new THREE.Group();
  private readonly geometry = new RoundedBoxGeometry(1, 1, 1, 1, 0.15);
  private readonly woundGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.035, 8);
  private readonly woundMaterial = new THREE.MeshStandardMaterial({
    color: 0x752b2a,
    roughness: 0.67,
  });
  private readonly pool: Fragment[] = [];
  private cursor = 0;
  private disposed = false;

  constructor(
    private readonly world: CANNON.World,
    parent: THREE.Group,
  ) {
    this.group.name = 'citizen-detached-body-parts';
    parent.add(this.group);
  }
  get activeCount(): number {
    return this.pool.reduce((n, f) => n + Number(f.active), 0);
  }
  get positions(): Vec[] {
    return this.pool.filter((f) => f.active).map((f) => f.body.position);
  }

  spawn(source: ImpactDebrisSource): boolean {
    if (
      this.disposed ||
      !Number.isFinite(source.speed) ||
      source.speed <
        (source.cause === 'vehicle' ? VEHICLE_DISMEMBERMENT_SPEED : DISMEMBERMENT_SPEED) ||
      !Number.isFinite(source.scale) ||
      source.scale <= 0 ||
      !finite(source.normal)
    )
      return false;
    const parts = Object.keys(specs) as Part[];
    if (
      parts.some((name) => {
        const b = source.bodies[name];
        return (
          !b ||
          !finite(b.position) ||
          !finite(b.velocity) ||
          !finite(b.angularVelocity) ||
          !finite(b.quaternion) ||
          !Number.isFinite(b.quaternion.w)
        );
      })
    )
      return false;
    // A symmetric separation impulse prevents disconnected parts remaining visually glued.
    // Subtract its mass-weighted mean so breakup itself adds no net linear momentum.
    const kicks = parts.map(
      (_, i) =>
        new CANNON.Vec3(
          Math.cos((i * Math.PI) / 3) * 0.25,
          i % 2 ? 0.12 : -0.12,
          Math.sin((i * Math.PI) / 3) * 0.25,
        ),
    );
    const mean = new CANNON.Vec3();
    let mass = 0;
    parts.forEach((part, i) => {
      mean.addScaledVector(specs[part].mass, kicks[i], mean);
      mass += specs[part].mass;
    });
    mean.scale(1 / mass, mean);
    parts.forEach((part, i) => {
      const spec = specs[part],
        original = source.bodies[part];
      const f = this.acquire();
      const size = spec.size.map((n) => n * source.scale);
      while (f.body.shapes.length) f.body.removeShape(f.body.shapes[0]);
      f.body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
      f.body.mass = spec.mass;
      f.body.updateMassProperties();
      f.body.position.copy(original.position);
      f.body.previousPosition.copy(original.position);
      f.body.interpolatedPosition.copy(original.position);
      f.body.quaternion.copy(original.quaternion);
      f.body.previousQuaternion.copy(original.quaternion);
      f.body.interpolatedQuaternion.copy(original.quaternion);
      kicks[i].vsub(mean, kicks[i]);
      original.velocity.vadd(kicks[i], f.body.velocity);
      f.body.angularVelocity.set(
        Math.max(-16, Math.min(16, original.angularVelocity.x + (i % 2 ? 5 : -5))),
        Math.max(-16, Math.min(16, original.angularVelocity.y + 3)),
        Math.max(-16, Math.min(16, original.angularVelocity.z + (i % 2 ? -4 : 4))),
      );
      f.body.force.setZero();
      f.body.torque.setZero();
      f.body.aabbNeedsUpdate = true;
      f.mesh.scale.set(size[0], size[1], size[2]);
      f.mesh.material.color.set(
        part === 'head'
          ? source.colors.skin
          : part.includes('Leg')
            ? source.colors.pants
            : source.colors.shirt,
      );
      f.mesh.material.opacity = 1;
      f.wound.visible = part !== 'torso';
      f.wound.position.y = part === 'head' ? -0.5 : 0.5;
      f.mesh.name = `detached-${part}`;
      f.age = 0;
      f.active = true;
      f.mesh.visible = true;
      f.body.wakeUp();
      this.world.addBody(f.body);
      this.sync(f);
    });
    return true;
  }
  private acquire(): Fragment {
    if (this.pool.length < MAX_IMPACT_DEBRIS) {
      const mesh = new THREE.Mesh(
        this.geometry,
        new THREE.MeshStandardMaterial({ roughness: 0.8, transparent: true }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const wound = new THREE.Mesh(this.woundGeometry, this.woundMaterial);
      mesh.add(wound);
      this.group.add(mesh);
      const f: Fragment = {
        mesh,
        wound,
        age: 0,
        active: false,
        body: new CANNON.Body({
          mass: 1,
          collisionFilterGroup: 2,
          collisionFilterMask: 5,
          linearDamping: 0.2,
          angularDamping: 0.35,
          allowSleep: true,
          sleepSpeedLimit: 0.08,
          sleepTimeLimit: 0.6,
        }),
      };
      this.pool.push(f);
      return f;
    }
    const f = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_IMPACT_DEBRIS;
    this.retire(f);
    return f;
  }
  private retire(f: Fragment): void {
    if (f.active) this.world.removeBody(f.body);
    f.active = false;
    f.mesh.visible = false;
  }
  private sync(f: Fragment): void {
    f.mesh.position.copy(f.body.position);
    f.mesh.quaternion.copy(f.body.quaternion);
  }
  /** Call after the shared physics step; dt=0 keeps pause state unchanged. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (const f of this.pool) {
      if (!f.active) continue;
      f.age += dt;
      if (
        f.age >= IMPACT_DEBRIS_SECONDS ||
        !finite(f.body.position) ||
        !finite(f.body.velocity) ||
        !finite(f.body.quaternion) ||
        !Number.isFinite(f.body.quaternion.w) ||
        f.body.position.y < -128
      ) {
        this.retire(f);
        continue;
      }
      this.sync(f);
      f.mesh.material.opacity = Math.min(1, (IMPACT_DEBRIS_SECONDS - f.age) / 1.5);
    }
  }
  clear(): void {
    for (const f of this.pool) this.retire(f);
    this.cursor = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const f of this.pool) f.mesh.material.dispose();
    this.geometry.dispose();
    this.woundGeometry.dispose();
    this.woundMaterial.dispose();
    this.group.removeFromParent();
    this.pool.length = 0;
  }
}
