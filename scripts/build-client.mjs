#!/usr/bin/env node
/**
 * Generate lib/client.js (the shipped browser bundle) from src/client/*.js.
 *
 * A dsh client bundle is not an ES module: the module loader evaluates it as a
 * script that only REGISTERS a factory —
 *
 *     window.__ModuleLoader__.load({ id, factory })
 *
 * and every module-body side effect (including CSS injection) lives inside that
 * factory closure, running at materialization rather than at script execution.
 * React is resolved through the loader's `require` instead of being bundled.
 *
 * This script keeps the shipped bundle derived from the readable source in
 * src/client/ so the two cannot drift. It performs the two mechanical
 * transformations that difference requires:
 *
 *   1. strip the `import`/`export` keywords, since the bundle is a CommonJS
 *      factory rather than a module;
 *   2. alias the bare `React` identifier onto `require('react')`, so the
 *      component source can stay in the plain style a reader expects.
 *
 * Both are keyword/identifier-level text edits, not a parser. The output is
 * checked by `node --check` and exercised by tests/behaviour.mjs, which fails
 * loudly if either transformation stops matching the source.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ID = '@climber47/dsh-step-clock'

/** Read one source file, stripping its module syntax. */
function moduleBody(relative) {
  const text = readFileSync(join(root, relative), 'utf8')
  const stripped = text.replace(/^import\s[^\n]*\n/gm, '').replace(/^export\s+(?=(?:const|function|async function|class))/gm, '')
  if (/^\s*(?:import|export)\s/m.test(stripped)) {
    throw new Error(`${relative}: an import/export the builder does not understand survived stripping`)
  }
  return stripped.trim()
}

const styles = moduleBody('src/client/styles.js')
const component = moduleBody('src/client/index.js')

// The component source names `React` directly; bind it to the loader-provided
// module. `react` is also aliased for the handful of sites that use the long form.
const preamble = `		let react = require("react");
		const React = react;`

const output = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(PACKAGE_ID)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${preamble}
//#region src/client/styles.js
${styles}
//#endregion
//#region src/client/index.js
${component}
//#endregion
		exports.StepClock = StepClock;
		exports.CSS = CSS;
		exports.insertStyles = insertStyles;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
`

// A declared service that no provider offers makes Cordis park the plugin
// forever without throwing, so a typo here is a silent no-render bug. `styles`
// in particular is a dynamic-plugin evaluator builtin, NOT a service: it is
// passed into the dynamic sandbox, and never provided on a client context.
const SERVICE_ALLOWLIST = new Set(['slots', 'timer', 'theme', 'locale', 'sessions', 'remote'])
// `component` already had its module syntax stripped, so match without `export`.
const declared = /const inject = \[([^\]]*)\]/.exec(component)
if (declared === null) throw new Error('src/client/index.js no longer declares `inject`')
const names = declared[1]
  .split(',')
  .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
  .filter((part) => part !== '')
for (const name of names) {
  if (!SERVICE_ALLOWLIST.has(name)) {
    throw new Error(
      `inject declares "${name}", which is not a known client service. ` +
        'Cordis would wait for it forever and the plugin would never render. ' +
        'If this is a genuine service, add it to SERVICE_ALLOWLIST deliberately.',
    )
  }
}
if (output.includes('ctx.styles')) {
  throw new Error('the bundle references ctx.styles, which does not exist for a client plugin')
}

const target = join(root, 'lib/client.js')
writeFileSync(target, output)
console.log(`built ${target} (${output.length} bytes)`)
