import React from 'react';

/**
 * Phase 38.5 — inline SVG wordmark + glyph for the login screen and other
 * headers that need an ERPLaunch lockup. No image asset means no extra
 * round-trip + no broken-image fallback to worry about.
 *
 * The glyph is a stylised "E" cut from a rounded square, with a teal
 * accent line representing the launch trajectory. Pairs with Tailwind's
 * brand-* palette (oklch-based teal/indigo) used elsewhere.
 *
 * Sizes:
 *   - "lg"  → 48 px glyph + 22 px wordmark (login hero)
 *   - "md"  → 32 px glyph + 16 px wordmark (dashboard / archived header)
 *   - "sm"  → 24 px glyph + 14 px wordmark (compact contexts)
 */

type Size = 'sm' | 'md' | 'lg';
type Variant = 'dark-on-light' | 'light-on-dark';

const SIZE_PX: Record<Size, { glyph: number; word: number; gap: number }> = {
  sm: { glyph: 24, word: 14, gap: 8 },
  md: { glyph: 32, word: 16, gap: 10 },
  lg: { glyph: 48, word: 22, gap: 12 },
};

interface ErplaunchLogoProps {
  size?: Size;
  variant?: Variant;
  /** Hide the wordmark; render the glyph alone (e.g. mobile or favicon-style). */
  glyphOnly?: boolean;
}

export function ErplaunchLogo({
  size = 'md',
  variant = 'dark-on-light',
  glyphOnly = false,
}: ErplaunchLogoProps) {
  const dims = SIZE_PX[size];
  const glyphFill = variant === 'light-on-dark' ? 'rgba(255,255,255,0.16)' : 'oklch(95% 0.02 190)';
  const glyphStroke = variant === 'light-on-dark' ? '#ffffff' : 'oklch(48% 0.16 190)';
  const glyphAccent = variant === 'light-on-dark' ? 'oklch(72% 0.16 190)' : 'oklch(58% 0.18 190)';
  const wordColor = variant === 'light-on-dark' ? '#ffffff' : 'oklch(20% 0.02 190)';

  return (
    <span
      role="img"
      aria-label="ERPLaunch"
      className="inline-flex items-center"
      style={{ gap: dims.gap }}
    >
      <svg
        width={dims.glyph}
        height={dims.glyph}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="42" height="42" rx="10" fill={glyphFill} stroke={glyphStroke} strokeWidth="2" />
        {/* Stylised E — three horizontal bars */}
        <rect x="14" y="14" width="20" height="3" rx="1.5" fill={glyphStroke} />
        <rect x="14" y="22" width="14" height="3" rx="1.5" fill={glyphStroke} />
        <rect x="14" y="30" width="20" height="3" rx="1.5" fill={glyphStroke} />
        {/* Launch accent — diagonal trajectory line */}
        <path d="M30 36 L40 24" stroke={glyphAccent} strokeWidth="2" strokeLinecap="round" />
        <circle cx="40" cy="24" r="2" fill={glyphAccent} />
      </svg>
      {!glyphOnly && (
        <span
          className="font-black tracking-tight select-none"
          style={{ fontSize: dims.word, color: wordColor, lineHeight: 1 }}
        >
          ERPLaunch
        </span>
      )}
    </span>
  );
}
