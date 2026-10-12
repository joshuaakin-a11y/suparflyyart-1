"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PreloadImages } from "@/components/transition/PreloadImages";
import { WarmRoutes } from "@/components/transition/WarmRoutes";
import { SCENE_IMAGE_LIST } from "@/lib/scene/assets";
import { HOME_ROUTE } from "@/lib/site/nav";

export type IntroStep = "quote" | "see";
const STEPS: IntroStep[] = ["quote", "see"];

/** Timings, ms. */
const T = {
  lift: 700, // the light lifts off the quote
  readQuote: 750, // the quote stays fully visible
  sink: 600, // the quote sinks back into the light
  seeLift: 650, // the light lifts off SEE
  seeFocus: 1400, // SEE draws in from wide letter-spacing, like an eye focusing
  seeHold: 450, // SEE rests once focused
  exit: 900, // the camera pushes through SEE…
  exitLight: 600, // …while the light rises to solid over the last part of the push
  hold: 140, // solid light before the balloon scene takes over
  reducedQuote: 1500, // reduced motion: plain cuts, longer reading time
  reducedSee: 1000,
  fontWait: 1200, // never wait longer than this for the display font
};

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN_OUT = "cubic-bezier(0.45, 0, 0.2, 1)";
const EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";

/** SEE's letter-spacing while it focuses (em). The same amount of left padding keeps the word optically centred. */
const SEE_WIDE = "0.9em";
const SEE_FOCUSED = "0.32em";

interface IntroSequenceProps {
  /** Where to start: the intro starts at the quote; /see starts at SEE. */
  from?: IntroStep;
  /** Heading level for the quote: h1 on its own page, h2 inside the intro. */
  quoteAs?: "h1" | "h2";
}

/**
 * Everything between the camera dive and the balloon scene, as one continuous
 * moment in the warm intro light (--sunset):
 *
 *   quote  "You must first see your future. Only then can you create it." comes
 *          up out of the light, holds, sinks back into it
 *   SEE    rises out of the light, drawing in from wide letter-spacing like an
 *          eye focusing; then the camera pushes through the word as the light
 *          rises to solid
 *   →      /home, whose own light (SceneReveal) holds until the scene is
 *          loaded, then lifts
 *
 * Seamless by construction:
 *  - One light layer stays mounted the whole time; content only swaps while it
 *    fully covers the screen.
 *  - Everything runs on the Web Animations API from one async script, not CSS
 *    keyframes (a stylesheet reload — the dev server does this while it builds
 *    the next page — restarts CSS animations, which showed as the quote
 *    appearing twice).
 *  - Text is never scaled while readable (a finished transform on text makes
 *    the browser re-rasterise it — a visible flick); only opacity of the light
 *    and SEE's letter-spacing move until the final push.
 *  - The display font is loaded before the first lift, so nothing swaps fonts
 *    on screen.
 *  - A single page change (to /home) for the whole sequence.
 */
