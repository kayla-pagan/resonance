import './Landing.css';

/** Welcome screen, the prototype's default "Editorial" layout. */
export function Landing({ onEnterStudio, onEnterDemo }: { onEnterStudio: () => void; onEnterDemo: () => void }) {
  return (
    <div className="landing">
      <h1 data-avoid="soft" className="landing-title serif shadow-hero">
        Make music you can <em>see</em> and <em className="landing-feel">feel</em>.
      </h1>
      <div data-avoid="soft" className="landing-actions">
        <button onClick={onEnterStudio} className="landing-btn landing-btn--primary">
          <span>Enter the studio</span><span className="landing-tri" />
        </button>
        <button onClick={onEnterDemo} className="landing-btn landing-btn--ghost hv-accent-border">
          <span>Try demo mode</span><span className="landing-ring" />
        </button>
        <p className="landing-note mono">Demo mode runs without a camera or wristband</p>
      </div>
    </div>
  );
}
