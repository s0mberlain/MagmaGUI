export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <path
        d="M4 22 L11 8 L15 15 L18 11 L24 22 Z"
        fill="none"
        stroke="var(--c-accent-logo)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
