"use client";
import { useEffect, useRef, useState } from "react";

import {
  compileShader,
  FRAGMENT_SRC,
  linkProgram,
  MAX_DPR,
  VERTEX_SRC,
} from "./ascii-hero-shaders";
import { drawAsciiFrame, STATIC_ALIEN } from "./ascii-hero-renderer";

export function AsciiHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Pre-GL-15 Safari, some Android WebViews, and WebGL-blocking privacy
  // browsers hit this path. A static gradient reads as "intentionally quiet"
  // rather than a broken hero.
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      setUnsupported(true);
      return;
    }

    const offscreen = document.createElement("canvas");
    const styles = getComputedStyle(canvas);
    const backgroundColor = styles
      .getPropertyValue("--ascii-hero-background")
      .trim();
    const foregroundColor = styles
      .getPropertyValue("--ascii-hero-foreground")
      .trim();
    if (!backgroundColor || !foregroundColor) {
      setUnsupported(true);
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) return;
    const program = linkProgram(gl, vs, fs);
    if (!program) return;

    const aVertexPosition = gl.getAttribLocation(program, "aVertexPosition");
    const aTextureCoord = gl.getAttribLocation(program, "aTextureCoord");
    const uSampler = gl.getUniformLocation(program, "uSampler");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uResolution = gl.getUniformLocation(program, "uResolution");

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]),
      gl.STATIC_DRAW
    );

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const motionQuery =
      typeof window !== "undefined"
        ? window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null
        : null;
    let reducedMotion = motionQuery?.matches ?? false;

    let startTime = 0;
    let rafId: number | null = null;

    const scheduleFrame = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      rafId = null;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (startTime === 0) startTime = now;
      const elapsed = reducedMotion ? 8000 : now - startTime;

      drawAsciiFrame(
        offscreen,
        dpr,
        rect.width,
        rect.height,
        elapsed,
        backgroundColor,
        foregroundColor
      );

      const pw = Math.max(1, Math.floor(rect.width * dpr));
      const ph = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;

      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        offscreen
      );

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.vertexAttribPointer(aVertexPosition, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(aVertexPosition);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.vertexAttribPointer(aTextureCoord, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(aTextureCoord);
      gl.uniform1i(uSampler, 0);
      gl.uniform1f(uTime, elapsed);
      gl.uniform2f(uResolution, pw, ph);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!reducedMotion) scheduleFrame();
    };
    scheduleFrame();

    // In reduced-motion mode we only draw once, so a layout change would
    // otherwise leave the hero stretched. Observe the canvas and re-render
    // on resize; the animated path already repaints every frame.
    const resizeObserver = new ResizeObserver(() => {
      if (reducedMotion) scheduleFrame();
    });
    resizeObserver.observe(canvas);

    // Respond to the user toggling their OS motion preference mid-session.
    const onMotionChange = (event: MediaQueryListEvent) => {
      const wasReduced = reducedMotion;
      reducedMotion = event.matches;
      if (wasReduced && !reducedMotion) {
        startTime = 0;
        scheduleFrame();
      } else if (!wasReduced && reducedMotion) {
        scheduleFrame();
      }
    };
    motionQuery?.addEventListener?.("change", onMotionChange);

    // WebGL contexts can be lost at any time (tab backgrounding, driver
    // crash, resource pressure). Without this, the rAF loop keeps burning
    // CPU on a dead pipeline where every gl call is a no-op.
    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    const onContextRestored = () => {
      // Shaders/buffers/textures were destroyed with the context. Rather
      // than rebuild inline, fall back to the static hero — rare enough
      // that the simpler code path is worth it.
      setUnsupported(true);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      motionQuery?.removeEventListener?.("change", onMotionChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      gl.deleteTexture(texture);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(uvBuf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  if (unsupported) {
    return (
      <div
        aria-label="Mogplex"
        role="img"
        className="ascii-hero ascii-hero-fallback relative h-full w-full overflow-hidden"
      >
        <div className="ascii-hero-fallback-mark absolute left-1/2 top-[18%] w-[min(86vw,900px)] -translate-x-1/2 text-center font-mono font-bold leading-none text-violet-200/40">
          <pre className="text-[clamp(13px,2.7vw,34px)] leading-[0.7]">
            {STATIC_ALIEN}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="Mogplex"
      role="img"
      className="ascii-hero"
      style={{ width: "100%", height: "100%", background: "transparent" }}
    />
  );
}
