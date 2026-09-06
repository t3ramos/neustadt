import * as THREE from 'three';

export interface StreetlightSource {
  id: number;
  bulb: THREE.Vector3;
}
const RANGE = 1.85;
const LIGHTS_PER_CELL = 4;
interface FieldUniforms {
  cityLightIndex: { value: THREE.DataTexture };
  cityLightData: { value: THREE.DataTexture };
  cityLightSize: { value: number };
  cityLightCount: { value: number };
  cityLightStrength: { value: number };
  cityLightColor: { value: THREE.Color };
}
type StandardMaterial = THREE.MeshStandardMaterial;
const bindings = new WeakMap<
  StandardMaterial,
  { uniforms: FieldUniforms; original: StandardMaterial['onBeforeCompile']; cacheKey: string }
>();

function texture(data: Float32Array, width: number, height: number): THREE.DataTexture {
  const value = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  value.minFilter = value.magFilter = THREE.NearestFilter;
  value.generateMipmaps = false;
  value.needsUpdate = true;
  return value;
}

/**
 * World-fixed tiled lighting. Every supplied streetlamp contributes regardless of
 * the camera. Four nearby sources per surface tile keep fragment cost constant
 * rather than selecting a handful of real lights around the camera's target.
 */
export function createStreetlightField(size: number) {
  const uniforms: FieldUniforms = {
    cityLightIndex: { value: texture(new Float32Array(size * size * 4), size, size) },
    cityLightData: { value: texture(new Float32Array(4), 1, 1) },
    cityLightSize: { value: size },
    cityLightCount: { value: 1 },
    cityLightStrength: { value: 0 },
    cityLightColor: { value: new THREE.Color(0xffdfa2) },
  };
  let sourceCount = 0,
    revision = 0;
  function update(sources: readonly StreetlightSource[]) {
    sourceCount = sources.length;
    revision++;
    const width = Math.max(1, sources.length),
      data = new Float32Array(width * 4);
    const cells = Array.from(
      { length: size * size },
      () => [] as { index: number; distance: number }[],
    );
    const half = size / 2;
    sources.forEach((source, index) => {
      const p = source.bulb;
      data.set([p.x, p.y - 0.022, p.z, 0.55], index * 4);
      const gx = p.x + half,
        gz = p.z + half;
      for (
        let z = Math.max(0, Math.floor(gz - RANGE));
        z <= Math.min(size - 1, Math.floor(gz + RANGE));
        z++
      ) {
        for (
          let x = Math.max(0, Math.floor(gx - RANGE));
          x <= Math.min(size - 1, Math.floor(gx + RANGE));
          x++
        ) {
          const candidates = cells[z * size + x];
          candidates.push({
            index: index + 1,
            distance: (x + 0.5 - gx) ** 2 + (z + 0.5 - gz) ** 2,
          });
        }
      }
    });
    const indices = new Float32Array(size * size * 4);
    cells.forEach((candidates, cell) => {
      candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
      candidates
        .slice(0, LIGHTS_PER_CELL)
        .forEach((candidate, i) => (indices[cell * 4 + i] = candidate.index));
    });
    uniforms.cityLightIndex.value.image.data!.set(indices);
    uniforms.cityLightIndex.value.needsUpdate = true;
    if (uniforms.cityLightData.value.image.width !== width) {
      uniforms.cityLightData.value.dispose();
      uniforms.cityLightData.value = texture(data, width, 1);
    } else {
      uniforms.cityLightData.value.image.data!.set(data);
      uniforms.cityLightData.value.needsUpdate = true;
    }
    uniforms.cityLightCount.value = width;
  }
  function applyTo(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.ambientOcclusionExclude) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (
          !(material instanceof THREE.MeshStandardMaterial) ||
          material.userData.cityLightFieldExclude
        )
          continue;
        const existing = bindings.get(material);
        if (existing?.uniforms === uniforms) continue;
        const binding = existing ?? {
          uniforms,
          original: material.onBeforeCompile,
          cacheKey: material.customProgramCacheKey(),
        };
        binding.uniforms = uniforms;
        bindings.set(material, binding);
        material.onBeforeCompile = function (shader, renderer) {
          binding.original.call(this, shader, renderer);
          Object.assign(shader.uniforms, binding.uniforms);
          shader.vertexShader = 'varying vec3 vCityLightPosition;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            vec4 cityWorldPosition=vec4(transformed,1.0);
            #ifdef USE_BATCHING
              cityWorldPosition=batchingMatrix*cityWorldPosition;
            #endif
            #ifdef USE_INSTANCING
              cityWorldPosition=instanceMatrix*cityWorldPosition;
            #endif
            vCityLightPosition=(modelMatrix*cityWorldPosition).xyz;
          `,
          );
          shader.fragmentShader =
            `
            varying vec3 vCityLightPosition;
            uniform sampler2D cityLightIndex;
            uniform sampler2D cityLightData;
            uniform float cityLightSize;
            uniform float cityLightCount;
            uniform float cityLightStrength;
            uniform vec3 cityLightColor;
          ` + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
            if(cityLightStrength>0.0){
              vec2 cityCell=floor(vCityLightPosition.xz+vec2(cityLightSize*.5));
              if(all(greaterThanEqual(cityCell,vec2(0.0)))&&all(lessThan(cityCell,vec2(cityLightSize)))){
                vec4 cityCandidates=texture2D(cityLightIndex,(cityCell+.5)/cityLightSize);
                vec3 cityNormal=inverseTransformDirection(normal,viewMatrix);
                for(int citySlot=0;citySlot<4;citySlot++){
                  float cityIndex=cityCandidates[citySlot];
                  if(cityIndex>0.0){
                    vec4 cityLamp=texture2D(cityLightData,vec2((cityIndex-.5)/cityLightCount,.5));
                    vec3 cityDelta=cityLamp.xyz-vCityLightPosition;
                    float cityDistance=length(cityDelta);
                    float cityFalloff=pow(clamp(1.0-pow(cityDistance/1.85,4.0),0.0,1.0),2.0)/max(cityDistance*cityDistance,.01);
                    float cityCosine=max(dot(cityNormal,cityDelta/max(cityDistance,.001)),0.0);
                    reflectedLight.directDiffuse+=diffuseColor.rgb*cityLightColor*(cityLamp.w*cityLightStrength*cityFalloff*cityCosine/3.14159265);
                  }
                }
              }
            }
          `,
          );
        };
        material.customProgramCacheKey = () => `${binding.cacheKey}:city-tiled-light-v1`;
        material.needsUpdate = true;
      }
    });
  }
  return {
    update,
    applyTo,
    setStrength(value: number) {
      uniforms.cityLightStrength.value = Number.isFinite(value) ? Math.max(0, value) : 0;
    },
    getDebug: () => ({
      sources: sourceCount,
      candidatesPerCell: LIGHTS_PER_CELL,
      revision,
      strength: uniforms.cityLightStrength.value,
    }),
    /** Stable lookup is also useful to inspect which lamps can illuminate a tile. */
    sourcesAt(x: number, z: number): number[] {
      const gx = Math.floor(x + size / 2),
        gz = Math.floor(z + size / 2);
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) return [];
      return Array.from(
        uniforms.cityLightIndex.value.image.data!.slice(
          (gz * size + gx) * 4,
          (gz * size + gx + 1) * 4,
        ),
      )
        .filter((i) => i > 0)
        .map((i) => i - 1);
    },
    dispose() {
      uniforms.cityLightStrength.value = 0;
      uniforms.cityLightIndex.value.dispose();
      uniforms.cityLightData.value.dispose();
    },
  };
}
