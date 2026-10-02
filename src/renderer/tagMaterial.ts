import * as THREE from "three";

// Fragments this far above the base's top face count as raised, so the
// top face itself never flickers between colors due to float precision.
const HEIGHT_EPSILON = 0.01;

/**
 * A plastic-looking standard material whose base color is chosen per
 * fragment: `baseColor` at or below the plate's top face, `reliefColor`
 * above it. Lighting is left entirely to MeshStandardMaterial; we only
 * replace the diffuse color it starts from.
 */
export function createTagMaterial() {
  const uniforms = {
    uBaseColor: { value: new THREE.Color() },
    uReliefColor: { value: new THREE.Color() },
    uBaseHeight: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    metalness: 0,
    roughness: 0.45,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // Pass the object-space height through to the fragment shader. The
    // model is built Y-up with the plate's bottom at y = 0.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vHeight;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvHeight = position.y;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uBaseColor;
uniform vec3 uReliefColor;
uniform float uBaseHeight;
varying float vHeight;`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `vec3 tagColor = vHeight > uBaseHeight + ${HEIGHT_EPSILON.toFixed(3)}
  ? uReliefColor
  : uBaseColor;
vec4 diffuseColor = vec4( tagColor, opacity );`,
      );
  };

  return {
    material,
    setColors(base: string, relief: string) {
      uniforms.uBaseColor.value.set(base);
      uniforms.uReliefColor.value.set(relief);
    },
    setBaseHeight(height: number) {
      uniforms.uBaseHeight.value = height;
    },
  };
}
