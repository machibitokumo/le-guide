"use client";
import { useEffect, useRef } from "react";

const S = 120;          // canvas size
const P = 4;            // pixel block size
const CX = S / 2;
const CY = S / 2;
const R = 34;           // orbit radius
const DROPS = 8;
const TRAIL = 7;
const SPEED = 2.4;      // rad/s

// Checkmark pixel offsets (in P-units from center)
const CHECK: [number, number][] = [
  [-5, 1], [-4, 2], [-3, 3],
  [-2, 4], [-1, 3], [0, 2], [1, 1], [2, 0], [3, -1], [4, -2], [5, -3],
];

export default function PixelLoader({
  done = false,
  onExplodeDone,
}: {
  done?: boolean;
  onExplodeDone?: () => void;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const doneRef    = useRef(done);
  const doneAt     = useRef<number | null>(null);
  const explodeAt  = useRef<number | null>(null);
  const particles  = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);
  const fired      = useRef(false);

  // Sync done flag
  useEffect(() => {
    if (done && !doneRef.current) doneAt.current = performance.now();
    doneRef.current = done;
  }, [done]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    let raf: number;

    const dot = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), P, P);
    };

    const render = (now: number) => {
      ctx.clearRect(0, 0, S, S);

      /* ── LOADING ── */
      if (!doneRef.current || doneAt.current === null) {
        const t = now / 1000;
        for (let d = 0; d < DROPS; d++) {
          const base = (d / DROPS) * Math.PI * 2 + t * SPEED;
          for (let i = 0; i < TRAIL; i++) {
            const a = base - i * 0.13;
            const x = CX + Math.cos(a) * R - P / 2;
            const y = CY + Math.sin(a) * R - P / 2;
            const alpha = (1 - i / TRAIL) * 0.95;
            dot(x, y, i === 0
              ? `rgba(210,225,255,${alpha})`
              : `rgba(110,140,220,${alpha * 0.65})`
            );
          }
        }
        raf = requestAnimationFrame(render);
        return;
      }

      const elapsed = now - doneAt.current;

      /* ── ASSEMBLE CHECKMARK ── */
      if (elapsed < 380) {
        const visible = Math.ceil((elapsed / 280) * CHECK.length);
        for (let i = 0; i < Math.min(visible, CHECK.length); i++) {
          const [cx, cy] = CHECK[i];
          dot(CX + cx * P - P / 2, CY + cy * P - P / 2, "#4ade80");
        }
        raf = requestAnimationFrame(render);
        return;
      }

      /* ── HOLD CHECKMARK briefly ── */
      if (elapsed < 500) {
        for (const [cx, cy] of CHECK)
          dot(CX + cx * P - P / 2, CY + cy * P - P / 2, "#4ade80");
        raf = requestAnimationFrame(render);
        return;
      }

      /* ── EXPLODE ── */
      if (explodeAt.current === null) {
        explodeAt.current = now;
        particles.current = CHECK.map(([cx, cy]) => {
          const sx = CX + cx * P - P / 2;
          const sy = CY + cy * P - P / 2;
          const angle = Math.atan2(cy, cx) + (Math.random() - 0.5) * 1.4;
          const spd = 1.8 + Math.random() * 3.5;
          return { x: sx, y: sy, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd };
        });
      }

      const et = (now - explodeAt.current) / 16.67;
      const alpha = Math.max(0, 1 - et / 28);

      if (alpha <= 0) {
        if (!fired.current) { fired.current = true; onExplodeDone?.(); }
        return; // stop loop
      }

      for (const p of particles.current) {
        const x = p.x + p.vx * et;
        const y = p.y + p.vy * et + 0.07 * et * et;
        dot(x, y, `rgba(74,222,128,${alpha})`);
      }

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [onExplodeDone]);

  return (
    <canvas
      ref={canvasRef}
      width={S}
      height={S}
      style={{ imageRendering: "pixelated", width: S, height: S }}
    />
  );
}
