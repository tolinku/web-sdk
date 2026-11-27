# Changelog

## 0.8.3

### Changed
- Smart banners show only in phone browsers (iPhone, iPad and Android), the
  same as the banner.js script tag. On a computer there is no app to open, and
  the dashboard has always said banners only show on phones; the SDK was the
  one place that drew them on desktop too. A site that wants them there passes
  `allowDesktop: true` to `banners.show()`. On a computer the SDK no longer
  asks for the banner config at all.
- The banner's close mark has a 44px tap area, the minimum Apple and Google
  recommend for a phone. It looks exactly the same and the layout doesn't move;
  only the area that answers a tap is bigger.

## 0.8.2

### Added

- Smart banners report when they are shown and when they are closed.

  Until now the dashboard knew a banner had been tapped and nothing else: a
  view was logged once per page load without saying which banner, and a close
  was remembered only in the visitor's own storage. So there was no tap rate
  for any one banner, and no way to see that people were closing it. The
  dashboard's banner pages now show views, tap rate and closes per banner.

  Sent as plain-text beacons, which browsers deliver cross-origin without a
  preflight, and never awaited: a banner that cannot report still works. Taps
  use the same plain-text beacon now; the server accepts either form. The page
  goes without its query string, which can carry tokens.

- In-app messages report when they are shown, closed, and when a button is
  tapped, the same way. On iOS, Android, Flutter and React Native the message's
  own page does this, so those SDKs need no update; this covers messages the
  web SDK draws itself. The publishable key travels in the beacon body, since a
  beacon can't set headers. A tapped URL longer than 1000 characters is cut
  short, to keep the beacon under the server's 2 KB limit.

  Release the platform first: it adds the two endpoints and teaches the tap
  endpoint to read a plain-text body. Against an older server a view or close
  goes nowhere, and a tap is still counted but without saying which banner.

### Changed

- Links.resolve unwraps links from emails (SendGrid, Amazon SES, Braze, Klaviyo,
  Iterable, Salesforce Marketing Cloud, Customer.io). It sends the whole link
  along with the path, cleaned up first: no fragment, scheme and host in lower
  case, http upgraded to https, and no default port.

  It asks the link's own host once, with a 5 second time limit and no retries,
  since each request counts a click. If that host is Tolinku and says no, that
  is the answer. If it gives no Tolinku answer at all (on the web a
  click-tracking host usually refuses the request under CORS), and it isn't the
  configured Tolinku API host, it asks the Tolinku API once more, the same way,
  with the publishable key. Either answer gets the same checks as before, and
  resolve still never throws.

## 0.8.1

### Added

- `DeferredLink.url`, the absolute URL for a claimed link.

  The same field the four mobile SDKs gained in 0.8.1, so a claim reads the same
  whichever SDK an app moves between. There it is what `trackLinkOpen` has to be
  given, because reporting an open needs the host and a device cannot know it.
  On the web there is nothing to report: a page load already reached us and was
  counted when it was served.

  It is here because the server sends it either way. Typed without it, the field
  arrived at runtime and was invisible, so a caller who wanted the absolute URL
  had to cast to reach a value that was already there. Optional, since older
  servers do not send it.

  No behaviour changed. Nothing in this SDK reads the field.

## 0.8.0

### Added

- Smart banners now report when their call to action is tapped.

  The button was a plain link with no handler, so a tap navigated and the
  server never heard about it. No traffic was lost, because the destination is
  a Tolinku link and arrives as a click either way, but nothing recorded which
  banner earned it and the "Banner Clicks" figure on your dashboard could only
  ever read zero. It can now show real numbers, and installs can be traced back
  to the banner that produced them.

  The button keeps its real destination and opens exactly as before. The report
  goes out alongside the navigation through `sendBeacon`, which the browser
  delivers even as the page is being left. Routing the button through a
  counting endpoint instead would have put a round trip in front of a tap whose
  whole job is to feel instant, and would have broken the banner outright
  whenever that endpoint was slow or down.

  Reporting never throws and never blocks. A banner that cannot report a tap
  still opens the link.

