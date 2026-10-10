import './Dots.css';

/** Eight tap dots shown while finding the pulse. */
export function HitDots({ n, label }: { n: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="hit-dots">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span
          key={i}
          className="hit-dot"
          style={{
            borderColor: i < n ? 'var(--cyan)' : 'rgba(236,230,216,.32)',
            background: i < n ? 'var(--cyan)' : 'transparent',
          }}
        />
      ))}
    </div>
  );
}
