/** Per-beat look for the four-beat indicator; `beat` is the 0-based beat in the bar, or -1. */
export function beatDot(i: number, beat: number) {
  const on = beat === i;
  return {
    n: i + 1, size: i === 0 ? '8px' : '5px',
    bg: on ? (i === 0 ? '#ece6d8' : '#7fe0ec') : 'rgba(236,230,216,.18)',
    glow: on ? (i === 0 ? '0 0 12px rgba(236,230,216,.9)' : '0 0 8px rgba(127,224,236,.8)') : 'none',
    col: on ? '#ece6d8' : 'rgba(236,230,216,.4)'
  };
}
