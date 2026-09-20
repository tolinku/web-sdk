import type { HttpClient } from './client.js';
import { isSafeUrl, isNavigableUrl } from './url-safety.js';
import type { Message, MessageAppContext, MessageComponent, ShowMessageOptions } from './types.js';
import { isMessageDismissed, saveMessageDismissal, isMessageSuppressed, recordMessageImpression } from './storage.js';
import { sanitizeCssColor } from './sanitize.js';

/** What a component needs besides its own props to draw itself. */
interface RenderContext {
  messageId: string;
  options: ShowMessageOptions;
  /** Puck's drop zones, where every Section's children are kept. */
  zones?: Record<string, MessageComponent[]>;
  /** The app the message belongs to, for the deep link components. */
  app: MessageAppContext | null;
}

export class Messages {
  private overlay: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private app: MessageAppContext | null = null;

  constructor(private client: HttpClient) {}

  /** Fetch messages and show the highest-priority non-dismissed one */
  async show(options: ShowMessageOptions = {}, userId?: string | null): Promise<void> {
    const params: Record<string, string> = {};
    if (options.trigger) params.trigger = options.trigger;
    if (userId) params.user_id = userId;

    const data = await this.client.get<{ messages: Message[]; app?: MessageAppContext }>('/v1/api/messages', params);
    // The app the messages belong to rides alongside them, because AppIcon,
    // StoreButtons and DeepLinkButton describe the app and the content carries
    // nothing to draw them from.
    this.app = data.app || null;
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
        padding: 24px 16px; box-sizing: border-box;
        background: rgba(0,0,0,0.5);
        opacity: 0; transition: opacity 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .tolk-msg-overlay.tolk-visible { opacity: 1; }
      .tolk-msg-card {
        position: relative; width: 100%;
        max-height: 80vh; overflow-y: auto;
        border-radius: 16px; box-sizing: border-box;
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
      .tolk-msg-card img { max-width: 100%; }
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

    // The root props are the message surface: the author picked a colour, a
    // gradient, an image, a width and where the content sits. Every one of them
    // used to be dropped, so a message designed with a gradient arrived as a
    // plain white card.
    const root = (message.content && message.content.root && message.content.root.props) || {};
    card.style.backgroundColor =
      sanitizeCssColor(root.bgColor as string) || sanitizeCssColor(message.background_color) || '#ffffff';
    if (root.bgGradient) {
      // background-image rather than the background shorthand, so the colour
      // above still shows through a gradient that is not fully opaque.
      const gradient = safeGradient(String(root.bgGradient));
      if (gradient) card.style.backgroundImage = gradient;
    }
    if (root.bgImage) {
      const bgUrl = sanitizeCssUrl(root.bgImage as string);
      if (bgUrl) {
        card.style.backgroundImage = `url("${bgUrl}")`;
        card.style.backgroundSize = 'cover';
        card.style.backgroundPosition = 'center';
        card.style.backgroundRepeat = 'no-repeat';
      }
    }
    // The defaults are the builder's own defaultProps, which the server
    // renderer already matches. A different number here drew every message that
    // never touched these fields at a width the author never saw.
    card.style.padding = clamp(authoredNumber(root.padding, 20), 0, 200) + 'px';
    // The minimum is what keeps an authored 0 from becoming a sliver of a card
    // with a close button in it.
    card.style.maxWidth = clamp(authoredNumber(root.contentWidth, 480), 100, 2000) + 'px';
    overlay.style.alignItems = root.verticalAlign === 'top' ? 'flex-start' : 'center';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tolk-msg-close';
    closeBtn.setAttribute('aria-label', 'Close message');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      saveMessageDismissal(message.id);
      options.onDismiss?.(message.id);
      this.dismiss();
    });
    card.appendChild(closeBtn);