export function IntroSequence({ from = "quote", quoteAs: QuoteHeading = "h2" }: IntroSequenceProps) {
  const router = useRouter();
  const lightRef = useRef<HTMLDivElement>(null);
  const quoteRef = useRef<HTMLDivElement>(null);
  const seeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    router.prefetch(HOME_ROUTE);
  }, [router]);

  useEffect(() => {
    const light = lightRef.current;
    const quote = quoteRef.current;
    const see = seeRef.current;
    if (!light || !quote || !see) return;

    let cancelled = false;
    const running: Animation[] = [];
    const timers: number[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const wait = (ms: number) => new Promise<void>((done) => timers.push(window.setTimeout(done, ms)));
    const play = (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const a = el.animate(keyframes, { fill: "forwards", ...options });
      running.push(a);
      return a.finished.then(() => undefined);
    };
    const show = (el: HTMLElement, on: boolean) => {
      el.style.visibility = on ? "visible" : "hidden";
    };

    // Start state (also restores it if React runs this effect twice in development).
    light.style.opacity = reduced ? "0" : "1";
    show(quote, from === "quote");
    show(see, from === "see");
    see.style.letterSpacing = reduced ? SEE_FOCUSED : SEE_WIDE;
    see.style.paddingLeft = see.style.letterSpacing;

    const fontsReady = Promise.race([
      Promise.all([
        document.fonts.load('400 1em "Chakra Petch"'),
        document.fonts.load('300 1em "Chakra Petch"'),
      ]).catch(() => undefined),
      wait(T.fontWait),
    ]);

    const runQuote = async (last: boolean) => {
      show(quote, true);
      show(see, false);
      if (reduced) return wait(T.reducedQuote);
      await play(light, [{ opacity: 1 }, { opacity: 0 }], { duration: T.lift, easing: EASE_IN_OUT });
      await wait(T.readQuote);
      if (!last) await play(light, [{ opacity: 0 }, { opacity: 1 }], { duration: T.sink, easing: EASE_IN_OUT });
    };

    const runSee = async () => {
      // Swap under full light.
      show(quote, false);
      show(see, true);
      if (reduced) return wait(T.reducedSee);
      const focus = play(
        see,
        [
          { letterSpacing: SEE_WIDE, paddingLeft: SEE_WIDE },
          { letterSpacing: SEE_FOCUSED, paddingLeft: SEE_FOCUSED },
        ],
        { duration: T.seeFocus, easing: EASE_OUT },
      );
      await play(light, [{ opacity: 1 }, { opacity: 0 }], { duration: T.seeLift, easing: EASE_IN_OUT });
      await focus;
      await wait(T.seeHold);
      // The push: SEE rushes toward the camera and blurs, the light rises over the last part of it.
      const push = play(
        see,
        [
          { transform: "scale(1)", filter: "blur(0px)" },
          { transform: "scale(3.2)", filter: "blur(10px)" },
        ],
        { duration: T.exit, easing: EASE_IN },
      );
      await wait(T.exit - T.exitLight);
      await play(light, [{ opacity: 0 }, { opacity: 1 }], { duration: T.exitLight, easing: EASE_IN });
      await push;
    };

    (async () => {
      await fontsReady;
      const steps = STEPS.slice(STEPS.indexOf(from));
      for (let i = 0; i < steps.length; i++) {
        if (cancelled) return;
        if (steps[i] === "quote") await runQuote(i === steps.length - 1);
        else await runSee();
      }
      if (cancelled) return;
      if (!reduced) {
        light.style.opacity = "1";
        await wait(T.hold);
      }
      if (!cancelled) router.push(HOME_ROUTE);
    })().catch(() => {
      /* animations cancelled on unmount */
    });

    return () => {
      cancelled = true;
      running.forEach((a) => a.cancel());
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [from, router]);

  return (
    <section aria-live="polite" className="fixed inset-0 z-40 bg-sunset">
      <div ref={quoteRef} className="absolute inset-0 flex items-center justify-center px-6 text-center">
        <QuoteHeading className="max-w-[32ch] font-display text-[clamp(2.25rem,5vw,4.5rem)] font-normal leading-[1.08] tracking-[-0.01em] text-ink text-balance">
          <span className="block">You must first see your future.</span>
          <span className="mt-[0.35em] block">Only then can you create it.</span>
        </QuoteHeading>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <p
          ref={seeRef}
          className="invisible font-display text-[clamp(4.5rem,17vw,13rem)] font-light uppercase leading-none text-ink will-change-transform"
          style={{ letterSpacing: SEE_WIDE, paddingLeft: SEE_WIDE }}
        >
          See
        </p>
      </div>

      {/* The one light layer for the whole sequence. Starts solid (the dive ended in it). */}
      <div ref={lightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-sunset" />

      <PreloadImages srcs={SCENE_IMAGE_LIST} />
      <WarmRoutes hrefs={WARM} />
    </section>
  );
}

const WARM = [HOME_ROUTE];
