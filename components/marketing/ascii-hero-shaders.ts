// WebGL shader sources and compilation utilities for the ASCII hero animation.
// Extracted from ascii-hero.tsx for module size compliance.

// Cap the offscreen backing store at 2x DPR. At 3x on a 4K display the
// per-frame texImage2D upload balloons to ~75MP; 2x keeps things crisp
// without turning the hero into a thermal event on high-density panels.
export const MAX_DPR = 2;

export const VERTEX_SRC = `#version 300 es
in vec4 aVertexPosition;
in vec2 aTextureCoord;
out vec2 vTextureCoord;
void main() {
  gl_Position = aVertexPosition;
  vTextureCoord = aTextureCoord;
}
`;

// Calm CRT: settles quickly into a steady barrel, tiny steady chroma shift,
// slow subtle scanlines. The motion should feel like looking at an old
// terminal, not a music video.
export const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;
uniform vec2 uResolution;
out vec4 fragColor;

float easeOutCubic(float t) { float u = 1.0 - t; return 1.0 - u * u * u; }

void main() {
  vec2 uv = vTextureCoord;

  float curvProgress = min(uTime / 1800.0, 1.0);
  float curv = easeOutCubic(curvProgress);

  vec2 cuv = uv * 2.0 - 1.0;
  cuv *= 1.0 + 0.05 * curv;
  cuv *= 1.0 - (0.045 * curv) + (0.025 * curv) * pow(abs(cuv.yx), vec2(2.0));
  cuv = cuv * 0.5 + 0.5;

  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  // Very small steady chroma shift — just a whisper of a CRT.
  float chroma = 0.0015;
  float r = texture(uSampler, vec2(cuv.x + chroma, cuv.y)).r;
  float g = texture(uSampler, cuv).g;
  float b = texture(uSampler, vec2(cuv.x - chroma, cuv.y)).b;
  vec4 tex = vec4(r, g, b, 1.0);

  // Slow, quiet scanlines.
  float scanline = max(0.0, sin((cuv.y + uTime * 0.0000003) * uResolution.y * 1.2)) * 0.35;
  tex.rgb = mix(tex.rgb, tex.rgb - vec3(scanline), 0.3);

  // Warm the red/blue channels a touch for a violet bias.
  tex.rgb *= vec3(1.02, 0.98, 1.06);

  // Soft vignette.
  float vign = 1.0 - length(cuv - 0.5) * 0.75;
  tex.rgb *= vign;

  // Brightness lift + soft-clip.
  tex.rgb *= 2.0;
  tex.rgb = 1.0 - exp(-tex.rgb);

  fragColor = tex;
}
`;

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("program link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}
