export const globeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const earthFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uLandMask;
  uniform float uGraphic;
  uniform vec3 uAtlasLand;
  uniform vec3 uAtlasOcean;
  uniform float uOpacity;
  uniform float uIntroProgress;
  uniform float uIntroLights;
  uniform float uIntroSurface;
  uniform vec3 uSunDirection;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float cityHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float citySeed(vec2 uv, vec2 center, float start) {
    vec2 delta = (uv - center) * vec2(1.75, 1.0);
    float cluster = 1.0 - smoothstep(0.002, 0.006, length(delta));
    return cluster * smoothstep(start, start + 0.055, uIntroLights);
  }
  float cityReveal(vec2 uv) {
    // Early lights are actual Delhi, Mumbai and Bangkok pixels in the NASA
    // texture. The rest of the network joins in staggered geographic cells.
    float seed = max(citySeed(uv, vec2(0.71444, 0.65889), 0.055),
                     citySeed(uv, vec2(0.70250, 0.60611), 0.130));
    seed = max(seed, citySeed(uv, vec2(0.77917, 0.57639), 0.195));
    float start = 0.26 + cityHash(floor(uv * vec2(720.0, 360.0))) * 0.27;
    float network = smoothstep(start, start + 0.055, uIntroLights);
    return mix(max(seed, network), 1.0, smoothstep(0.54, 0.62, uIntroLights));
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float sunAngle = dot(normal, uSunDirection);
    float daylight = smoothstep(-0.08, 0.18, sunAngle);
    vec3 surface = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;

    // Keep the night-side terrain quiet; only bright city-light pixels survive.
    float lightLuminance = dot(night, vec3(0.2126, 0.7152, 0.0722));
    float lit = cityReveal(vUv);
    vec3 warmth = mix(vec3(1.0, 0.76, 0.44), vec3(1.0), smoothstep(0.48, 0.88, uIntroProgress));
    vec3 lights = night * smoothstep(0.14, 0.48, lightLuminance) * 1.15 * lit * warmth;
    // A restrained local halo around real lights; no extra stars or invented
    // city positions are added to the surface.
    vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0) * 1.7;
    vec3 nearby = (texture2D(uNight, vUv + vec2(texel.x, 0.0)).rgb
                + texture2D(uNight, vUv - vec2(texel.x, 0.0)).rgb
                + texture2D(uNight, vUv + vec2(0.0, texel.y)).rgb
                + texture2D(uNight, vUv - vec2(0.0, texel.y)).rgb) * 0.25;
    float halo = smoothstep(0.08, 0.55, dot(nearby, vec3(0.2126, 0.7152, 0.0722)));
    lights += vec3(1.0, 0.64, 0.26) * halo * lit * 0.32 * (1.0 - smoothstep(0.60, 1.0, uIntroProgress));
    vec3 dayColor = surface * (max(sunAngle, 0.0) * 1.65 + 0.055);
    vec3 nightColor = surface * 0.012 * uIntroSurface + lights;

    float ocean = smoothstep(0.02, 0.1, surface.b - surface.r)
                * (1.0 - smoothstep(0.08, 0.25, surface.r));
    vec3 halfDirection = normalize(uSunDirection + viewDirection);
    float reflection = pow(max(dot(normal, halfDirection), 0.0), 95.0);
    dayColor += vec3(0.72, 0.83, 1.0) * reflection * ocean * 0.5;
    dayColor *= uIntroSurface;

    float horizon = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.0);
    vec3 color = mix(nightColor, dayColor, daylight);
    color += vec3(0.035, 0.17, 0.42) * horizon * max(sunAngle + 0.2, 0.0) * 0.45 * uIntroSurface;
    gl_FragColor = vec4(color, uOpacity);
    #include <tonemapping_fragment>
    // Blend after photographic tone mapping so the atlas uses the same
    // restrained linear palette as the unlit administrative-region map.
    float land = texture2D(uLandMask, vUv).r;
    vec3 atlas = mix(uAtlasOcean, uAtlasLand, land);
    atlas *= 0.84 + 0.16 * max(dot(normal, uSunDirection), 0.0);
    vec2 grid = abs(fract(vUv * vec2(24.0, 12.0) - 0.5) - 0.5);
    vec2 gridWidth = max(fwidth(vUv * vec2(24.0, 12.0)), vec2(0.00001));
    float meridians = 1.0 - smoothstep(0.35, 1.0, min(grid.x / gridWidth.x, grid.y / gridWidth.y));
    atlas = mix(atlas, vec3(0.38, 0.49, 0.50), meridians * 0.12);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, atlas, uGraphic);
    #include <colorspace_fragment>
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uOpacity;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float light = smoothstep(-0.35, 0.8, dot(normal, uSunDirection));
    float thickness = pow(abs(dot(normal, viewDirection)), 0.6);
    float alpha = thickness * (0.015 + light * 0.66);
    gl_FragColor = vec4(vec3(0.09, 0.34, 0.88), alpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