    // Render Puck content tree
    const context: RenderContext = {
      messageId: message.id,
      options,
      zones: message.content?.zones,
      app: this.app,
    };
    // Whatever the API sent, not whatever it was supposed to send. This is a
    // network response: content that is not an array threw out of show() before
    // the overlay was ever appended, so the message did not fall back to its
    // title and body, it simply never appeared.
    const content = Array.isArray(message.content?.content) ? message.content!.content : [];
    for (const component of content) {
      const el = this.renderComponent(component, context);
      if (el) card.appendChild(el);
    }

    // Asked of the content rather than of what was appended, because a few
    // components draw an element that holds nothing: an empty Section is a box,
    // and counting it as content left a message showing a blank card instead of
    // the title and body it still has.
    const drew = drawsAnything(content, context, 0);

    // A message with no usable content still has a title and a body, which are
    // fields of the message rather than of the Puck tree. Drawing those beats
    // showing an empty card with a close button in it.
    if (!drew) {
      if (message.title) {
        const titleEl = document.createElement('h2');
        titleEl.textContent = message.title;
        titleEl.style.fontSize = '24px';
        titleEl.style.fontWeight = '700';
        titleEl.style.color = '#1B1B1B';
        titleEl.style.lineHeight = '1.2';
        titleEl.style.margin = '0';
        card.appendChild(titleEl);
      }
      if (message.body) {
        const bodyEl = document.createElement('p');
        bodyEl.textContent = message.body;
        bodyEl.style.fontSize = '15px';
        bodyEl.style.color = '#555555';
        bodyEl.style.lineHeight = '1.5';
        bodyEl.style.margin = message.title ? '8px 0 0 0' : '0';
        card.appendChild(bodyEl);
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

  private renderComponent(component: MessageComponent, context: RenderContext, depth = 0): HTMLElement | null {
    // A null entry in the content array is a thing the API can send, and
    // reading .type off it took the whole message down with a TypeError.
    if (!component || typeof component !== 'object') return null;
    const props = component.props || {};

    switch (component.type) {
      case 'Heading': {
        const el = document.createElement('h2');
        el.textContent = (props.text as string) || '';
        el.style.fontSize = authoredNumber(props.fontSize, 28) + 'px';
        el.style.fontWeight = '700';
        el.style.color = sanitizeCssColor(props.color as string) || '#1B1B1B';
        el.style.textAlign = sanitizeTextAlign(props.alignment as string);
        el.style.lineHeight = '1.2';
        // No margin. Spacing in a message is authored with Spacer components,
        // and the margins this renderer added on its own made every message
        // taller here than in the builder or on a device.
        el.style.margin = '0';
        return el;
      }

      case 'TextBlock': {
        const el = document.createElement('p');
        appendMarkdownText(el, (props.content as string) || '');
        el.style.fontSize = authoredNumber(props.fontSize, 15) + 'px';
        el.style.color = sanitizeCssColor(props.color as string) || '#555555';
        el.style.textAlign = sanitizeTextAlign(props.alignment as string);
        el.style.lineHeight = '1.5';
        el.style.margin = '0';
        return el;
      }

      case 'Image': {
        const url = (props.url as string) || '';
        if (!isSafeUrl(url)) return null;
        const wrap = document.createElement('div');
        wrap.style.textAlign = 'center';
        const el = document.createElement('img');
        el.src = url;
        el.alt = (props.alt as string) || '';
        // An empty or unreadable dimension means the image's natural size, not
        // a box of some number we invented. The old code appended "px" to
        // whatever was there, so an authored "auto" became "autopx" and the
        // browser dropped the declaration.
        el.style.width = dimension(props.width) || 'auto';
        el.style.height = dimension(props.height) || 'auto';
        el.style.maxWidth = '100%';
        el.style.borderRadius = authoredNumber(props.borderRadius, 8) + 'px';
        const borderWidth = authoredNumber(props.borderWidth, 0);
        if (borderWidth > 0) {
          el.style.border = `${borderWidth}px solid ${sanitizeCssColor(props.borderColor as string) || '#1B1B1B'}`;
        }
        el.style.display = 'inline-block';
        wrap.appendChild(el);
        return wrap;
      }

      case 'Button':
        return this.renderButton(props, (props.action as string) || '', 'Click', context);

      case 'Section': {
        const el = document.createElement('div');
        if (props.bgColor) el.style.backgroundColor = sanitizeCssColor(props.bgColor as string) || '';
        el.style.padding = authoredNumber(props.padding, 16) + 'px';
        el.style.borderRadius = authoredNumber(props.borderRadius, 0) + 'px';
        el.style.minHeight = '60px';
        if (props.bgImage) {
          const sanitizedUrl = sanitizeCssUrl(props.bgImage as string);
          if (sanitizedUrl) {
            el.style.backgroundImage = `url("${sanitizedUrl}")`;
            el.style.backgroundSize = sanitizeBackgroundSize(props.bgSize as string);
            el.style.backgroundPosition = 'center';
            el.style.backgroundRepeat = 'no-repeat';
          }
        }
        // Children come from the zone Puck wrote them to, keyed by this
        // component's id. props.children is never written by Puck, so reading
        // it drew every Section as an empty box and lost its whole contents.
        for (const child of sectionChildren(props, context, depth)) {
          const childEl = this.renderComponent(child, context, depth + 1);
          if (childEl) el.appendChild(childEl);
        }
        return el;
      }

      case 'Spacer': {
        const el = document.createElement('div');
        el.style.height = authoredNumber(props.height, 24) + 'px';
        return el;
      }

      case 'Divider': {
        const el = document.createElement('hr');
        el.style.border = 'none';
        el.style.borderTop = `${authoredNumber(props.thickness, 1)}px solid ${sanitizeCssColor(props.color as string) || '#e5e5e5'}`;
        el.style.margin = '0';
        return el;
      }

      case 'AppIcon': {
        const wrap = document.createElement('div');
        wrap.style.textAlign = 'center';
        const size = authoredNumber(props.size, 80);
        const borderRadius = authoredNumber(props.borderRadius, 16);
        const iconUrl = context.app?.icon_url || '';
        if (isSafeUrl(iconUrl)) {
          const img = document.createElement('img');
          img.src = iconUrl;
          img.alt = context.app?.name ? `${context.app.name} icon` : 'App Icon';
          img.style.width = size + 'px';
          img.style.height = size + 'px';
          img.style.borderRadius = borderRadius + 'px';
          img.style.objectFit = 'cover';
          img.style.display = 'inline-block';
          wrap.appendChild(img);
        } else {
          // An Appspace with no logo gets the placeholder the builder draws,
          // because a hole the size of the icon reads as a broken message.
          const placeholder = document.createElement('div');
          placeholder.style.width = size + 'px';
          placeholder.style.height = size + 'px';
          placeholder.style.borderRadius = borderRadius + 'px';
          placeholder.style.background = '#f0f0f0';
          placeholder.style.display = 'inline-block';
          wrap.appendChild(placeholder);
        }
        return wrap;
      }

      case 'StoreButtons': {
        const iosUrl = (props.iosUrlOverride as string) || context.app?.ios_store_url || '';
        const androidUrl = (props.androidUrlOverride as string) || context.app?.android_store_url || '';
        const showIos = props.showIos !== false && isNavigableUrl(iosUrl);
        const showAndroid = props.showAndroid !== false && isNavigableUrl(androidUrl);
        if (!showIos && !showAndroid) return null;

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '12px';
        row.style.flexWrap = 'wrap';
        row.style.justifyContent =
          props.alignment === 'center' ? 'center' : props.alignment === 'right' ? 'flex-end' : 'flex-start';
        const height = authoredNumber(props.height, 44);
        // The badge artwork comes from the API alongside the message, already
        // absolute and already PNG. Building the URL here instead would be this
        // SDK guessing at a path on a host it does not own.
        if (showIos) {
          row.appendChild(storeBadge(iosUrl, context.app?.ios_badge_url, 'Download on the App Store', height, context));
        }
        if (showAndroid) {
          row.appendChild(
            storeBadge(androidUrl, context.app?.android_badge_url, 'Get it on Google Play', height, context),
          );
        }
        return row;
      }

      case 'DeepLinkButton': {
        const deepLink = context.app?.deep_link_url || '';
        // Without a destination this is a control that does nothing, so it is
        // left out rather than drawn dead.
        if (!isNavigableUrl(deepLink)) return null;
        return this.renderButton(props, deepLink, 'Open in App', context);
      }

      default:
        return null;
    }
  }

  /** A Button, or a DeepLinkButton, which the builder styles the same way. */
  private renderButton(
    props: Record<string, unknown>,
    action: string,
    defaultLabel: string,
    context: RenderContext,
  ): HTMLElement {
    // Always inside a centring wrapper: a button that is not full width is a
    // compact, centred one, which is what the builder shows.
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';

    const el = document.createElement('button');
    // The variant was editor-only here. An outline button arrived as a solid
    // block, and since its text colour is labelled "filled only" the author
    // never sets it, so the label stayed white: white on light, unreadable.
    const variant = (props.style as string) || 'filled';
    const isOutline = variant === 'outline';
    const baseColor = sanitizeCssColor(props.bgColor as string) || '#1B1B1B';
    // A tint can only be made of a hex colour. Where it cannot ("blue", an
    // rgb() call, an 8-digit hex), the button falls back to the filled variant
    // rather than painting the label in the same colour as the block behind it,
    // which is a button with no visible label at all.
    const tint = variant === 'soft' ? softVariant(baseColor) : null;
    const isSoft = tint !== null;
    el.style.backgroundColor = isOutline ? 'transparent' : isSoft ? tint : baseColor;
    el.style.color = isOutline || isSoft ? baseColor : (sanitizeCssColor(props.textColor as string) || '#ffffff');
    el.style.border = isOutline ? `2px solid ${baseColor}` : 'none';
    el.style.fontSize = authoredNumber(props.fontSize, 16) + 'px';
    el.style.borderRadius = authoredNumber(props.borderRadius, 8) + 'px';
    el.style.padding = '12px 24px';
    el.style.cursor = 'pointer';
    el.style.fontWeight = '600';
    el.style.textAlign = 'center';
    el.style.boxSizing = 'border-box';
    el.style.width = props.fullWidth ? '100%' : 'auto';

    if (props.emoji) {
      const emoji = document.createElement('span');
      emoji.setAttribute('aria-hidden', 'true');
      emoji.textContent = props.emoji as string;
      el.appendChild(emoji);
      el.appendChild(document.createTextNode(' '));
    }
    el.appendChild(document.createTextNode((props.label as string) || defaultLabel));

    el.addEventListener('click', () => {
      // "close" is an action, not a destination. Navigating to it would be a
      // page load of the word close.
      if (action === 'close') {
        saveMessageDismissal(context.messageId);
        context.options.onDismiss?.(context.messageId);
        this.dismiss();
        return;
      }
      // Checked before either path, the caller's own handler included. The URL
      // comes from message content and a handler is ordinary app code that will
      // reasonably open whatever it is handed without looking at it.
      if (action && !isNavigableUrl(action)) return;
      if (context.options.onButtonPress) {
        context.options.onButtonPress(action, context.messageId);
      } else if (action) {
        window.location.href = action;
      }
    });

    wrap.appendChild(el);
    return wrap;
  }

}

/**
 * How deep a section may nest before the renderer stops following zones.
 *
 * A zone can name a section that contains itself, directly or through another,
 * and following that forever overflows the stack: the RangeError came out of
 * show(), so nothing was drawn at all rather than something drawn wrong.
 * Content saved before there was any validation can be shaped this way, so the
 * renderer refuses to recurse forever rather than trusting what it is handed.
 * The same cap as MAX_SECTION_DEPTH in the platform renderer.
 */
const MAX_SECTION_DEPTH = 20;

/** The component types this renderer draws. */
const SUPPORTED = new Set([
  'Heading',
  'TextBlock',
  'Image',
  'Button',
  'Section',
  'Spacer',
  'Divider',
  'AppIcon',
  'StoreButtons',
  'DeepLinkButton',
]);

/** The children of one Section, as far down as the renderer will follow. */
function sectionChildren(
  props: Record<string, unknown>,
  context: RenderContext,
  depth: number,
): MessageComponent[] {
  // An id-less section would read the literal key "undefined:content" and share
  // its children with every other id-less section in the message.
  const sectionId = typeof props.id === 'string' && props.id ? props.id : null;
  if (!sectionId || depth >= MAX_SECTION_DEPTH) return [];
  const children = context.zones?.[`${sectionId}:content`];
  // The zones object arrives over the network like everything else, so a value
  // that is not an array is a thing that can happen rather than a thing that
  // cannot.
  return Array.isArray(children) ? children : [];
}

/**
 * Whether any of this content would actually draw something.
 *
 * A message can be made entirely of components this renderer skips, or of an
 * empty Section, which is an element holding nothing. Counting those as content
 * left the end user looking at a blank card with a close button in it, when the
 * message still had a title and a body to show.
 */
function drawsAnything(content: MessageComponent[], context: RenderContext, depth: number): boolean {
  return content.some((component) => {
    if (!component || typeof component !== 'object' || !SUPPORTED.has(component.type)) return false;
    const props = component.props || {};
    // Three of these draw only when something outside the content exists, and
    // a Section draws only what is in its zone.
    switch (component.type) {
      case 'Image':
        return isSafeUrl((props.url as string) || '');
      case 'DeepLinkButton':
        return isNavigableUrl(context.app?.deep_link_url || '');
      case 'StoreButtons': {
        const ios = (props.iosUrlOverride as string) || context.app?.ios_store_url || '';
        const android = (props.androidUrlOverride as string) || context.app?.android_store_url || '';
        return (
          (props.showIos !== false && isNavigableUrl(ios)) ||
          (props.showAndroid !== false && isNavigableUrl(android))
        );
      }
      case 'Section':
        return drawsAnything(sectionChildren(props, context, depth), context, depth + 1);
      default:
        return true;
    }
  });
}

/**
 * One store badge, linked to the store it belongs to.
 *
 * With no artwork to draw, the link is still drawn, as its own label. A store
 * the author asked for and a URL to reach it are both there, so falling silent
 * over a missing picture would lose the whole button.
 */
function storeBadge(
  url: string,
  badgeUrl: string | null | undefined,
  label: string,
  height: number,
  context: RenderContext,
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = url;
  link.style.display = 'inline-block';
  // The same route a Button takes. An integrator who handles onButtonPress does
  // so to open a URL their own way, and a bare href went around them: inside a
  // WebView it replaced the app's own page with the store.
  link.addEventListener('click', (event) => {
    if (!context.options.onButtonPress) return;
    event.preventDefault();
    context.options.onButtonPress(url, context.messageId);
  });
  if (isSafeUrl(badgeUrl)) {
    const img = document.createElement('img');
    img.src = badgeUrl as string;
    img.alt = label;
    img.style.height = height + 'px';
    img.style.display = 'block';
    link.appendChild(img);
  } else {
    link.textContent = label;
    link.style.lineHeight = height + 'px';
    link.style.fontSize = '14px';
    link.style.fontWeight = '600';
    link.style.color = 'inherit';
  }
  return link;
}

/**
 * A number the author set, or the fallback when they set nothing.
 *
 * `props.x || fallback` cannot tell a zero from a missing value, and zero is
 * the single most common thing to author here: 35 of the stock templates ship
 * a square image or button with `borderRadius: 0`, and every one of them was
 * drawn with the 8px default instead.
 */
function authoredNumber(value: unknown, fallback: number): number {
  // parseFloat, not Number, so this reads what the platform's cssNumber reads:
  // "12abc" is 12 and "0x20" is 0, rather than NaN and 32.
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!isFinite(parsed)) return fallback;
  // Every number that reaches here is a size, a padding, a radius or a
  // thickness, and none of them can be negative: the browser drops the whole
  // declaration, so an authored -10 drew no padding rather than none of it.
  return Math.max(0, parsed);
}

/** Keep a root dimension inside what a message surface can sensibly be. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A CSS length from the builder's free text width and height fields.
 *
 * The fields are free text and the builder's own labels offer "auto", "200"
 * and "200px", so all three arrive. Returns null where the author asked for
 * the natural size, meaning nothing at all, "auto", or something unreadable.
 */
function dimension(raw: unknown): string | null {
  if (typeof raw === 'number') return isFinite(raw) ? `${raw}px` : null;
  if (typeof raw !== 'string') return null;

  const value = raw.trim();
  if (!value || value.toLowerCase() === 'auto') return null;
  if (/^\d+(?:\.\d+)?%$/.test(value)) return value;
  // parseFloat would read "20rem" as 20. Only digits, with an optional px, are
  // a length anyone meant.
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
  return match ? `${match[1]}px` : null;
}

/**
 * The tint the "soft" button variant uses, or null where there is none.
 *
 * Only a plain hex colour can carry the alpha, and the caller needs to know
 * when it could not: the label of a soft button is the base colour, so handing
 * back the base colour as the background too paints the label in the colour of
 * the block behind it. The caller draws a filled button instead.
 */
function softVariant(color: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color + '22';
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3] + '22';
  }
  return null;
}

