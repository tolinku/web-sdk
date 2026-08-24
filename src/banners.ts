import type { HttpClient } from './client.js';
import type { BannerConfig, BannerItem, ShowBannerOptions } from './types.js';
import { isBannerDismissed, saveBannerDismissal } from './storage.js';
import { sanitizeCssColor } from './sanitize.js';

// Themes (extensible: add new entries to this map). cta.bg / cta.color are
// optional. When omitted, the CTA auto-inverts against the resolved banner
// bg / title color (the v1.1 behavior). A theme that wants a brand-colored
// CTA can set them.
interface Theme {
  bg: string;
  border: string;
  shadow: 'none' | 'sm' | 'md' | 'lg';
  title: { color: string; size: number; weight: number };
  body: { color: string; size: number; weight: number };
  cta: { bg?: string; color?: string; size: number; weight: number; radius: number };
  icon: { size: number; radius: number };
}

const themes: Record<string, Theme> = {
  light: {
    bg: '#ffffff', border: '', shadow: 'sm',
    title: { color: '#000000', size: 14, weight: 600 },
    body:  { color: '#000000', size: 12, weight: 400 },
    cta:   { size: 13, weight: 600, radius: 100 },
    icon:  { size: 40, radius: 10 },
  },
  dark: {
    bg: '#1B1B1B', border: '', shadow: 'sm',
    title: { color: '#ffffff', size: 14, weight: 600 },
    body:  { color: '#ffffff', size: 12, weight: 400 },
    cta:   { size: 13, weight: 600, radius: 100 },
    icon:  { size: 40, radius: 10 },
  },
};

const SHADOW_VALUES: Record<string, string> = {
  none: 'none',
  sm: '0 2px 8px rgba(0,0,0,0.15)',
  md: '0 6px 20px rgba(0,0,0,0.18)',
  lg: '0 12px 36px rgba(0,0,0,0.22)',
};

function clampInt(val: number | undefined, min: number, max: number): number | null {
  if (val === undefined || val === null || isNaN(val)) return null;
  return Math.max(min, Math.min(max, Math.floor(val)));
}

