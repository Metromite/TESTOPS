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
