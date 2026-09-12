/**
 * @crimber47/dsh-step-clock — host half.
 *
 * This plugin is browser-only: every piece of behaviour is the dock entry in
 * the client half (`src/client/index.js`, served from `lib/client.js` as the
 * package's `./client` export and declared through `dsh.client` in
 * package.json). The host half therefore contributes nothing at runtime.
 *
 * It still exists, and is still loaded, because a dsh bundle's inserted row
 * resolves the package root: a package that could not be imported would not
 * mount. Both exports below are the empty, valid shape for that contract.
 *
 * @module @crimber47/dsh-step-clock
 */

/** No services are required: the host half registers nothing. */
export const inject = []

/**
 * Mount the (empty) host half.
 *
 * The client half is loaded independently by the client module host, which
 * scans installed packages for a `dsh.client` declaration; it does not depend
 * on anything this function does.
 */
export function apply() {}
