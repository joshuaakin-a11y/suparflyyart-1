"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SRain } from "@/components/background/SRain";
import type { SRainEngine } from "@/lib/rain/SRainEngine";
import { LightWash } from "@/components/transition/LightWash";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { PreloadImages } from "@/components/transition/PreloadImages";
import { WarmRoutes } from "@/components/transition/WarmRoutes";
import { SCENE_IMAGE_LIST } from "@/lib/scene/assets";
import { SCENE_CURSOR_SWATCH, SCENE_RAIN_PALETTE } from "@/lib/scene/palette";
import { HOME_ROUTE } from "@/lib/site/nav";
import { IntroSequence } from "./IntroSequence";

const WARM = [HOME_ROUTE];

/** Length of the camera dive, ms. The screen is solid warm light at the end of it. */
const DIVE_MS = 1350;
/** When the light starts to rise, as a fraction of the dive. */
const WHITE_FROM = 0.55;
/** How far the camera travels into the rain (scale of the rain layer at the end). */
const DIVE_DEPTH = 14;

/**
 * The camera dive, applied to the whole rain layer around the click point:
 * a small pull-back (anticipation), then an accelerating push-in that blurs
 * with speed and blows out to light.
 */
function diveKeyframes(): Keyframe[] {
  return [
    { transform: "scale(1)", filter: "blur(0px) brightness(1)", easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
    // Anticipation: the camera eases back a touch before it commits.
    {
      transform: "scale(0.965)",
      filter: "blur(0px) brightness(1)",
      offset: 0.16,
      easing: "cubic-bezier(0.7, 0, 0.84, 0)",
    },
    // Accelerating dive: speed blur and overexposure build toward the end.
    {
      transform: "scale(2.2)",
      filter: "blur(1px) brightness(1.1)",
      offset: 0.62,
      easing: "cubic-bezier(0.55, 0, 1, 0.45)",
    },
    { transform: `scale(${DIVE_DEPTH})`, filter: "blur(14px) brightness(1.8)" },
  ];
}

/**
 * The homepage: the S rain, and a click / tap / Enter anywhere that sends the
 * camera diving into the rain toward that point — through the big S — until
 * everything blows out to warm light. The quote and then SEE come up out of
 * that light right here (IntroSequence, no page change), and only then does it
 * move on to the balloon scene: a single page change for the whole sequence.
 */
type Phase = "rain" | "diving" | "quote";

export function HomeExperience() {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const rainLayerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SRainEngine | null>(null);
  const [phase, setPhase] = useState<Phase>("rain");
  const diving = phase !== "rain";

  // Fetch the balloon scene's page ahead of time so it's ready after the quote.
  useEffect(() => {
    router.prefetch(HOME_ROUTE);
    // Load the display font now, so the quote and SEE never swap fonts on screen.
    document.fonts.load('400 1em "Chakra Petch"').catch(() => undefined);
    document.fonts.load('300 1em "Chakra Petch"').catch(() => undefined);
  }, [router]);

  const begin = useCallback(
    (clientX: number, clientY: number) => {
      if (diving) return; // already on the way
      if (reducedMotion) {
        setPhase("quote");
        return;
      }
      setPhase("diving");

      // The big S stays put at the focal point and melts away as the camera
      // flies through it (the dive itself does the enlarging).
      engineRef.current?.burstCursor(DIVE_MS * 0.8, clientX, clientY, 1.4);

      const layer = rainLayerRef.current;
      if (layer) {
        layer.style.transformOrigin = `${clientX}px ${clientY}px`;
        layer.animate(diveKeyframes(), { duration: DIVE_MS, fill: "forwards" });
      }
    },
    [diving, reducedMotion],
  );

  return (
    <main className="relative min-h-dvh overflow-hidden bg-sunset">
      {/* Fixed layer so the dive's scale and blur apply to the full-screen canvas.
          Removed once the quote is up (it's fully covered by then) to free the GPU. */}
      {phase !== "quote" && (
        <div ref={rainLayerRef} className="pointer-events-none fixed inset-0 will-change-transform">
          <SRain
            className="absolute inset-0 h-full w-full"
            engineRef={engineRef}
            palette={SCENE_RAIN_PALETTE}
            cursorSwatch={SCENE_CURSOR_SWATCH}
            trailOpacity={0.8}
          />
        </div>
      )}

      <h1 className="sr-only">SUPARFLYYART</h1>

      {/* Start loading the balloon scene while the visitor watches the rain. */}
      <PreloadImages srcs={SCENE_IMAGE_LIST} />
      <WarmRoutes hrefs={WARM} />

      {/* The whole screen is the way in. A real button keeps it keyboard- and screen-reader-friendly. */}
      {phase !== "quote" && (
        <button
          type="button"
          aria-label="Enter SUPARFLYYART"
          disabled={diving}
          onClick={(e) => {
            // Keyboard "clicks" report 0,0 — dive toward the centre instead.
            const fromKeyboard = e.detail === 0;
            begin(fromKeyboard ? window.innerWidth / 2 : e.clientX, fromKeyboard ? window.innerHeight / 2 : e.clientY);
          }}
          className="fixed inset-0 h-full w-full cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/40"
        />
      )}

      {/* The dive ends in solid warm light; the quote's own light takes over in the same frame. */}
      {phase === "diving" && (
        <LightWash durationMs={DIVE_MS} startAt={WHITE_FROM} tone="bg-sunset" onComplete={() => setPhase("quote")} />
      )}

      {phase === "quote" && <IntroSequence />}
    </main>
  );
}
