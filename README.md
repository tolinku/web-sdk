# @tolinku/web-sdk

[![npm version](https://img.shields.io/npm/v/@tolinku/web-sdk.svg)](https://www.npmjs.com/package/@tolinku/web-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official [Tolinku](https://tolinku.com) SDK for the web. Add deep linking, analytics, referral tracking, deferred deep links, smart banners, and in-app messages to any website or web app.

## What is Tolinku?

[Tolinku](https://tolinku.com) is a deep linking platform for mobile and web apps. It handles Universal Links (iOS), App Links (Android), deferred deep linking, referral programs, analytics, and smart banners. Tolinku provides a complete toolkit for user acquisition, attribution, and engagement across platforms.

Get your API key at [tolinku.com](https://tolinku.com) and check out the [documentation](https://tolinku.com/docs) to get started.

## Installation

```bash
npm install @tolinku/web-sdk
```

Or with yarn:

```bash
yarn add @tolinku/web-sdk
```

## Quick Start

```typescript
import { Tolinku } from '@tolinku/web-sdk';

const tolinku = new Tolinku({ apiKey: 'tolk_pub_your_api_key' });

// Identify a user
tolinku.setUserId('user_123');

// Track a custom event
await tolinku.track('purchase', { plan: 'growth' });
```

## Features

### Analytics

Track custom events with automatic batching (events are queued and sent in batches of 10, or every 5 seconds). On page unload, remaining events are delivered via `navigator.sendBeacon` for reliable delivery.

```typescript
await tolinku.track('signup_completed', { source: 'landing_page' });

// Flush queued events immediately
await tolinku.flush();
```

### Referrals

Create and manage referral programs with built-in leaderboards and reward tracking.

```typescript
// Create a referral
const { referral_code, referral_url } = await tolinku.referrals.create({
  userId: 'user_123',
  userName: 'Alice',
});

// Look up a referral
const info = await tolinku.referrals.get(referral_code);

// Complete a referral (when a referred user converts)
await tolinku.referrals.complete({
  code: referral_code,
  referredUserId: 'user_456',
  referredUserName: 'Bob',
});

// Update milestone
await tolinku.referrals.milestone({
  code: referral_code,
  milestone: 'first_purchase',
});

// Claim reward
await tolinku.referrals.claimReward(referral_code);

// Fetch leaderboard
const { leaderboard } = await tolinku.referrals.leaderboard(10);
```

### Deferred Deep Links

Recover deep link context for users who installed your app after clicking a link. Deferred deep linking lets you route users to specific content even when the app was not installed at the time of the click.

```typescript
// Claim by referrer token (from Play Store referrer or clipboard)
const link = await tolinku.deferred.claimByToken('abc123');
if (link) {
  console.log(link.deep_link_path); // e.g. "/merchant/xyz"
}

// Claim by device signal matching
const link = await tolinku.deferred.claimBySignals({
  appspaceId: 'your_appspace_id',
});
```

### In-App Messages

Display visually rich, server-configured messages as modal overlays. Create and manage messages from the Tolinku dashboard without shipping app updates.

```typescript
// Show the highest-priority message matching a trigger
await tolinku.showMessage({ trigger: 'milestone' });

// Dismiss the current message
tolinku.dismissMessage();
```

Messages support components including headings, text blocks, images, buttons, sections, spacers, and dividers. Impression tracking and suppression rules (max impressions, minimum interval, dismiss duration) are handled automatically.

### Smart Banners

Display app install banners that link users to the App Store, Google Play, or a custom URL. Smart banners help convert web visitors into app users with a non-intrusive prompt.

```typescript
// Show a smart banner
await tolinku.showBanner({ position: 'top' });

// Dismiss the banner
tolinku.dismissBanner();
```

Banners include an app icon, title, body text, and a call-to-action button. Dismissal state is tracked so banners do not reappear until the configured duration has passed.

## Configuration Options

```typescript
const tolinku = new Tolinku({
  apiKey: 'tolk_pub_your_api_key',     // Required. Your Tolinku publishable API key.
  baseUrl: 'https://api.tolinku.com', // Optional. API base URL.
});

// Set user identity at any time
tolinku.setUserId('user_123');
```

## API Reference

### `Tolinku`

| Method | Description |
|--------|-------------|
| `new Tolinku(config)` | Create a new SDK instance |
| `setUserId(userId)` | Set or clear the current user ID |
| `track(eventType, properties?)` | Track a custom event |
| `flush()` | Flush queued analytics events |
| `showBanner(options?)` | Display a smart banner |
| `dismissBanner()` | Dismiss the smart banner |
| `showMessage(options?)` | Show an in-app message |
| `dismissMessage()` | Dismiss the in-app message |
| `destroy()` | Clean up all resources |

### `tolinku.analytics`

| Method | Description |
|--------|-------------|
| `track(eventType, properties?)` | Queue a custom event |
| `flush()` | Send all queued events |

### `tolinku.referrals`

| Method | Description |
|--------|-------------|
| `create(options)` | Create a new referral |
| `get(code)` | Get referral details by code |
| `complete(options)` | Mark a referral as converted |
| `milestone(options)` | Update a referral milestone |
| `claimReward(code)` | Claim a referral reward |
| `leaderboard(limit?)` | Fetch the referral leaderboard |

### `tolinku.deferred`

| Method | Description |
|--------|-------------|
| `claimByToken(token)` | Claim a deferred link by token |
| `claimBySignals(options)` | Claim a deferred link by device signals |

## Documentation

Full documentation is available at [tolinku.com/docs](https://tolinku.com/docs).

## Community

- [GitHub](https://github.com/tolinku)
- [X (Twitter)](https://x.com/trytolinku)
- [Facebook](https://facebook.com/trytolinku)
- [Instagram](https://www.instagram.com/trytolinku/)

## License

MIT
