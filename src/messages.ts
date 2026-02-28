import type { HttpClient } from './client.js';
import type { Message, MessageComponent, ShowMessageOptions } from './types.js';
import { isMessageDismissed, saveMessageDismissal, isMessageSuppressed, recordMessageImpression } from './storage.js';
import { sanitizeCssColor } from './sanitize.js';

export class Messages {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;

  constructor(private client: HttpClient) {}

  /** Fetch messages and show the highest-priority non-dismissed one */
  async show(options: ShowMessageOptions = {}, userId?: string | null): Promise<void> {
    const params: Record<string, string> = {};
    if (options.trigger) params.trigger = options.trigger;
    if (userId) params.user_id = userId;

    const data = await this.client.get<{ messages: Message[] }>('/v1/api/messages', params);
    if (!data.messages || data.messages.length === 0) return;

    // Filter dismissed, filter by triggerValue (server only filters by trigger), and sort by priority
    const candidates = data.messages
      .filter(m => !isMessageDismissed(m.id, m.dismiss_days))
      .filter(m => !isMessageSuppressed(m.id, m.max_impressions, m.min_interval_hours))
      .filter(m => !options.triggerValue || m.trigger_value === options.triggerValue)
      .sort((a, b) => b.priority - a.priority);

    if (candidates.length === 0) return;

    const message = candidates[0];
    recordMessageImpression(message.id);
    this.render(message, options);
  }

