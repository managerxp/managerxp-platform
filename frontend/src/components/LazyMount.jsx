import React, { useEffect, useRef, useState } from 'react';

/**
 * Renders children only once the placeholder gets close to the viewport.
 *
 * Used to keep heavier sections — and the code they import — out of the initial
 * payload until a visitor actually scrolls toward them.
 */
const LazyMount = ({ children, minHeight = '24rem', rootMargin = '400px' }) => {
  const ref = useRef(null);
  // Without an observer there is nothing to wait for, so render immediately.
  const [show, setShow] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (show) return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShow(true);
      },
      { rootMargin }
    );
    observer.observe(node);

    // Fail-safe: never leave a section permanently unmounted if the observer
    // stays silent (frozen or prerendered tab).
    const fallback = setTimeout(() => setShow(true), 2500);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [show, rootMargin]);

  if (show) return children;

  return (
    <div ref={ref} style={{ minHeight }} className="flex items-center justify-center" aria-busy="true">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-800 border-t-red-500" />
    </div>
  );
};

export default LazyMount;
