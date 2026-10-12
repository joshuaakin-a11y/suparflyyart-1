import type { Metadata } from "next";
import { IntroSequence } from "@/components/home/IntroSequence";

export const metadata: Metadata = {
  title: "See — SUPARFLYY",
  description: "See.",
};

/**
 * SEE on its own, for direct visits. The normal flow shows it inside the intro,
 * right after the quote (see IntroSequence).
 */
export default function SeePage() {
  return (
    <main className="min-h-dvh bg-sunset">
      <h1 className="sr-only">See</h1>
      <IntroSequence from="see" />
    </main>
  );
}