- Nothing to change in your integration. This is automatic for any banner
  rendered by this package.

## 0.7.0

Maintenance only. The shipped JavaScript is byte for byte identical to 0.6.1
and the exported type surface is unchanged, so there is nothing here you need
to act on. It carries a version because all five SDKs moved to 0.7.0 together,
not because anything in this package changed for callers.

The generated declarations were checked against TypeScript 5.0, 5.4, 5.9 and
6.0: they parse on all of them, so emitting them with TypeScript 6 does not
raise the TypeScript version you need.

### Changed

- Dev tooling: TypeScript 5.4 to 6.0, tsup 8 to 9, vitest 3 to 5, jsdom 28 to
  31. CI moves to Node 24, which jsdom 31 requires. All ten of the advisories
  reported against the dev dependency tree are resolved.

- TypeScript 7 was not taken. It ships no JavaScript compiler API, which is
  what tsup uses to generate the `.d.ts` files this package publishes, and the
  compatibility package for it does not currently work with tsup either. 6.0 is
  the last line that can emit our types.

## 0.6.1

### Fixed

In-app messages now render what the builder shows. Everything below was
something an author could do in the dashboard, see in the preview, publish, and
have end users receive as nothing at all or as something else.

- **Sections rendered empty.** Puck stores a section's children under
  `zones["<id>:content"]`, and this SDK read `props.children`, which Puck never
  writes. Every section was an empty box and everything inside it was lost.
- **A deep link in a call to action did nothing.** Button URLs were checked
  against an http/https allowlist, so `myapp://order/4821`, the most natural
  CTA in an in-app message on a deep linking platform, was refused before the
  host app's own handler was called. The check is now the denylist the platform
  itself uses, so any scheme but the ones that can run code will open.
- **An authored zero was thrown away.** `borderRadius: 0`, `padding: 0` and the
  rest were replaced by the default, and every stock template ships
  `borderRadius: 0` on its images, so their corners were rounded anyway.
- **Image sizes were read wrongly.** The width and height fields are free text
  whose own labels offer "auto", "200" and "200px". Height was not applied at
  all here, and a width of "auto" became the invalid "autopx".
- **Button styles were ignored.** Outline and soft buttons rendered as solid
  blocks. Since the text colour is labelled "filled only", authors leave it
  white, so those arrived as white on light: an invisible call to action. Emoji
  was dropped, a button that was not full width stretched anyway, and an action
  of "close" navigated instead of dismissing.
- **Markdown links were shown as brackets and a raw URL**, though the field
  label promises them and the preview drew them.
- **The message surface was ignored.** Background colour, gradient, image,
  padding, width and vertical alignment were all authored and none applied, so
  a message designed on a gradient arrived as a plain white card.
- **AppIcon, StoreButtons and DeepLinkButton rendered nothing.** They describe
  the app rather than the message, and the API now sends that context with the
  messages, so all three draw.
- **A message with only a title and body showed an empty card.** Both are now
  rendered when there is no designed content.
- Spacing matches the other renderers, so a message is the height it was
  designed to be.
- A section whose zone names itself recursed until the stack gave out, and that
  throw escapes `show()`, so nothing was drawn at all. Nesting is capped, and
  content that is not the shape it should be falls back rather than throwing.
- A soft button whose colour could not be tinted drew its label in the colour of
  its own background. It falls back to filled, which is readable.
- A protocol-relative markdown link was treated as local, so it replaced the
  page with another origin and carried no `rel="noopener noreferrer"`.
- Store badges navigated past `onButtonPress`, which replaced an integrator's
  own WebView. A gradient could carry a `url()` and fire a request from the
  viewer's browser. A negative number produced no CSS at all rather than a
  visible fallback.

### Added

- `MessageAppContext`, the app a message belongs to, as returned alongside
  `/v1/api/messages`.
- `MessageContent.zones`, which was missing from the type entirely.

## 0.6.0

### Added

