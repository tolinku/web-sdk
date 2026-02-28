const BANNER_KEY = 'tolinku_banner_dismissed';
const MESSAGE_KEY = 'tolinku_message_dismissed';
const MESSAGE_IMPRESSIONS_KEY = 'tolinku_message_impressions';
const MESSAGE_LAST_SHOWN_KEY = 'tolinku_message_last_shown';

function getStore(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

function setStore(key: string, data: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Check if a banner was recently dismissed. When dismissDays is 0,
 * the banner is never considered dismissed (i.e. it shows on every
 * page load with no persistence).
 */
export function isBannerDismissed(bannerId: string, dismissDays: number | null): boolean {
  // dismissDays: 0 means "show every page load" (no persistence)
  if (!dismissDays || dismissDays <= 0) return false;
  const data = getStore(BANNER_KEY);
  const entry = data[bannerId];
  if (!entry) return false;
  const dismissedAt = new Date(entry).getTime();
  return (Date.now() - dismissedAt) < (dismissDays * 86400000);
}

export function saveBannerDismissal(bannerId: string): void {
  const data = getStore(BANNER_KEY);
  data[bannerId] = new Date().toISOString();
  setStore(BANNER_KEY, data);
}

/**
 * Check if a message was recently dismissed. When dismissDays is 0,
 * the message is never considered dismissed (i.e. it shows on every
 * page load with no persistence).
 */
export function isMessageDismissed(messageId: string, dismissDays: number | null): boolean {
  // dismissDays: 0 means "show every page load" (no persistence)
  if (!dismissDays || dismissDays <= 0) return false;
  const data = getStore(MESSAGE_KEY);
  const entry = data[messageId];
  if (!entry) return false;
  const dismissedAt = new Date(entry).getTime();
  return (Date.now() - dismissedAt) < (dismissDays * 86400000);
}

export function saveMessageDismissal(messageId: string): void {
  const data = getStore(MESSAGE_KEY);
  data[messageId] = new Date().toISOString();
  setStore(MESSAGE_KEY, data);
}

/**
 * Check if a message should be suppressed based on max_impressions
 * or min_interval_hours. Returns true if the message should NOT be shown.
 */
export function isMessageSuppressed(
  messageId: string,
  maxImpressions: number | null,
  minIntervalHours: number | null,
): boolean {
  // Check max impressions
  if (maxImpressions !== null && maxImpressions > 0) {
    const impressions = getStore(MESSAGE_IMPRESSIONS_KEY);
    const count = parseInt(impressions[messageId] || '0', 10);
    if (count >= maxImpressions) return true;
  }

  // Check min interval
  if (minIntervalHours !== null && minIntervalHours > 0) {
    const lastShown = getStore(MESSAGE_LAST_SHOWN_KEY);
    const entry = lastShown[messageId];
    if (entry) {
      const lastShownAt = new Date(entry).getTime();
      const intervalMs = minIntervalHours * 3600000;
      if ((Date.now() - lastShownAt) < intervalMs) return true;
    }
  }

  return false;
}

/** Record that a message was shown (increment impression count and update last-shown time). */
export function recordMessageImpression(messageId: string): void {
  // Increment impression count
  const impressions = getStore(MESSAGE_IMPRESSIONS_KEY);
  const count = parseInt(impressions[messageId] || '0', 10);
  impressions[messageId] = String(count + 1);
  setStore(MESSAGE_IMPRESSIONS_KEY, impressions);

  // Update last-shown timestamp
  const lastShown = getStore(MESSAGE_LAST_SHOWN_KEY);
  lastShown[messageId] = new Date().toISOString();
  setStore(MESSAGE_LAST_SHOWN_KEY, lastShown);
}
