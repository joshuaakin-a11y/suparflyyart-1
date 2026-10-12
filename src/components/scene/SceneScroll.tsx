"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** Wait this long after the scene is revealed before the nudge, ms. */
const NUDGE_DELAY = 1100;
/** How far the nudge travels (px) and how long out and back take (ms). */
const NUDGE_PX = 64;
const NUDGE_OUT = 650;
const NUDGE_BACK = 900;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface SceneScrollProps {
  /** Where the view starts, as a fraction of the stage width (centred on this point). */
  startAt: number;
  /** How far the stage hangs off the left end, as a fraction of its width (matches globals.css). */
  overhang?: number;
}

/**
 * Phones only (when the scene scrolls sideways): starts the view centred on
 * the man, then — once the scene has been revealed — glides a little toward
 * the balloon and back, a quiet hint that the picture can be swiped. The nudge
 * is skipped if the visitor touches the screen first, and for reduced motion.
 * Renders nothing.
 */
export function SceneScroll({ startAt, overhang = 0.02 }: SceneScrollProps) {
  const markerRef = useRef<HTMLSpanElement>(null);

  // Position before the first paint under the light, so the view never jumps.
  useLayoutEffect(() => {
    const scene = markerRef.current?.parentElement;
    const stage = scene?.querySelector<HTMLElement>(".scene-stage");
    // The stage is wider than the scroll track; position by its own width.
    if (!scene || !stage || scene.scrollWidth <= scene.clientWidth) return;
    const w = stage.offsetWidth;
    scene.scrollLeft = Math.max(0, (startAt - overhang) * w - scene.clientWidth / 2);
  }, [startAt, overhang]);

  useEffect(() => {
    const scene = markerRef.current?.parentElement;
    if (!scene || scene.scrollWidth <= scene.clientWidth) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let touched = false;
    let raf = 0;
    let timer = 0;
    const stop = () => {
      touched = true;
      cancelAnimationFrame(raf);
    };
    const events = ["pointerdown", "touchstart", "wheel"] as const;
    events.forEach((e) => scene.addEventListener(e, stop, { passive: true }));

    const glide = (from: number, to: number, ms: number) =>
      new Promise<void>((done) => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (touched) return done();
          const p = Math.min(1, (now - t0) / ms);
          scene.scrollLeft = from + (to - from) * easeInOut(p);
          if (p < 1) raf = requestAnimationFrame(step);
          else done();
        };
        raf = requestAnimationFrame(step);
      });

    const nudge = async () => {
      if (touched) return;
      const start = scene.scrollLeft;
      await glide(start, start + NUDGE_PX, NUDGE_OUT);
      if (!touched) await glide(start + NUDGE_PX, start, NUDGE_BACK);
    };

    // Nudge once the light has lifted (SceneReveal sets data-ready on the scene).
    const schedule = () => (timer = window.setTimeout(nudge, NUDGE_DELAY));
    let observer: MutationObserver | undefined;
    if (scene.hasAttribute("data-ready")) schedule();
    else {
      observer = new MutationObserver(() => {
        if (scene.hasAttribute("data-ready")) {
          observer?.disconnect();
          schedule();
        }
      });
      observer.observe(scene, { attributes: true, attributeFilter: ["data-ready"] });
    }

    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      events.forEach((e) => scene.removeEventListener(e, stop));
    };
  }, []);

  return <span ref={markerRef} hidden />;
}
