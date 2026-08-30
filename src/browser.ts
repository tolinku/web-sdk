/**
 * The build behind the CDN script tag.
 *
 * A plain <script src> needs a browser global. The ESM and CJS builds are
 * modules: dropping dist/index.js into a script tag fails on `exports is not
 * defined`, so a page following the copy-and-paste snippet got nothing.
 *
 * The global is the class itself rather than the module namespace, so the
 * snippet reads `new Tolinku({ ... })`, the same call the npm instructions use.
 * TolinkuError hangs off it for anyone who wants to check an error type without
 * a second global.
 */
import { Tolinku, TolinkuError } from './index.js';

(Tolinku as unknown as { TolinkuError: typeof TolinkuError }).TolinkuError = TolinkuError;
(globalThis as unknown as { Tolinku: typeof Tolinku }).Tolinku = Tolinku;

export { Tolinku, TolinkuError };
