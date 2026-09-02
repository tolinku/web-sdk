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

# Changelog

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
