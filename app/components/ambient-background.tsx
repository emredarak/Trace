"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  gold: boolean;
}

const LINK_DIST = 120;
const MOUSE_DIST = 190;

/**
 * Subtle animated "investigation graph" behind the app: drifting nodes
 * linked by faint lines, with connections reaching toward the cursor.
 * Readability first: low alpha, pointer-events off, and a single static
 * frame for users who prefer reduced motion.
 */
export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const g: CanvasRenderingContext2D = ctx;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let particles: Particle[] = [];
    const mouse = { x: -9999, y: -9999 };

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvasEl.width = Math.floor(width * dpr);
      canvasEl.height = Math.floor(height * dpr);
      canvasEl.style.width = `${width}px`;
      canvasEl.style.height = `${height}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(
        28,
        Math.min(110, Math.floor((width * height) / 16000)),
      );
      particles = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 1 + Math.random() * 1.6,
        gold: i % 7 === 0,
      }));
      if (reduced) draw();
    }

    function draw() {
      g.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            g.strokeStyle = `rgba(130, 217, 154, ${0.11 * (1 - dist / LINK_DIST)})`;
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.stroke();
          }
        }

        const mdx = a.x - mouse.x;
        const mdy = a.y - mouse.y;
        const mDist = Math.hypot(mdx, mdy);
        if (mDist < MOUSE_DIST) {
          g.strokeStyle = a.gold
            ? `rgba(242, 179, 61, ${0.36 * (1 - mDist / MOUSE_DIST)})`
            : `rgba(130, 217, 154, ${0.3 * (1 - mDist / MOUSE_DIST)})`;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(mouse.x, mouse.y);
          g.stroke();
        }

        g.fillStyle = a.gold
          ? "rgba(242, 179, 61, 0.62)"
          : "rgba(160, 230, 180, 0.55)";
        g.beginPath();
        g.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        g.fill();
      }

      if (mouse.x > -100) {
        g.fillStyle = "rgba(242, 179, 61, 0.65)";
        g.beginPath();
        g.arc(mouse.x, mouse.y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    function step() {
      for (const p of particles) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1 && dist < MOUSE_DIST) {
          // Gentle pull toward the cursor; nearby nodes gather, then drift on.
          p.vx += (dx / dist) * 0.0035;
          p.vy += (dy / dist) * 0.0035;
        }
        p.vx = Math.max(-0.35, Math.min(0.35, p.vx));
        p.vy = Math.max(-0.35, Math.min(0.35, p.vy));
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    function onMove(e: PointerEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (reduced) draw();
    }
    function onLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
      if (reduced) draw();
    }
    function onVisibility() {
      if (reduced) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(step);
      }
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    if (!reduced) raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="ambient-canvas" aria-hidden="true" />;
}

export default AmbientBackground;
