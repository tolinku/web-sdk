import type { HttpClient } from './client.js';
import type { BannerConfig, BannerItem, ShowBannerOptions } from './types.js';
import { isBannerDismissed, saveBannerDismissal } from './storage.js';
import { sanitizeCssColor } from './sanitize.js';

export class Banners {
  private container: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;

  constructor(private client: HttpClient) {}

  /** Fetch banner config and show the highest-priority banner */
  async show(options: ShowBannerOptions = {}, userId?: string | null): Promise<void> {
    const params: Record<string, string> = {};
    if (userId) params.user_id = userId;
    const config = await this.client.getPublic<BannerConfig>('/v1/api/banner/config', params);
    if (!config.enabled || !config.banners || config.banners.length === 0) return;

    // Sort by priority descending (server may not guarantee ordering)
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

    this.render(config, banner, options);
  }

  /** Remove the banner from the DOM */
  dismiss(): void {
    if (this.container) {
      this.container.classList.remove('tolk-visible');
      const pos = this.container.dataset.position || 'top';
      document.body.style.removeProperty(pos === 'top' ? 'padding-top' : 'padding-bottom');
      setTimeout(() => {
        this.container?.remove();
        this.styleEl?.remove();
        this.container = null;
        this.styleEl = null;
      }, 400);
    }
  }

  private render(config: BannerConfig, banner: BannerItem, options: ShowBannerOptions): void {
    // Remove existing banner if any
    if (this.container) {
      this.container.remove();
      this.styleEl?.remove();
    }

    const position = options.position || banner.position || 'top';
    const bgColor = sanitizeCssColor(banner.background_color) || '#ffffff';
    const textColor = sanitizeCssColor(banner.text_color) || '#000000';
    const ctaText = banner.cta_text || 'Open';
    const baseUrl = this.client.baseUrl;
    // Use the per-banner action_url if available, fall back to install_url
    const installUrl = banner.action_url || (baseUrl + (config.install_url || '/install'));

    const safeTop = position === 'top' ? 'padding-top: env(safe-area-inset-top, 0px);' : '';
    const safeBottom = position === 'bottom' ? 'padding-bottom: env(safe-area-inset-bottom, 0px);' : '';

    const container = document.createElement('div');
    container.id = 'tolinku-banner';
    container.setAttribute('role', 'banner');
    container.setAttribute('aria-live', 'polite');
    container.dataset.position = position;

    const style = document.createElement('style');
    style.textContent = `
      #tolinku-banner {
        position: fixed;
        ${position}: 0;
        left: 0; right: 0;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        transform: translateY(${position === 'top' ? '-100%' : '100%'});
        transition: transform 0.35s ease;
        ${safeTop}${safeBottom}
      }
      #tolinku-banner.tolk-visible { transform: translateY(0); }
      #tolinku-banner .tolk-inner {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px;
        background: ${bgColor}; color: ${textColor};
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      }
      #tolinku-banner .tolk-close {
        background: none; border: none; font-size: 20px; line-height: 1;
        cursor: pointer; color: ${textColor}; opacity: 0.6; padding: 0 4px; flex-shrink: 0;
      }
      #tolinku-banner .tolk-close:hover { opacity: 1; }
      #tolinku-banner .tolk-icon {
        width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; object-fit: cover;
      }
      #tolinku-banner .tolk-text { flex: 1; min-width: 0; }
      #tolinku-banner .tolk-title {
        font-size: 14px; font-weight: 600; margin: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #tolinku-banner .tolk-body {
        font-size: 12px; margin: 0; opacity: 0.75;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #tolinku-banner .tolk-cta {
        display: inline-block; padding: 6px 16px; border-radius: 100px;
        font-size: 13px; font-weight: 600; text-decoration: none;
        background: ${textColor}; color: ${bgColor}; flex-shrink: 0; text-align: center;
      }
    `;

    const inner = document.createElement('div');
    inner.className = 'tolk-inner';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tolk-close';
    closeBtn.setAttribute('aria-label', 'Dismiss banner');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      saveBannerDismissal(banner.id);
      this.dismiss();
    });
    inner.appendChild(closeBtn);

    // App icon
    if (config.app_icon && isSafeUrl(config.app_icon)) {
      const icon = document.createElement('img');
      icon.className = 'tolk-icon';
      icon.src = config.app_icon;
      icon.alt = config.app_name || 'App';
      inner.appendChild(icon);
    }

    // Text
    const textWrap = document.createElement('div');
    textWrap.className = 'tolk-text';
    const titleEl = document.createElement('p');
    titleEl.className = 'tolk-title';
    titleEl.textContent = banner.title || config.app_name || 'Get the App';
    textWrap.appendChild(titleEl);
    if (banner.body) {
      const bodyEl = document.createElement('p');
      bodyEl.className = 'tolk-body';
      bodyEl.textContent = banner.body;
      textWrap.appendChild(bodyEl);
    }
    inner.appendChild(textWrap);

    // CTA
    const cta = document.createElement('a');
    cta.className = 'tolk-cta';
    cta.href = isSafeUrl(installUrl) ? installUrl : '#';
    cta.textContent = ctaText;
    inner.appendChild(cta);

    container.appendChild(inner);
    document.head.appendChild(style);
    document.body.appendChild(container);

    this.container = container;
    this.styleEl = style;

    // Animate in and add body padding
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.classList.add('tolk-visible');
        const bannerHeight = container.offsetHeight + 'px';
        if (position === 'top') {
          document.body.style.paddingTop = bannerHeight;
        } else {
          document.body.style.paddingBottom = bannerHeight;
        }
      });
    });
  }
}

/** Only allow http: and https: protocols to prevent javascript: XSS */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