/**
 * Sanitize a value that lands in a CSS property this SDK sets directly.
 *
 * Mirrors the platform's cssVal: what has to go is whatever could end the
 * value and start another declaration. Parentheses and the colon stay, because
 * a gradient is nothing without them.
 */
function cssVal(value: string): string {
  const cleaned = String(value).replace(/[;{}<>"'`\\]/g, '');
  if (/javascript:|expression\s*\(/i.test(cleaned)) return '';
  return cleaned;
}

/** The gradient functions CSS has, and the only things bgGradient may name. */
const GRADIENT_FUNCTION = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/**
 * An authored background gradient, or nothing when it is not one.
 *
 * bgGradient is a free text field, and cssVal alone leaves `url(...)` in it: a
 * background image is checked with isSafeUrl, while the same picture named here
 * was fetched without a word. That fetch carries the viewer's IP and the
 * customer's page as the Referer to whoever authored the message. A gradient is
 * a gradient function, so that is all this accepts.
 */
export function safeGradient(value: string): string {
  const cleaned = cssVal(value).trim();
  return GRADIENT_FUNCTION.test(cleaned) ? cleaned : '';
}

/** The markdown links the TextBlock field promises the author. */
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Put authored text into an element, turning [text](url) into real links.
 *
 * The TextBlock field is labelled as supporting markdown links and the builder
 * preview draws them, so an author has every reason to believe they work. Only
 * the preview did: here the whole string was set as text, brackets, raw URL
 * and all. A scheme that is not plainly a link stays as written rather than
 * becoming one.
 */
function appendMarkdownText(el: HTMLElement, text: string): void {
  if (!text) return;
  MARKDOWN_LINK.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_LINK.exec(text)) !== null) {
    if (match.index > lastIndex) {
      el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const [full, linkText, rawUrl] = match;
    const url = (rawUrl || '').trim();
    if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(url)) {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = linkText || '';
      link.style.color = 'inherit';
      link.style.textDecoration = 'underline';
      // Same site means exactly one leading slash. "//host" and "/\host" both
      // start with one and are neither: a browser reads them as another origin,
      // so treating them as local opened someone else's page in the customer's
      // own tab with no noopener on it.
      const sameSite = url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
      if (!sameSite) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      el.appendChild(link);
    } else {
      el.appendChild(document.createTextNode(full));
    }
    lastIndex = MARKDOWN_LINK.lastIndex;
  }
  if (lastIndex < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

/** Sanitize a URL for use in CSS url() values (escape quotes and backslashes, block dangerous schemes) */
export function sanitizeCssUrl(url: string): string | null {
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
