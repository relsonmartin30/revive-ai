import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const DOT_COUNT = 30;
const MAX_DIST = 120;
const MAX_LINE_OPACITY = 0.08;
const DOT_OPACITY = 0.04;
const FPS = 30;

export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    let nodes: Node[] = [];
    let frame = 0;
    let last = 0;
    const interval = 1000 / FPS;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initNodes() {
      nodes = Array.from({ length: DOT_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() * 0.2 + 0.1) * (Math.random() > 0.5 ? 1 : -1),
        vy: (Math.random() * 0.2 + 0.1) * (Math.random() > 0.5 ? 1 : -1),
      }));
    }

    function drawLines() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * MAX_LINE_OPACITY;
            ctx!.strokeStyle = `rgba(16, 185, 129, ${alpha})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.stroke();
          }
        }
      }
    }

    function drawDots() {
      for (const n of nodes) {
        ctx!.fillStyle = `rgba(16, 185, 129, ${DOT_OPACITY})`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, 2, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function drawStatic() {
      ctx!.clearRect(0, 0, w, h);
      drawLines();
      drawDots();
    }

    function drawAnimated(now: number) {
      if (now - last < interval) {
        frame = requestAnimationFrame(drawAnimated);
        return;
      }
      last = now;

      ctx!.clearRect(0, 0, w, h);

      for (const n of nodes) {
        if (!reduced) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0) n.x = w;
          if (n.x > w) n.x = 0;
          if (n.y < 0) n.y = h;
          if (n.y > h) n.y = 0;
        }
      }

      drawLines();
      drawDots();

      frame = requestAnimationFrame(drawAnimated);
    }

    resize();
    initNodes();

    if (reduced) {
      drawStatic();
    } else {
      frame = requestAnimationFrame(drawAnimated);
    }

    const onResize = () => {
      resize();
      initNodes();
      if (reduced) drawStatic();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="ambient-canvas pointer-events-none fixed inset-0 z-0"
    />
  );
}