function sanitizeClass(val: string | undefined): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[^a-zA-Z0-9_\-\s]/g, '').slice(0, 100).trim();
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export class Banners {
  private container: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private currentAnimation: 'slide' | 'fade' | 'pop' | 'none' = 'slide';
  private currentStyle: 'pinned' | 'floating' | 'stacked' = 'pinned';
  private currentPosition: 'top' | 'bottom' = 'top';

  constructor(private client: HttpClient) {}

  /** Fetch banner config and show the highest-priority banner */
  async show(options: ShowBannerOptions = {}, userId?: string | null): Promise<void> {
    const params: Record<string, string> = {};
    if (userId) params.user_id = userId;
    const config = await this.client.getPublic<BannerConfig>('/v1/api/banner/config', params);
    if (!config.enabled || !config.banners || config.banners.length === 0) return;

    config.banners.sort((a, b) => b.priority - a.priority);

    let banner: BannerItem | null = null;
    for (const b of config.banners) {
      if (options.label && b.label !== options.label) continue;
      if (!isBannerDismissed(b.id, b.dismiss_days)) {
        banner = b;
        break;
      }
    }
    if (!banner) return;

    const delay = clampInt(options.delay, 0, 60000);
    if (delay && delay > 0) {
      setTimeout(() => this.render(config, banner!, options), delay);
    } else {
      this.render(config, banner, options);
    }
  }

  /** Remove the banner from the DOM, respecting the active animation */
  dismiss(): void {
    if (!this.container) return;
    const container = this.container;
    const styleEl = this.styleEl;

    container.classList.remove('tolk-visible');
    if (this.currentStyle === 'pinned') {
      document.body.style.removeProperty(this.currentPosition === 'top' ? 'padding-top' : 'padding-bottom');
    }

    const cleanup = () => {
      container.remove();
      styleEl?.remove();
      if (this.container === container) {
        this.container = null;
        this.styleEl = null;
      }
    };

    if (this.currentAnimation === 'none') {
      cleanup();
    } else {
      setTimeout(cleanup, 400);
    }
  }

  private render(config: BannerConfig, banner: BannerItem, options: ShowBannerOptions): void {
    if (this.container) {
      this.container.remove();
      this.styleEl?.remove();
      // Strip any body padding the previous render added. Without this, going
      // pinned → stacked (or → floating) leaves a stale padding-top/bottom
      // on <body> that the new render won't clean up.
      if (this.currentStyle === 'pinned') {
        document.body.style.removeProperty(this.currentPosition === 'top' ? 'padding-top' : 'padding-bottom');
      }
    }

    const themeName = options.theme && themes[options.theme] ? options.theme : 'light';
    const theme = themes[themeName];

    let position: 'top' | 'bottom' = 'top';
    if (options.position === 'top' || options.position === 'bottom') position = options.position;
    else if (banner.position === 'top' || banner.position === 'bottom') position = banner.position;

    // Style precedence: option → banner.style from dashboard → 'pinned'.
    let resolvedStyle: 'pinned' | 'floating' | 'stacked' = 'pinned';
    if (options.style === 'pinned' || options.style === 'floating' || options.style === 'stacked') {
      resolvedStyle = options.style;
    } else if (banner.style === 'pinned' || banner.style === 'floating' || banner.style === 'stacked') {
      resolvedStyle = banner.style as 'pinned' | 'floating' | 'stacked';
    }
    const floating = resolvedStyle === 'floating';
    const stacked = resolvedStyle === 'stacked';

    let animation: 'slide' | 'fade' | 'pop' | 'none' = options.animation || 'slide';
    // Pop needs floating or stacked layout to look right; downgrade in pinned.
    if (animation === 'pop' && !floating && !stacked) animation = 'slide';

    this.currentPosition = position;
    this.currentStyle = resolvedStyle;
    this.currentAnimation = animation;

    const serverBg = sanitizeCssColor(banner.background_color);
    const serverText = sanitizeCssColor(banner.text_color);

    const optBg = sanitizeCssColor(options.bg);
    const optBorder = sanitizeCssColor(options.border);
    const optTitleColor = sanitizeCssColor(options.titleColor);
    const optBodyColor = sanitizeCssColor(options.bodyColor);
    const optCtaBg = sanitizeCssColor(options.ctaBg);
    const optCtaColor = sanitizeCssColor(options.ctaColor);

    const bg = optBg || serverBg || theme.bg;
    const border = optBorder || theme.border;
    const titleColor = optTitleColor || serverText || theme.title.color;
    const bodyColor = optBodyColor || serverText || theme.body.color;

    // CTA: option → theme.cta.bg/color (only if defined) → auto-invert.
    const ctaBg = optCtaBg || theme.cta.bg || titleColor;
    const ctaColor = optCtaColor || theme.cta.color || bg;

    const titleSize = clampInt(options.titleSize, 10, 24) ?? theme.title.size;
    const titleWeight = options.titleWeight ?? theme.title.weight;
    const bodySize = clampInt(options.bodySize, 10, 20) ?? theme.body.size;
    const bodyWeight = options.bodyWeight ?? theme.body.weight;
    const ctaSize = clampInt(options.ctaSize, 10, 18) ?? theme.cta.size;
    const ctaWeight = options.ctaWeight ?? theme.cta.weight;
    const ctaRadius = clampInt(options.ctaRadius, 0, 100) ?? theme.cta.radius;
    const iconSize = clampInt(options.iconSize, 24, 64) ?? theme.icon.size;
    const iconRadius = clampInt(options.iconRadius, 0, 32) ?? theme.icon.radius;

    // Floating chrome: option → server config → theme/built-in default.
    const optRadius = clampInt(options.radius, 0, 24);
    const serverRadius = (typeof banner.radius === 'number' && banner.radius >= 0 && banner.radius <= 24) ? banner.radius : null;
    const optMargin = clampInt(options.margin, 0, 24);
    const serverMargin = (typeof banner.margin === 'number' && banner.margin >= 0 && banner.margin <= 24) ? banner.margin : null;
    const bannerRadius = floating ? (optRadius ?? serverRadius ?? 12) : 0;
    const bannerMargin = floating ? (optMargin ?? serverMargin ?? 12) : 0;

    const shadowKey =
      (options.shadow && SHADOW_VALUES[options.shadow]) ? options.shadow :
      (banner.shadow && SHADOW_VALUES[banner.shadow]) ? (banner.shadow as 'none' | 'sm' | 'md' | 'lg') :
      theme.shadow;
    const shadow = SHADOW_VALUES[shadowKey];

    const hideIcon = !!options.hideIcon;
    const hideClose = !!options.hideClose;
    const hideBody = !!options.hideBody;
    const customClass = sanitizeClass(options.customClass);

    const ctaText = banner.cta_text || 'Open';
    const installUrl = banner.action_url || (this.client.baseUrl + (config.install_url || '/install'));

    const safeTop = position === 'top' ? 'padding-top: env(safe-area-inset-top, 0px);' : '';
    const safeBottom = position === 'bottom' ? 'padding-bottom: env(safe-area-inset-bottom, 0px);' : '';

    let containerPosition: string;
    let containerInsets: string;
    if (stacked) {
      containerPosition = 'position: sticky;';
      containerInsets = `${position}: 0;`;
    } else if (floating) {
      containerPosition = 'position: fixed;';
      containerInsets = `left: ${bannerMargin}px; right: ${bannerMargin}px; ${position}: ${bannerMargin}px;`;
    } else {
      containerPosition = 'position: fixed;';
      containerInsets = `left: 0; right: 0; ${position}: 0;`;
    }

    // Hide-position must clear floating margin + worst-case shadow (lg = 48px below).
    const hideOffset = bannerMargin + 60;
    const slideHide = position === 'top'
      ? `translateY(calc(-100% - ${hideOffset}px))`
      : `translateY(calc(100% + ${hideOffset}px))`;

    let hiddenCss = '';
    let visibleCss = '';
    let transitionCss = '';
    if (animation === 'slide') {
      hiddenCss = `transform: ${slideHide};`;
      visibleCss = 'transform: translateY(0);';
      transitionCss = 'transition: transform 0.35s ease;';
    } else if (animation === 'fade') {
      hiddenCss = 'opacity: 0;';
      visibleCss = 'opacity: 1;';
      transitionCss = 'transition: opacity 0.3s ease;';
    } else if (animation === 'pop') {
      hiddenCss = 'opacity: 0; transform: scale(0.92);';
      visibleCss = 'opacity: 1; transform: scale(1);';
      transitionCss = 'transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;';
    }

    const container = document.createElement('div');
    container.id = 'tolinku-banner';
    container.setAttribute('role', 'banner');
    container.setAttribute('aria-live', 'polite');
    container.dataset.position = position;
    if (customClass) container.className = customClass;

    const borderCss = border ? `border: 1px solid ${border};` : '';
    const radiusCss = bannerRadius > 0 ? `border-radius: ${bannerRadius}px;` : '';

    const style = document.createElement('style');
    style.textContent = `
      #tolinku-banner {
        ${containerPosition}
        ${containerInsets}
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        ${hiddenCss}
        ${transitionCss}
        ${safeTop}${safeBottom}
      }
      #tolinku-banner.tolk-visible { ${visibleCss} }
      #tolinku-banner .tolk-inner {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px;
        background: ${bg};
        ${borderCss}
        ${radiusCss}
        box-shadow: ${shadow};
      }
      #tolinku-banner .tolk-close {
        background: none; border: none; font-size: 20px; line-height: 1;
        cursor: pointer; color: ${titleColor}; opacity: 0.6; padding: 0 4px; flex-shrink: 0;
      }
      #tolinku-banner .tolk-close:hover { opacity: 1; }
      #tolinku-banner .tolk-icon {
        width: ${iconSize}px; height: ${iconSize}px; border-radius: ${iconRadius}px;
        flex-shrink: 0; object-fit: cover;
      }
      #tolinku-banner .tolk-text { flex: 1; min-width: 0; }
      #tolinku-banner .tolk-title {
        font-size: ${titleSize}px; font-weight: ${titleWeight}; line-height: 1.3;
        color: ${titleColor}; margin: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #tolinku-banner .tolk-body {
        font-size: ${bodySize}px; font-weight: ${bodyWeight}; line-height: 1.3;
        color: ${bodyColor}; margin: 0; opacity: 0.75;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #tolinku-banner .tolk-cta {
        display: inline-block; padding: 0.5em 1.2em; border-radius: ${ctaRadius}px;
        font-size: ${ctaSize}px; font-weight: ${ctaWeight}; line-height: 1.2;
        text-decoration: none; background: ${ctaBg}; color: ${ctaColor};
        flex-shrink: 0; text-align: center;
      }
    `;

    const inner = document.createElement('div');
    inner.className = 'tolk-inner';

    if (!hideClose) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tolk-close';
      closeBtn.setAttribute('aria-label', 'Dismiss banner');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => {
        saveBannerDismissal(banner.id);
        this.dismiss();
      });
      inner.appendChild(closeBtn);
    }

    if (!hideIcon && config.app_icon && isSafeUrl(config.app_icon)) {
      const icon = document.createElement('img');
      icon.className = 'tolk-icon';
      icon.src = config.app_icon;
      icon.alt = config.app_name || 'App';
      inner.appendChild(icon);
    }

    const textWrap = document.createElement('div');
    textWrap.className = 'tolk-text';
    const titleEl = document.createElement('p');
    titleEl.className = 'tolk-title';
    titleEl.textContent = banner.title || config.app_name || 'Get the App';
    textWrap.appendChild(titleEl);
    if (!hideBody && banner.body) {
      const bodyEl = document.createElement('p');
      bodyEl.className = 'tolk-body';
      bodyEl.textContent = banner.body;
      textWrap.appendChild(bodyEl);
    }
    inner.appendChild(textWrap);

    const cta = document.createElement('a');
    cta.className = 'tolk-cta';
    cta.href = isSafeUrl(installUrl) ? installUrl : '#';
    cta.textContent = ctaText;
    inner.appendChild(cta);

    container.appendChild(inner);
    document.head.appendChild(style);

    // DOM insertion: stacked mode injects above the page header (or below the
    // footer for bottom position) so the banner sits in document flow and
    // pushes the host page's header down. Other modes append to body since
    // they're position:fixed overlays.
    if (stacked) {
      const anchor = findStackedAnchor(position, options.anchor);
      if (anchor && anchor.parentNode) {
        if (position === 'top') {
          anchor.parentNode.insertBefore(container, anchor);
        } else if (anchor.nextSibling) {
          anchor.parentNode.insertBefore(container, anchor.nextSibling);
        } else {
          anchor.parentNode.appendChild(container);
        }
      } else if (document.body) {
        if (position === 'top') {
          document.body.insertBefore(container, document.body.firstChild);
        } else {
          document.body.appendChild(container);
        }
      }
    } else {
      document.body.appendChild(container);
    }

    this.container = container;
    this.styleEl = style;

    // Animate in. Body padding only added in pinned mode; floating overlays
    // and stacked sits in flow.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.classList.add('tolk-visible');
        if (!floating && !stacked) {
          const bannerHeight = container.offsetHeight + 'px';
          if (position === 'top') {
            document.body.style.paddingTop = bannerHeight;
          } else {
            document.body.style.paddingBottom = bannerHeight;
          }
        }
      });
    });
  }
}

/** Find an injection point in the DOM for stacked mode. Tries the explicit
 *  selector first, then a list of common page-header / page-footer patterns,
 *  then falls back to body's first/last child via a null return. */
function findStackedAnchor(position: 'top' | 'bottom', explicit?: string): Element | null {
  if (explicit) {
    try {
      const el = document.querySelector(explicit);
      if (el) return el;
    } catch { /* invalid selector */ }
  }
  const selectors = position === 'top'
    ? ['header', '[role="banner"]', 'nav', '.header', '#header', '.navbar']
    : ['footer', '[role="contentinfo"]', '.footer', '#footer'];
  for (const s of selectors) {
    const el = document.body?.querySelector(s);
    if (el) return el;
  }
  return null;
}
