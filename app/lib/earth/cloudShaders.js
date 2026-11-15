import { CLOUD_BOTTOM, CLOUD_TOP, CLOUD_STEPS, CLOUD_EXTINCTION } from './cloudVolume.js';

export const cloudVolumeVertex = /* glsl */ `
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const cloudVolumeFragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uNoiseSize;
  uniform float uAltitude;
  uniform float uTravel;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uResolution;
  in vec2 vUv;
  out vec4 cloudOutput;

  float noiseAt(vec3 p) { return texture(uNoise, (p + 0.5) / uNoiseSize).r; }
  float fbm(vec3 p) {
    return 0.57 * noiseAt(p) + 0.29 * noiseAt(p * 2.03 + 13.7) + 0.14 * noiseAt(p * 4.11 + 27.2);
  }
  float density(vec3 point) {
    vec3 p = point + vec3(uTime * 0.025, 0.0, uTime * 0.012);
    float shape = smoothstep(0.45, 0.72, fbm(p * 0.48) * 0.7 + fbm(p * 1.6) * 0.3);
    float core = 1.0 - smoothstep(0.65, 2.5, length(point.xz - vec2(0.0, 1.4)));
    float height = smoothstep(${CLOUD_BOTTOM.toFixed(2)}, ${(CLOUD_BOTTOM + .35).toFixed(2)}, point.y)
      * (1.0 - smoothstep(${(CLOUD_TOP - .65).toFixed(2)}, ${CLOUD_TOP.toFixed(2)}, point.y));
    return max(shape, core * 1.4) * height;
  }
  void main() {
    vec2 screen = vUv * 2.0 - 1.0;
    vec3 eye = vec3(0.0, uAltitude, uTravel);
    vec3 ray = normalize(vec3(screen.x * uAspect * 0.384, -1.0, screen.y * 0.384 + 0.22));
    float start = max(0.0, (uAltitude - ${CLOUD_TOP.toFixed(2)}) / -ray.y);
    float end = max(0.0, (uAltitude - ${CLOUD_BOTTOM.toFixed(2)}) / -ray.y);
    float stride = max(0.0, end - start) / float(${CLOUD_STEPS});
    float jitter = fract(sin(dot(floor(vUv * uResolution), vec2(12.9898, 78.233))) * 43758.5453);
    float transmission = 1.0;
    vec3 accumulated = vec3(0.0);
    vec3 sun = normalize(vec3(-0.6, 0.8, -0.2));
    float shadow = 1.0;
    for (int i = 0; i < ${CLOUD_STEPS}; i++) {
      vec3 p = eye + ray * (start + (float(i) + jitter) * stride);
      float d = density(p);
      if (d > 0.001) {
        if (i % 4 == 0) shadow = exp(-density(p + sun * 0.5) * 1.45);
        float heightLight = smoothstep(${CLOUD_BOTTOM.toFixed(2)}, ${CLOUD_TOP.toFixed(2)}, p.y);
        float light = clamp(0.24 + heightLight * 0.45 + shadow * 0.4, 0.0, 1.0);
        vec3 color = mix(vec3(0.42, 0.49, 0.57), vec3(0.98, 0.97, 0.94), light);
        float alpha = 1.0 - exp(-d * stride * ${CLOUD_EXTINCTION.toFixed(2)});
        accumulated += transmission * alpha * color;
        transmission *= 1.0 - alpha;
        if (transmission < 0.002) break;
      }
    }
    cloudOutput = vec4(accumulated, 1.0 - transmission);
  }
`;

export const cloudCompositeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const cloudCompositeFragment = /* glsl */ `
  uniform sampler2D uClouds;
  uniform sampler2D uGround;
  uniform float uAltitude;
  uniform float uTravel;
  uniform float uAspect;
  uniform float uExitView;
  varying vec2 vUv;
  void main() {
    vec2 screen = vUv * 2.0 - 1.0;
    vec3 ray = normalize(vec3(screen.x * uAspect * 0.384, -1.0, screen.y * 0.384 + 0.22));
    vec3 groundPoint = vec3(0.0, uAltitude, uTravel) + ray * (uAltitude / -ray.y);
    vec2 groundUv = groundPoint.xz / vec2(17.78, 10.0) + 0.5;
    if (uExitView > 0.5) {
      // Reframe the same photo while it is fully hidden inside the bank.
      // The exit reveals the sharp image instead of enlarging a tiny crop.
      groundUv = vUv - 0.5;
      if (uAspect > 1.7777778) groundUv.y *= 1.7777778 / uAspect;
      else groundUv.x *= uAspect / 1.7777778;
      groundUv += 0.5;
    }
    vec3 ground = texture2D(uGround, clamp(groundUv, 0.0, 1.0)).rgb;
    vec4 clouds = texture2D(uClouds, vUv);
    gl_FragColor = vec4(clouds.rgb + ground * (1.0 - clouds.a), 1.0);
    #include <colorspace_fragment>
  }
`;

export const cloudOverlayFragment = /* glsl */ `
  uniform sampler2D uClouds;
  uniform float uStrength;
  uniform float uOcclusion;
  varying vec2 vUv;
  void main() {
    vec4 clouds = texture2D(uClouds, vUv);
    vec3 color = clouds.rgb / max(clouds.a, 0.00001);
    float alpha = mix(clouds.a * uStrength, 1.0, uOcclusion);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
  }
`;
