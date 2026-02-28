/**
 * Sanitize a CSS color value. Allows hex colors, rgb(), rgba(), hsl(), hsla(),
 * and named CSS colors. Strips anything containing ; or { or } to prevent
 * CSS injection.
 */
export function sanitizeCssColor(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Block dangerous characters that could escape the CSS property
  if (/[;{}]/.test(trimmed)) return null;
  // Allow hex colors
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  // Allow rgb/rgba/hsl/hsla functions (only digits, commas, spaces, dots, percentages, slashes)
  if (/^(rgb|rgba|hsl|hsla)\([0-9a-zA-Z,.%\s/]+\)$/.test(trimmed)) return trimmed;
  // Allow named CSS colors (letters and hyphens only, reasonable length)
  if (/^[a-zA-Z-]{1,30}$/.test(trimmed)) return trimmed;
  return null;
}