- `tolinku.links.resolve(url)` turns a link into the route and token it means.

  On the open web this rarely comes up: a browser follows a short link to
  Tolinku, which resolves it and serves the page, so nothing on the page ever
  sees an unreadable URL.

  Inside a Capacitor or Cordova app it comes up constantly. There the operating
  system hands the web layer the URL that was tapped, exactly as written, and
  the routing happens in JavaScript. A short link arrives as an opaque code,
  `/s7k2p9q/4821`, and nothing in it says which route it is. Code parsing the
  path itself sees a first segment it has never heard of and does nothing, so
  the link opens the app and then appears to fail: no error, no screen, no clue.

  ```js
  const link = await tolinku.links.resolve(url);
  if (link) route(link.deep_link_path); // "/order/4821/receipt"
  ```

  A readable URL comes back unchanged, so everything can be resolved rather than
  guessing which kind it is. The question goes to the link's own host, which is
  how Tolinku knows the Appspace, so a link on someone else's domain answers
  nothing, and no API key goes with it. Never throws.

  Needs a platform new enough to answer for a whole path on `/v1/api/path`.

### Fixed

- Referral links shared in short form could open a Capacitor or Cordova app
  without the referral code reaching it. Resolve incoming links with
  `links.resolve` and the code arrives with the rest of the link.

## 0.5.0

### Changed

- Version bumped alongside the other SDKs. This one gains no `trackLinkOpen`:
  a browser visiting a Tolinku link always reaches the server, so the tap is
  already recorded and reporting it would count one visit twice.

## 0.4.1

### Added

- Every request now carries `X-Tolinku-SDK: web/<version>`, so the SDK version in
  the field is knowable. The other Tolinku SDKs say this in `User-Agent`, which a
  browser will not let a script set, so this SDK sent no version at all and a
  web integration could not be identified or a version-specific bug traced to a
  version. `SDK_VERSION` is exported, and a test fails if it drifts from
  package.json.

## 0.4.0

### Added

- `claimDeferredLink()` recovers the link that led here and remembers that it
  did. There is no Play Install Referrer on the web, so this is signal matching
  with the bookkeeping that makes calling it safe, matching the call of the same
  name on the Android, React Native and Flutter SDKs.

  The bookkeeping is the point. A claim is consumed the first time it succeeds,
  so an app calling `claimBySignals` on every page load asks again after the
  answer is spent, and each of those is recorded as a miss. The match rate on
  the dashboard then falls towards zero while the integration is working
  correctly, which is difficult to diagnose from the outside.

  Only a settled answer is remembered. A dropped request, or a 403 from the
  wrong `appspaceId`, leaves the next run free to try again rather than spending
  the one chance at attribution on a bad connection or a typo.

- `dist/tolinku.min.js`, a browser build for the script tag the dashboard hands
  out. Nothing in the package could previously be loaded that way: `index.js` is
  CommonJS and fails on `exports is not defined` the moment a browser runs it.
  The global is the class, so it is `new Tolinku({ apiKey, baseUrl })`, the same
  call as the npm path.

### Unchanged

- `claimBySignals()` behaves exactly as before and is not deprecated. It asks
  every time it is called; remembering is what `claimDeferredLink()` adds.

## 0.3.0

### Fixed

- **Deferred deep link signal matching.** The signals sent for `claimBySignals` did not
  match the values recorded by the landing page, so some of them could never contribute
  to a match. See the per-SDK notes below.
- `claimBySignals` no longer reports a configuration error as a plain "no match". A `403`
  (wrong `appspaceId`) is now surfaced with an explanation instead of being swallowed.

  Note `appspaceId` is your Appspace ID, copied from the dashboard under Settings. It is
  not your subdomain or slug. Sending the slug was the cause of the report behind this
  release, and now produces an explicit error rather than a silent null.
- Signals were already correct in this SDK; only the error reporting changed.
- Also includes the smart banner work carried on this unreleased version.
- Matching now also compares device pixel ratio and OS version, and reports them
  automatically where the platform exposes them.
