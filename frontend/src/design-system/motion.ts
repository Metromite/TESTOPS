/**
 * Shared Framer Motion presets for the Glass design system.
 * Kept intentionally short and low-amplitude: this is enterprise dispatch
 * software, not a marketing site. Motion should confirm an action happened,
 * never call attention to itself.
 */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.28, ease: EASE },
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18, ease: EASE },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 4 },
  transition: { duration: 0.22, ease: EASE },
};

export const staggerChildren = {
  animate: { transition: { staggerChildren: 0.045 } },
};

export const pressable = {
  whileTap: { scale: 0.97 },
  whileHover: { scale: 1.015 },
  transition: { duration: 0.15, ease: EASE },
};

/* -------------------------------------------------------------------
   iOS 27 / Liquid Glass pass: real spring PHYSICS (mass/stiffness/
   damping), not duration+easing curves. Duration-based easing can only
   ever *approximate* a spring visually; an actual `type: "spring"`
   transition responds to interruption correctly (e.g. tapping a button
   again mid-release blends velocity instead of restarting), which is
   what makes iOS controls feel tactile rather than merely "smoothed".
   Added alongside the presets above rather than replacing them, so
   nothing already wired to `pressable`/`scaleIn`/etc. changes behavior
   unless a component is explicitly switched to one of these.
------------------------------------------------------------------- */

/** Snappy, low-travel spring for buttons/icon-buttons/chips - tuned to
 *  the spec's press/hover scale ranges (hover ~1.01-1.03, press
 *  ~0.94-0.98) with a quick, slightly underdamped settle. */
export const springPress = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.96 },
  transition: { type: "spring", stiffness: 520, damping: 30, mass: 0.6 },
};

/** Slightly heavier spring for larger tappable surfaces (cards, list
 *  rows) where a bigger, slower-settling motion still reads as calm
 *  rather than bouncy. */
export const springLift = {
  whileHover: { scale: 1.012, y: -2 },
  whileTap: { scale: 0.985 },
  transition: { type: "spring", stiffness: 380, damping: 32, mass: 0.7 },
};

/** Sheet/modal/popover entrance: opacity + a touch of blur-in + a small
 *  scale/y settle, driven by spring physics instead of a fixed duration
 *  curve. `filter` is included so consumers that want the "blur ->
 *  sharp" resolve the spec asks for can spread this directly onto a
 *  motion element; consumers that don't touch filter elsewhere are
 *  unaffected since this is an additive preset, not a modification of
 *  `scaleIn`. */
export const springSheetIn = {
  initial: { opacity: 0, scale: 0.96, y: 8, filter: "blur(6px)" },
  animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.97, y: 4, filter: "blur(4px)" },
  transition: { type: "spring", stiffness: 420, damping: 36, mass: 0.8 },
};

/** Sliding "liquid" indicator (tab pills, segmented controls, switch
 *  thumbs) - a touch bouncier since this is the one place the spec
 *  explicitly wants an indicator to feel like "one physical object
 *  moving between positions". */
export const springSlide = { type: "spring", stiffness: 500, damping: 32 };
