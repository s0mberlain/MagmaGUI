/**
 * Motion for Vulcan (GSAP). Operate-mode rules (DESIGN.md "Motion"): motion explains a state
 * change, a relationship or feedback; there is one authored moment (the sign-in strike) and
 * nothing waits on an animation. Content is always rendered in its final state first, so a
 * failed or skipped animation never hides anything.
 *
 * Reduced motion (`prefers-reduced-motion: reduce`): no spatial movement; numbers show their
 * final value at once; entrances keep a short opacity fade so the change is still visible.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

/** Confident arrival: fast start, long settle (cubic-bezier(0.16, 1, 0.3, 1) family). */
export const EASE_OUT = "expo.out";
export const DUR = { feedback: 0.15, state: 0.24, layout: 0.36, focal: 0.6 } as const;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A number that counts to its value when it first arrives and eases to each new value after.
 * The element's text is owned by this hook (render it empty): it is written before the first
 * paint, so there is never a blank or a wrong number on screen.
 */
export function useCountUp(value: number | null | undefined, format: (v: number) => string) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === null || value === undefined) {
      el.textContent = "–";
      shown.current = null;
      return;
    }
    const from = shown.current ?? 0;
    shown.current = value;
    if (reducedMotion() || from === value) {
      el.textContent = format(value);
      return;
    }
    const o = { v: from };
    el.textContent = format(from);
    const tw = gsap.to(o, {
      v: value,
      duration: DUR.focal,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = format(o.v);
      },
      onComplete: () => {
        el.textContent = format(value);
      },
    });
    return () => {
      tw.kill();
      el.textContent = format(value);
    };
    // format is a pure formatter; a new function identity must not restart the tween
  }, [value]);
  return ref;
}

/**
 * Bars inside `scope` (`.bar > div`, `.bar-fill`) fill from the left the first time `ready`
 * becomes true. Transform only (scaleX), so no layout work.
 */
export function useFillBars(scope: RefObject<HTMLElement | null>, ready: boolean) {
  const done = useRef(false);
  useLayoutEffect(() => {
    const root = scope.current;
    if (!ready || !root || done.current) return;
    done.current = true;
    const bars = root.querySelectorAll<HTMLElement>(".bar > div, .bar-fill");
    if (!bars.length || reducedMotion()) return;
    const tw = gsap.from(bars, {
      scaleX: 0,
      transformOrigin: "0% 50%",
      duration: DUR.focal,
      ease: EASE_OUT,
      // no stagger: each bar fills in step with the number counting above it
      clearProps: "transform",
    });
    return () => {
      tw.progress(1).kill();
    };
  }, [ready, scope]);
}

/** Entrance of a floating element (bulk bar, save bar): rises a few pixels into place. */
export function useRiseIn<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const tw = reducedMotion()
      ? gsap.from(el, { opacity: 0, duration: DUR.feedback, clearProps: "opacity" })
      : gsap.from(el, { y: 14, opacity: 0, duration: DUR.state, ease: EASE_OUT, clearProps: "transform,opacity" });
    return () => {
      tw.progress(1).kill();
    };
  }, [active]);
  return ref;
}

/** Opening of a dialog or popover: a short fade with a 1–2 px lift. */
export function openIn(el: Element | null, lift = 6) {
  if (!el) return;
  if (reducedMotion()) {
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: DUR.feedback, clearProps: "opacity" });
    return;
  }
  gsap.fromTo(
    el,
    { opacity: 0, y: lift, scale: 0.985 },
    { opacity: 1, y: 0, scale: 1, duration: DUR.state, ease: EASE_OUT, clearProps: "transform,opacity" },
  );
}

/**
 * Rows that change order or set (Priorities): call `capture()` right before the change that
 * reorders them (e.g. a filter whose data then loads); when `data` next changes, the rows glide
 * from their old places and new rows fade in. Rows need a stable `data-flip-id`.
 */
export function useFlipRows(scope: RefObject<HTMLElement | null>, data: unknown, selector = "[data-flip-id]") {
  const state = useRef<{ flip: ReturnType<typeof Flip.getState>; ids: Set<string> } | null>(null);
  useLayoutEffect(() => {
    const prev = state.current;
    const root = scope.current;
    if (!prev || !root) return;
    state.current = null;
    const rows = [...root.querySelectorAll<HTMLElement>(selector)];
    const fresh = rows.filter((r) => !prev.ids.has(r.dataset.flipId ?? ""));
    // new rows fade in the moment the data lands, so the list is never a row short
    const enter = fresh.length
      ? gsap.fromTo(fresh, { opacity: 0 }, { opacity: 1, duration: reducedMotion() ? DUR.feedback : 0.2, ease: "power1.out", clearProps: "opacity" })
      : null;
    // reduced motion: rows that stayed do not move and do not blink
    const tl = reducedMotion()
      ? null
      : Flip.from(prev.flip, { targets: rows.filter((r) => !fresh.includes(r)), duration: DUR.layout, ease: "power2.inOut", prune: true });
    return () => {
      enter?.progress(1).kill();
      tl?.progress(1).kill();
    };
  }, [data, scope, selector]);
  return {
    capture() {
      const root = scope.current;
      if (!root) return;
      const els = root.querySelectorAll<HTMLElement>(selector);
      state.current = { flip: Flip.getState(els), ids: new Set([...els].map((e) => e.dataset.flipId ?? "")) };
    },
  };
}

/**
 * The one authored moment: the sign-in "strike". The V drops onto its base and the spark is
 * struck (a bright flash that settles). Only the mark moves: the headline and the form are
 * there from the first paint. The from-state is set before paint (layout effect), so the final
 * mark never flashes first. ~0.55 s. Reduced motion: the mark fades in place.
 */
export function useSignInStrike(scope: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root) return;
    const v = root.querySelector(".logo-v");
    const spark = root.querySelector(".logo-spark");
    if (!v || !spark) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.from([v, spark], { opacity: 0, duration: 0.3, stagger: 0.08, clearProps: "opacity" });
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: EASE_OUT } });
      tl.from(v, { opacity: 0, duration: 0.1, ease: "none" })
        .from(v, { y: -9, duration: 0.24, ease: "power2.in", transformOrigin: "50% 100%" }, 0)
        .from(spark, { scale: 2.4, opacity: 0, rotate: -45, transformOrigin: "50% 50%", duration: 0.45 }, 0.22)
        .fromTo(
          spark,
          { filter: "drop-shadow(0 0 5px rgba(249, 115, 22, 0.95))" },
          { filter: "drop-shadow(0 0 0px rgba(249, 115, 22, 0))", duration: 0.6, ease: "power2.out", clearProps: "filter" },
          0.22,
        );
    }, root);
    return () => ctx.revert();
  }, [scope]);
}
