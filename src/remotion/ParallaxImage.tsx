import { useLayoutEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const PARALLAX_PUSH_TOTAL = 0.055;
export const PARALLAX_LATERAL_TOTAL = 0.025;
export const PARALLAX_DEPTH_TOTAL = 0.035;
export const PARALLAX_COVER_SCALE = 1.08;

type Props = {
  assetRelPath: string;
  depthRelPath: string;
  sceneId: string;
  durationInFrames: number;
  onFallback: () => void;
};

type GlState = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  position: WebGLBuffer;
  imageTexture: WebGLTexture;
  depthTexture: WebGLTexture;
  offsetLocation: WebGLUniformLocation | null;
  imageAspectLocation: WebGLUniformLocation | null;
  canvasAspectLocation: WebGLUniformLocation | null;
  scaleLocation: WebGLUniformLocation | null;
  lateralLocation: WebGLUniformLocation | null;
  imageAspect: number;
};

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() { vUv = (aPosition + 1.0) * 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform float uOffset;
uniform float uImageAspect;
uniform float uCanvasAspect;
uniform float uScale;
uniform float uLateral;
varying vec2 vUv;
void main() {
  float fit = uImageAspect / uCanvasAspect;
  vec2 uv = vUv;
  if (fit > 1.0) uv.x = (uv.x - 0.5) / fit + 0.5;
  else uv.y = (uv.y - 0.5) * fit + 0.5;
  uv = (uv - 0.5) / uScale + 0.5;
  uv.x -= uLateral;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  float depth = texture2D(uDepth, uv).r - 0.5;
  vec2 shifted = clamp(uv + vec2(depth * uOffset, depth * uOffset * 0.28), 0.001, 0.999);
  gl_FragColor = texture2D(uImage, shifted);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader allocation failed.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL shader compilation failed.');
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL program allocation failed.');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program link failed.');
  return program;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load parallax texture: ${src}`));
    image.src = src;
  });
}

function makeTexture(gl: WebGLRenderingContext, image: HTMLImageElement): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('WebGL texture allocation failed.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return texture;
}

function draw(state: GlState, canvas: HTMLCanvasElement, frame: number, durationInFrames: number, sceneId: string): void {
  const { gl } = state;
  const phase = frame / Math.max(durationInFrames - 1, 1) - 0.5;
  let hash = 0;
  for (const character of sceneId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const direction = (hash & 1) === 0 ? 1 : -1;
  const offset = direction * PARALLAX_DEPTH_TOTAL * phase;
  const scale = PARALLAX_COVER_SCALE * (1 + PARALLAX_PUSH_TOTAL * (phase + 0.5));
  const lateral = direction * PARALLAX_LATERAL_TOTAL * phase;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.position);
  const positionLocation = gl.getAttribLocation(state.program, 'aPosition');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.imageTexture);
  gl.uniform1i(gl.getUniformLocation(state.program, 'uImage'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, state.depthTexture);
  gl.uniform1i(gl.getUniformLocation(state.program, 'uDepth'), 1);
  gl.uniform1f(state.offsetLocation, offset);
  gl.uniform1f(state.imageAspectLocation, state.imageAspect);
  gl.uniform1f(state.canvasAspectLocation, canvas.width / canvas.height);
  gl.uniform1f(state.scaleLocation, scale);
  gl.uniform1f(state.lateralLocation, lateral);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function ParallaxImage({ assetRelPath, depthRelPath, sceneId, durationInFrames, onFallback }: Props) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GlState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [handle] = useState(() => delayRender(`parallax textures ${sceneId}`));

  useLayoutEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return () => { cancelled = true; };
    void Promise.all([loadImage(staticFile(assetRelPath)), loadImage(staticFile(depthRelPath))]).then(([image, depth]) => {
      if (cancelled) return;
      try {
        const gl = canvas.getContext('webgl', { premultipliedAlpha: false });
        if (!gl) throw new Error('WebGL is unavailable.');
        const program = createProgram(gl);
        const position = gl.createBuffer();
        if (!position) throw new Error('WebGL vertex buffer allocation failed.');
        gl.bindBuffer(gl.ARRAY_BUFFER, position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        stateRef.current = {
          gl, program, position, imageTexture: makeTexture(gl, image), depthTexture: makeTexture(gl, depth),
          offsetLocation: gl.getUniformLocation(program, 'uOffset'),
          imageAspectLocation: gl.getUniformLocation(program, 'uImageAspect'),
          canvasAspectLocation: gl.getUniformLocation(program, 'uCanvasAspect'),
          scaleLocation: gl.getUniformLocation(program, 'uScale'),
          lateralLocation: gl.getUniformLocation(program, 'uLateral'),
          imageAspect: image.naturalWidth / Math.max(image.naturalHeight, 1),
        };
        setStatus('ready');
        continueRender(handle);
      } catch {
        stateRef.current = null;
        setStatus('fallback');
        onFallback();
        continueRender(handle);
      }
    }).catch((error: unknown) => {
      if (cancelled) return;
      stateRef.current = null;
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    });
    return () => { cancelled = true; };
  }, [assetRelPath, depthRelPath, handle, onFallback, sceneId]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state || status !== 'ready') return;
    draw(state, canvas, frame, durationInFrames, sceneId);
  }, [durationInFrames, frame, sceneId, status]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', height: '100%', objectFit: 'contain', visibility: status === 'ready' ? 'visible' : 'hidden' }} />;
}
