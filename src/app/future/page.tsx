import type { Metadata } from "next";
import { IntroSequence } from "@/components/home/IntroSequence";

export const metadata: Metadata = {
  title: "See your future — SUPARFLYY",
  description: "You must first see your future. Only then can you create it.",
};

/**
 * The quote (then SEE) on its own, for direct visits. The normal flow shows the
 * same sequence inside the intro at the end of the camera dive (HomeExperience).
 */
export default function FuturePage() {
  return (
    <main className="min-h-dvh bg-sunset">
      <IntroSequence from="quote" quoteAs="h1" />
    </main>
  );
}
