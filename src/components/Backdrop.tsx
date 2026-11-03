'use client';

import { useEffect, useRef } from 'react';

interface Shard { x: number; y: number; length: number; speed: number; width: number; alpha: number; accent: boolean; phase: number }

const ANGLE = -0.6;
const COS = Math.cos(ANGLE);
const SIN = Math.sin(ANGLE);

/**
 * Faint drifting shards behind the library. Only thin lines are drawn per frame (the glow is static CSS),
 * the canvas runs at a capped pixel ratio, and it stops entirely when unmounted, hidden, or reduced-motion is on.
 */
export default function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();
    let shards: Shard[] = [];

    const respawn = (shard: Shard) => {
      if (Math.random() < 0.55) { shard.x = Math.random() * width; shard.y = height + 20 + Math.random() * 80; }
      else { shard.x = -20 - Math.random() * 80 - shard.length * COS; shard.y = Math.random() * height; }
    };

    const draw = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      pointer.x += (pointer.targetX - pointer.x) * Math.min(1, delta * 3);
      pointer.y += (pointer.targetY - pointer.y) * Math.min(1, delta * 3);
      context.clearRect(0, 0, width, height);
      context.lineCap = 'round';
      const parallaxX = (pointer.x - 0.5) * 16;
      const parallaxY = (pointer.y - 0.5) * 10;
      for (const shard of shards) {
        if (!reduceMotion) {
          shard.x += COS * shard.speed * delta;
          shard.y += SIN * shard.speed * delta;
          shard.phase += delta * 0.45;
          if (shard.x > width + 40 || shard.y < -40) respawn(shard);
        }
        const offsetX = parallaxX * shard.width;
        const offsetY = parallaxY * shard.width + Math.sin(shard.phase) * 3;
        context.strokeStyle = shard.accent ? `rgba(224, 68, 78, ${shard.alpha * 1.6})` : `rgba(255, 240, 240, ${shard.alpha})`;
        context.lineWidth = shard.width;
        context.beginPath();
        context.moveTo(shard.x + offsetX, shard.y + offsetY);
        context.lineTo(shard.x + offsetX + COS * shard.length, shard.y + offsetY + SIN * shard.length);
        context.stroke();
      }
      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round(Math.min(32, Math.max(14, (width * height) / 45000)));
      shards = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        length: 50 + Math.random() * 160,
        speed: 4 + Math.random() * 11,
        width: index % 9 === 0 ? 1.3 : 0.6 + Math.random() * 0.5,
        alpha: 0.025 + Math.random() * 0.08,
        accent: index % 9 === 0,
        phase: Math.random() * Math.PI * 2,
      }));
      if (reduceMotion) draw(performance.now());
    };

    const move = (event: PointerEvent) => {
      pointer.targetX = event.clientX / Math.max(window.innerWidth, 1);
      pointer.targetY = event.clientY / Math.max(window.innerHeight, 1);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', move, { passive: true });
    if (!reduceMotion) frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  return <canvas ref={ref} className="backdrop" aria-hidden="true" />;
}
