"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

/** Seconds per cycle of the camera's idle drift, sideways and up/down (out of step on purpose). */
const DRIFT_X_S = 17;
const DRIFT_Y_S = 11.5;
/** How far the idle drift travels (−1…1 is the camera's full range). */
const DRIFT_X = 0.55;
const DRIFT_Y = 0.3;
/** How quickly the camera catches up with its target, per second (higher = snappier). */
const FOLLOW = 2.6;
/**
 * On phones the scene scrolls sideways. Swiping also moves the camera (up to
 * this much of its −1…1 range from one end to the other) so the planes slide
 * past each other as you swipe — near ones faster than far ones. The idle
 * drift is smaller there so the two together stay inside the stage's spare
 * edge (see .scene-stage in globals.css).
 */
const SCROLL_DEPTH = 0.75;
const SCROLL_DRIFT = 0.35;
/** Never let the camera go further than this, so no plane shows an edge. */
const MAX_TRAVEL = 1.15;

/**
 * The scene's camera. It drifts slowly on its own (so the depth reads even on a
 * phone, with no pointer), and on devices with a mouse it leans toward the
 * pointer. On phones, where the scene scrolls sideways, the swipe position
 * also drives the camera, so the planes slide past each other as you swipe.
 * Each frame it writes the camera position (−1…1) to --cx / --cy on
 * the enclosing scene; the CSS turns that into a different offset for each
 * depth plane — far sky barely moves, the plaza shears in perspective, the man
 * moves with the ground he stands on. Renders nothing; off for reduced motion.
 */
export function SceneCamera() {
  const markerRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const scene = markerRef.current?.parentElement;
    if (!scene || reducedMotion) return;

    const hasPointer = window.matchMedia("(hover: hover)").matches;
    let pointer: { x: number; y: number } | null = null;
    let x = 0;
    let y = 0;
    let last = performance.now();
    let raf = 0;
    let visible = true;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const driftX = DRIFT_X * Math.sin((t * 2 * Math.PI) / DRIFT_X_S);
      const driftY = DRIFT_Y * Math.sin((t * 2 * Math.PI) / DRIFT_Y_S);
      // The pointer leads; a little drift stays underneath so the scene never freezes.
      const tx = pointer ? pointer.x * 0.85 + driftX * 0.25 : driftX;
      const ty = pointer ? pointer.y * 0.85 + driftY * 0.25 : driftY;
      const k = 1 - Math.exp(-FOLLOW * dt); // frame-rate independent easing
      x += (tx - x) * k;
      y += (ty - y) * k;
      // Sideways-scrolling scene (phones): the swipe drives the camera directly, no lag.
      const range = scene.scrollWidth - scene.clientWidth;
      let cx = x;
      if (range > 1) {
        const progress = scene.scrollLeft / range; // 0 … 1
        cx = x * (SCROLL_DRIFT / DRIFT_X) + (progress * 2 - 1) * SCROLL_DEPTH;
      }
      cx = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, cx));
      scene.style.setProperty("--cx", cx.toFixed(4));
      scene.style.setProperty("--cy", y.toFixed(4));
      raf = visible ? requestAnimationFrame(tick) : 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
    };
    const onLeave = () => (pointer = null);
    // Stop the loop while the tab is hidden.
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    if (hasPointer) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.style.removeProperty("--cx");
      scene.style.removeProperty("--cy");
    };
  }, [reducedMotion]);

  return <span ref={markerRef} hidden />;
}