  /** Remove the message overlay */
  dismiss(): void {
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      setTimeout(() => {
        this.overlay?.remove();
        this.styleEl?.remove();
        this.overlay = null;
        this.styleEl = null;
      }, 300);
    }
  }

  private render(message: Message, options: ShowMessageOptions): void {
    if (this.overlay) {
      this.overlay.remove();
      this.styleEl?.remove();
    }

    const style = document.createElement('style');
    style.textContent = `
      .tolk-msg-overlay {
        position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 1000000;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.5);
        opacity: 0; transition: opacity 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .tolk-msg-overlay.tolk-visible { opacity: 1; }
      .tolk-msg-card {
        position: relative; max-width: 375px; width: 90%;
        max-height: 80vh; overflow-y: auto;
        border-radius: 16px; padding: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      .tolk-msg-close {
        position: absolute; top: 12px; right: 12px;
        background: rgba(0,0,0,0.1); border: none; border-radius: 50%;
        width: 28px; height: 28px; font-size: 16px; line-height: 1;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        color: inherit; opacity: 0.6;
      }
      .tolk-msg-close:hover { opacity: 1; }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'tolk-msg-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        saveMessageDismissal(message.id);
        options.onDismiss?.(message.id);
        this.dismiss();
      }
    });

    const card = document.createElement('div');
    card.className = 'tolk-msg-card';
    card.style.background = sanitizeCssColor(message.background_color) || '#ffffff';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tolk-msg-close';
    closeBtn.setAttribute('aria-label', 'Close message');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      saveMessageDismissal(message.id);
      options.onDismiss?.(message.id);
      this.dismiss();
    });
    card.appendChild(closeBtn);

    // Render Puck content tree
    if (message.content && message.content.content) {
      for (const component of message.content.content) {
        const el = this.renderComponent(component, message.id, options);
        if (el) card.appendChild(el);
      }
    }

    overlay.appendChild(card);
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    this.overlay = overlay;
    this.styleEl = style;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add('tolk-visible');
      });
    });
  }

  private renderComponent(
    component: MessageComponent,
    messageId: string,
    options: ShowMessageOptions,
  ): HTMLElement | null {
    const props = component.props;

    switch (component.type) {
      case 'Heading': {
        const el = document.createElement('h2');
        el.textContent = (props.text as string) || '';
        el.style.fontSize = (props.fontSize as number || 28) + 'px';
        el.style.fontWeight = '700';
        el.style.color = sanitizeCssColor(props.color as string) || '#1B1B1B';
        el.style.textAlign = sanitizeTextAlign(props.alignment as string);
        el.style.lineHeight = '1.2';
        el.style.margin = '0 0 8px 0';
        return el;
      }

      case 'TextBlock': {
        const el = document.createElement('p');
        el.textContent = (props.content as string) || '';
        el.style.fontSize = (props.fontSize as number || 15) + 'px';
        el.style.color = sanitizeCssColor(props.color as string) || '#555555';
        el.style.textAlign = sanitizeTextAlign(props.alignment as string);
        el.style.lineHeight = '1.5';
        el.style.margin = '0 0 8px 0';
        return el;
      }

      case 'Image': {
        const url = (props.url as string) || '';
        if (!isSafeUrl(url)) return null;
        const el = document.createElement('img');
        el.src = url;
        el.alt = (props.alt as string) || '';
        const width = (props.width as string) || '100%';
        el.style.width = width.endsWith('px') || width.endsWith('%') ? width : width + 'px';
        el.style.borderRadius = (props.borderRadius as number || 8) + 'px';
        el.style.display = 'block';
        el.style.margin = '0 auto 8px auto';
        return el;
      }

      case 'Button': {
        const el = document.createElement('button');
        el.textContent = (props.label as string) || 'Click';
        el.style.backgroundColor = sanitizeCssColor(props.bgColor as string) || '#1B1B1B';
        el.style.color = sanitizeCssColor(props.textColor as string) || '#ffffff';
        el.style.fontSize = (props.fontSize as number || 16) + 'px';
        el.style.borderRadius = (props.borderRadius as number || 8) + 'px';
        el.style.border = 'none';
        el.style.padding = '10px 20px';
        el.style.cursor = 'pointer';
        el.style.fontWeight = '600';
        el.style.margin = '8px 0';
        if (props.fullWidth) {
          el.style.width = '100%';
        }
        el.addEventListener('click', () => {
          const action = (props.action as string) || '';
          if (options.onButtonPress) {
            options.onButtonPress(action, messageId);
          } else if (action) {
            // Only allow http: and https: URLs to prevent javascript: XSS
            if (isSafeUrl(action)) {
              window.location.href = action;
            }
          }
        });
        return el;
      }

      case 'Section': {
        const el = document.createElement('div');
        if (props.bgColor) el.style.backgroundColor = sanitizeCssColor(props.bgColor as string) || '';
        el.style.padding = (props.padding as number || 16) + 'px';
        el.style.borderRadius = (props.borderRadius as number || 0) + 'px';
        el.style.margin = '8px 0';
        if (props.bgImage) {
          const sanitizedUrl = sanitizeCssUrl(props.bgImage as string);
          if (sanitizedUrl) {
            el.style.backgroundImage = `url("${sanitizedUrl}")`;
            el.style.backgroundSize = sanitizeBackgroundSize(props.bgSize as string);
            el.style.backgroundPosition = 'center';
          }
        }
        // Render children if present
        const children = (props.children as MessageComponent[]) || [];
        for (const child of children) {
          const childEl = this.renderComponent(child, messageId, options);
          if (childEl) el.appendChild(childEl);
        }
        return el;
      }

      case 'Spacer': {
        const el = document.createElement('div');
        el.style.height = (props.height as number || 24) + 'px';
        return el;
      }

      case 'Divider': {
        const el = document.createElement('hr');
        el.style.border = 'none';
        el.style.borderTop = `${props.thickness || 1}px solid ${sanitizeCssColor(props.color as string) || '#e5e5e5'}`;
        el.style.margin = '8px 0';
        return el;
      }

      default:
        return null;
    }
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

/** Sanitize a URL for use in CSS url() values (escape quotes and backslashes, block dangerous schemes) */
function sanitizeCssUrl(url: string): string | null {
  if (!isSafeUrl(url)) return null;
  // Escape characters that could break out of a quoted CSS url()
  return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '').replace(/\r/g, '');
}

/** Sanitize text-align value to prevent CSS injection */
function sanitizeTextAlign(value: string | undefined): string {
  const allowed = ['left', 'center', 'right', 'justify'];
  if (value && allowed.includes(value)) {
    return value;
  }
  return 'left';
}

/** Sanitize background-size value to prevent CSS injection */
function sanitizeBackgroundSize(value: string | undefined): string {
  if (!value) return 'cover';

  const allowed = ['cover', 'contain', 'auto'];
  if (allowed.includes(value)) {
    return value;
  }

  // Allow valid CSS length patterns (e.g., "100px", "50%", "10rem", "100px 50px")
  const lengthPattern = /^(\d+(\.\d+)?(px|%|em|rem|vh|vw)(\s+\d+(\.\d+)?(px|%|em|rem|vh|vw))?)$/;
  if (lengthPattern.test(value)) {
    return value;
  }

  return 'cover';
}
