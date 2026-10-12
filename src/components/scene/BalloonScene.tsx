import Image from "next/image";
import type { CSSProperties } from "react";
import { SCENE_IMAGES } from "@/lib/scene/assets";
import { SceneCamera } from "./SceneCamera";
import { SceneScroll } from "./SceneScroll";

/** A layer's box in the 2560×1441 frame, in % — printed by scripts/cut-scene.py. */
type Box = { left: number; top: number; width: number; height: number };

/** Re-run scripts/cut-scene.py and update these if the artwork changes. */
const BALLOON: Box = { left: 61.423, top: 17.003, width: 15.61, height: 34.857 };
const MAN: Box = { left: 14.234, top: 9.989, width: 21.352, height: 88.098 };
const CANVAS: Box = { left: 11.782, top: 31.243, width: 11.423, height: 29.862 };

/** Position a box absolutely, in % of its parent's box. */
function place(box: Box, parent: Box = { left: 0, top: 0, width: 100, height: 100 }): CSSProperties {
  return {
    left: `${((box.left - parent.left) / parent.width) * 100}%`,
    top: `${((box.top - parent.top) / parent.height) * 100}%`,
    width: `${(box.width / parent.width) * 100}%`,
    height: `${(box.height / parent.height) * 100}%`,
  };
}

/**
 * The home scene: at sunset, a man holding a blank canvas watches a red balloon
 * bearing the S rise over the city. Built from docs/design/balloon-scene.png,
 * cut into layers by scripts/cut-scene.py and rebuilt here as depth planes:
 *
 *  far     sky, sun and skyline (sky.webp above the horizon) — barely moves
 *  ground  the plaza (sky.webp below the horizon) — shears in perspective,
 *          more at the bottom (near) than at the horizon (far)
 *  balloon a little nearer than the sky; bobs and sways on the air
 *  man     stands on the plaza, so he moves with the ground at his feet;
 *          he breathes and shifts his weight, and the canvas rocks in his grip
 *
 * SceneCamera drifts the camera (and follows the mouse); globals.css turns the
 * camera position into each plane's offset. This is 2.5D — flat painted planes
 * moved at their own depth — which reads as 3D at a fraction of WebGL's cost.
 */
export function BalloonScene() {
  return (
    <section aria-labelledby="scene-title" className="scene relative w-full overflow-hidden bg-[#f3b46a]">
      <h1 id="scene-title" className="sr-only">
        SUPARFLYY — you must first see your future
      </h1>

      <div className="scene-track">
        <div className="scene-stage">
          <div className="scene-far">
            <Image
              src={SCENE_IMAGES.sky}
              unoptimized
              alt="At sunset, a man holding a blank canvas stands on a wet plaza and watches a red hot-air balloon marked with an S rise over the city skyline."
              fill
              preload
              sizes="100vw"
              className="object-cover"
            />
            <div className="sun-glow" aria-hidden="true" />
          </div>

          <div className="scene-ground" aria-hidden="true">
            <Image src={SCENE_IMAGES.sky} unoptimized alt="" fill sizes="100vw" className="object-cover" />
          </div>

          <div className="scene-balloon" style={place(BALLOON)} aria-hidden="true">
            <div className="balloon-float">
              <Image src={SCENE_IMAGES.balloon} unoptimized alt="" fill sizes="20vw" className="object-contain" />
            </div>
          </div>

          <div className="scene-man" style={place(MAN)} aria-hidden="true">
            <div className="man-shadow" />
            <div className="man-figure">
              <Image src={SCENE_IMAGES.man} unoptimized alt="" fill preload sizes="25vw" className="object-contain" />
              <div className="canvas-rock" style={place(CANVAS, MAN)}>
                <Image src={SCENE_IMAGES.canvas} unoptimized alt="" fill sizes="15vw" className="object-contain" />
                <div className="canvas-sheen" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <SceneCamera />
      {/* Phones: start on the man; the visitor swipes across to the balloon. */}
      <SceneScroll startAt={(MAN.left + MAN.width / 2) / 100} />
    </section>
  );
}
