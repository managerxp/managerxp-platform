import React, { useEffect, useRef } from 'react';

/**
 * Shared racing-particle canvas background used across homepage sections.
 * Pauses rendering when off-screen or when the user prefers reduced motion,
 * so multiple instances on one page stay cheap.
 */
// `w-full h-full` is required, not decorative: a canvas is a replaced element,
// so with `width: auto` it keeps its intrinsic 300x150 instead of stretching to
// the `inset-0` box, and the backing store would then be sized from that.
const ParticleBackground = ({ className = 'absolute inset-0 w-full h-full z-[1] opacity-60' }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) return;

    let animationFrameId;
    let particles = [];

    const resizeCanvas = () => {
      const { width, height } = canvas.getBoundingClientRect();
      // Fall back to the viewport if the element has not been laid out yet.
      canvas.width = Math.max(1, Math.round(width) || window.innerWidth);
      canvas.height = Math.max(1, Math.round(height) || window.innerHeight);
    };

    const initParticles = () => {
      particles = Array.from({ length: 40 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: Math.random() * 8 + 2,
        length: Math.random() * 80 + 20,
        color: `rgba(${Math.random() > 0.8 ? '239, 68, 68' : '255, 255, 255'}, ${Math.random() * 0.3 + 0.1})`,
        type: Math.random() > 0.8 ? 'code' : 'line'
      }));
    };

    const handleResize = () => {
      resizeCanvas();
      initParticles();
    };

    window.addEventListener('resize', handleResize);

    // Section heights are content-driven, so watch the element itself too.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    resizeObserver?.observe(canvas);

    resizeCanvas();
    initParticles();

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        ctx.beginPath();

        if (p.type === 'code') {
          ctx.font = '12px monospace';
          ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.fillText('{ }', p.x, p.y);
        } else {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.length, p.y);
          ctx.stroke();
        }

        p.x += p.speed;

        if (p.x > canvas.width) {
          p.x = -p.length;
          p.y = Math.random() * canvas.height;
        }
      });

      animationFrameId = window.requestAnimationFrame(render);
    };

    // Several of these can exist on one page, so an off-screen instance stops
    // its loop entirely rather than idling on requestAnimationFrame.
    const start = () => {
      if (animationFrameId) return;
      render();
    };

    const stop = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = undefined;
    };

    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 }
    );
    observer.observe(canvas);

    return () => {
      stop();
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} />;
};

export default ParticleBackground;
