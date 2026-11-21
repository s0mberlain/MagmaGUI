/**
 * Vulcan mark, "The Struck V": a V cut like a hammer blow with the spark it throws at the
 * notch. The V takes the text colour (light on the Graphite rail), the spark is Ember Flare.
 * The parts carry classes so the sign-in moment can animate them (lib/motion.ts).
 */
export default function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={"logo" + (className ? ` ${className}` : "")}>
      <path className="logo-v" d="M4.5 6.5h6.2L16 19.2l5.3-12.7h6.2L18.6 26h-5.2Z" fill="currentColor" />
      <path
        className="logo-spark"
        d="M16 2.6l1.1 2.7 2.7 1.1-2.7 1.1L16 10.2l-1.1-2.7-2.7-1.1 2.7-1.1Z"
        fill="var(--c-accent-logo)"
      />
    </svg>
  );
}
