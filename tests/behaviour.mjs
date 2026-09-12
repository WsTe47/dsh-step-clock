#!/usr/bin/env node
/**
 * Behaviour tests for the shipped bundle.
 *
 * These drive the real `lib/client.js` — not the readable source — through the
 * module-loader contract, with a minimal React stand-in, and assert on the text
 * the dock entry actually renders. That is deliberate: the bundle is what
 * ships, and it is produced by text transformations, so testing the source
 * would not prove the shipped artifact is correct.
 *
 * Run: node --test tests/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Load the shipped bundle through a fake module loader and return its exports. */
function loadBundle() {
  const registrations = []
  const previous = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: (entry) => registrations.push(entry) } }
  const source = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const run = new Function('window', source)
  run(globalThis.window)
  globalThis.window = previous

  assert.equal(registrations.length, 1, 'the bundle must register exactly one module')
  const entry = registrations[0]
  assert.equal(entry.id, '@climber47/dsh-step-clock')
  assert.equal(typeof entry.factory, 'function', 'the registration must carry a factory')

  const fakeReact = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
  }
  const exports = entry.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`bundle required an unexpected module: ${name}`)
  })
  return exports
}

const bundle = loadBundle()

/** Flatten a rendered element tree into its visible text. */
function textOf(node) {
  const out = []
  const walk = (current) => {
    if (current === null || current === undefined) return
    if (typeof current !== 'object') {
      out.push(String(current))
      return
    }
    if (Array.isArray(current)) {
      current.forEach(walk)
      return
    }
    ;(current.children ?? []).forEach(walk)
  }
  walk(node)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

let clock = 1_700_000_000_000
const HOUR = 3600_000

/** Build props for one scenario; `sessionId` isolates the module-level records. */
function render({ turnStatus = 'open', steps = [], calls = [], partial = null, sessionId = 'test' }) {
  const timeline = { turnOrder: [7], turns: new Map([[7, { turn: 7, status: turnStatus, steps }]]) }
  const legacy = { runningCalls: calls, partial }
  const props = {
    useChat: (select) => select({ timeline, legacy }),
    timer: { interval: () => () => {} },
    sessionId,
    now: clock,
  }
  return textOf(bundle.StepClock(props))
}

test('bundle exports the expected shape', () => {
  assert.equal(typeof bundle.StepClock, 'function')
  assert.equal(typeof bundle.apply, 'function')
  assert.equal(typeof bundle.CSS, 'string')
  assert.deepEqual(bundle.inject, ['slots', 'timer'])
  // `styles` is a dynamic-plugin evaluator builtin, not a Cordis service. Were
  // it declared here, Cordis would wait for it forever and the plugin would
  // load, report no error, and never render.
  assert.ok(!bundle.inject.includes('styles'), 'inject must not declare the non-existent styles service')
})

test('running tool step names the tool and its own elapsed time', () => {
  clock = 1_700_000_000_000
  const startedAt = clock - 47_000
  const text = render({
    steps: [{ step: 12, status: 'open', start: { time: clock - 60_000 } }],
    calls: [{ name: 'bash', step: 12, time: startedAt }],
  })
  assert.match(text, /正在执行 bash/)
  assert.match(text, /已运行 47 秒/)
  assert.match(text, /第 12 步/)
  assert.match(text, /0:47/)
})

test('parallel calls are counted, not listed one by one', () => {
  clock = 1_700_000_000_000
  const text = render({
    steps: [{ step: 3, status: 'open', start: { time: clock - 5_000 } }],
    calls: [
      { name: 'bash', step: 3, time: clock - 5_000 },
      { name: 'grep', step: 3, time: clock - 4_000 },
      { name: 'read', step: 3, time: clock - 3_000 },
    ],
  })
  assert.match(text, /正在执行 bash/)
  assert.match(text, /另有 2 个工具并行/)
  assert.match(text, /0:05/)
})

test('thinking step reports the step boundary, not a tool', () => {
  clock = 1_700_000_000_000
  const text = render({
    steps: [{ step: 4, status: 'open', start: { time: clock - 23_000 } }],
    partial: { step: 4 },
  })
  assert.match(text, /模型正在思考/)
  assert.match(text, /23 秒/)
})

test('a submitted step with no output yet says it is waiting for the model', () => {
  clock = 1_700_000_000_000
  const text = render({ steps: [{ step: 5, status: 'open', start: { time: clock - 3_000 } }] })
  assert.match(text, /等待模型响应/)
  assert.match(text, /已等待 3 秒/)
})

test('idle with no history says so plainly', () => {
  const text = render({ turnStatus: 'closed', steps: [], sessionId: 'idle-only' })
  assert.match(text, /空闲，等待下一步/)
})

test('a finished step keeps its duration on screen instead of vanishing', () => {
  clock = 1_700_000_000_000
  const session = 'done-record'
  // First render: step is open, so it is being timed.
  render({
    steps: [{ step: 12, status: 'open', start: { time: clock - 225_000 } }],
    calls: [{ name: 'job_output', step: 12, time: clock - 225_000 }],
    sessionId: session,
  })
  // Then the turn closes with both timestamps recorded.
  clock += 1_000
  const text = render({
    turnStatus: 'closed',
    steps: [{ step: 12, status: 'closed', start: { time: clock - 226_000 }, end: { time: clock - 1_000 } }],
    sessionId: session,
  })
  assert.match(text, /上一步（第 12 步）已完成/)
  assert.match(text, /3 分 45 秒/)
  assert.match(text, /3:45/)
})

test('a closed step without timestamps invents nothing', () => {
  const text = render({ turnStatus: 'closed', steps: [{ step: 1, status: 'closed' }], sessionId: 'no-stamps' })
  assert.match(text, /空闲/)
  assert.doesNotMatch(text, /上一步/)
})

test('a missing or partial snapshot renders an idle bar rather than throwing', () => {
  const props = {
    useChat: (select) => select({ timeline: undefined, legacy: undefined }),
    timer: { interval: () => () => {} },
    sessionId: 'empty',
    now: clock,
  }
  assert.match(textOf(bundle.StepClock(props)), /空闲/)
})

test('apply registers one dock seat and inserts its stylesheet on the DOM', () => {
  const tags = []
  const previousDocument = globalThis.document
  globalThis.document = {
    querySelector: () => null,
    createElement: () => {
      const tag = { dataset: {}, textContent: '', remove() {} }
      tags.push(tag)
      return tag
    },
    head: { appendChild: () => {} },
  }

  const calls = []
  const disposed = []
  const ctx = {
    effect: (fn) => {
      disposed.push(fn())
    },
    slots: {
      inject: (slot, callback) => {
        calls.push(['slots.inject', slot])
        callback()
      },
      register: (options) => {
        calls.push(['slots.register', options.name, options.id, options.order])
        return () => {}
      },
    },
  }
  bundle.apply(ctx)
  globalThis.document = previousDocument

  const registered = calls.filter((entry) => entry[0] === 'slots.register')
  assert.equal(registered.length, 1, 'exactly one seat must be registered')
  assert.deepEqual(
    registered.map((entry) => [entry[1], entry[2]]),
    [['conversation.input.dock', 'step-clock']],
  )
  assert.equal(tags.length, 1, 'apply must insert exactly one style tag')
  assert.ok(disposed.length >= 1, 'the stylesheet must be owned by a fiber effect')
  assert.ok(
    disposed.every((value) => typeof value === 'function'),
    'every effect must return a disposer',
  )
})

test('the time formatter widens past an hour instead of printing 60+ minutes', () => {
  clock = 1_700_000_000_000
  const text = render({
    steps: [{ step: 1, status: 'open', start: { time: clock - HOUR - 90_000 } }],
    calls: [{ name: 'bash', step: 1, time: clock - HOUR - 90_000 }],
    sessionId: 'long-run',
  })
  assert.match(text, /1 小时 1 分/)
  assert.match(text, /1:01:30/)
})

test('the previous step stays visible once the next Turn is open but idle', () => {
  clock = 1_700_000_000_000
  const session = 'next-turn-idle'
  // Turn 1 finishes with a measurable step.
  render({
    turnStatus: 'closed',
    steps: [{ step: 122, status: 'closed', start: { time: clock - 225_000 }, end: { time: clock - 1_000 } }],
    sessionId: session,
  })
  // Turn 2 opens but has produced no step yet: the record must survive.
  const text = render({
    turnStatus: 'open',
    steps: [],
    sessionId: session,
  })
  assert.match(text, /上一步（第 122 步）已完成/)
  assert.doesNotMatch(text, /空闲/)
})

test('a Turn the engine reopens still records its newly finished step', () => {
  clock = 1_700_000_000_000
  const session = 'reopened-turn'
  // Same turn number closes twice — follow-up work reopens it. A turn-keyed
  // guard would freeze on the first close and never report the second step.
  render({
    turnStatus: 'closed',
    steps: [{ step: 5, status: 'closed', start: { time: clock - 10_000 }, end: { time: clock - 1_000 } }],
    sessionId: session,
  })
  clock += 60_000
  const text = render({
    turnStatus: 'closed',
    steps: [
      { step: 5, status: 'closed', start: { time: clock - 10_000 }, end: { time: clock - 1_000 } },
      { step: 6, status: 'closed', start: { time: clock - 900_000 }, end: { time: clock - 300_000 } },
    ],
    sessionId: session,
  })
  assert.match(text, /上一步（第 6 步）已完成/)
  assert.match(text, /10 分钟/)
})

test('a fresh load whose newest Turn is already closed still reports that step', () => {
  clock = 1_700_000_000_000
  const text = render({
    turnStatus: 'closed',
    steps: [{ step: 122, status: 'closed', start: { time: clock - 225_000 }, end: { time: clock - 1_000 } }],
    sessionId: 'fresh-load',
  })
  assert.match(text, /上一步（第 122 步）已完成/)
  assert.match(text, /3 分 44 秒/)
})

test('the bundle never reaches for a styles service', () => {
  const source = readFileSync(join(root, 'lib/client.js'), 'utf8')
  assert.doesNotMatch(source, /ctx\.styles/, 'a client plugin has no ctx.styles')
  assert.match(source, /document\.createElement\('style'\)|document\.createElement\("style"\)/)
})

test('insertStyles owns one tag and its disposer removes it', () => {
  const created = []
  const previousDocument = globalThis.document
  const makeTag = () => {
    const tag = { dataset: {}, textContent: '', removed: false, remove() { this.removed = true } }
    created.push(tag)
    return tag
  }
  globalThis.document = {
    querySelector: () => null,
    createElement: (name) => {
      assert.equal(name, 'style')
      return makeTag()
    },
    head: { appendChild: (tag) => { tag.appended = true } },
  }
  const dispose = bundle.insertStyles()
  assert.equal(created.length, 1, 'exactly one style tag')
  assert.equal(created[0].appended, true, 'the tag must be appended')
  assert.equal(created[0].dataset.pluginCss, '@climber47/dsh-step-clock/step-clock.css')
  assert.ok(created[0].textContent.length > 0, 'the tag must carry the stylesheet')
  dispose()
  assert.equal(created[0].removed, true, 'the disposer must remove the tag')
  globalThis.document = previousDocument
})

test('styling outside a browser degrades to a no-op instead of throwing', () => {
  const previousDocument = globalThis.document
  delete globalThis.document
  const dispose = bundle.insertStyles()
  assert.equal(typeof dispose, 'function')
  dispose()
  globalThis.document = previousDocument
})

test('tool names render as their own chip element, not only inside the sentence', () => {
  // Regression for a mutation that survived the suite: turning chips off entirely
  // kept every assertion green, because the tool names also appear in the prose.
  clock = 1_700_000_000_000
  const timeline = {
    turnOrder: [7],
    turns: new Map([[7, {
      turn: 7,
      status: 'open',
      steps: [{ step: 3, status: 'open', start: { time: clock - 5_000 } }],
    }]]),
  }
  const legacy = {
    runningCalls: [
      { name: 'bash', step: 3, time: clock - 5_000 },
      { name: 'grep', step: 3, time: clock - 4_000 },
    ],
    partial: null,
  }
  const tree = bundle.StepClock({
    useChat: (select) => select({ timeline, legacy }),
    timer: { interval: () => () => {} },
    sessionId: 'chip-structure',
    now: clock,
  })
  const classes = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.props && node.props.className) classes.push(node.props.className)
    ;(node.children ?? []).forEach(walk)
  }
  walk(tree)
  const chip = classes.find((name) => name.includes('dsh-stepclock-chip'))
  assert.ok(chip !== undefined, 'a dedicated chip element must exist for the tool names')
})

test('two parallel tools are reported as a count, and the chip lists both', () => {
  clock = 1_700_000_000_000
  const text = render({
    steps: [{ step: 3, status: 'open', start: { time: clock - 5_000 } }],
    calls: [
      { name: 'bash', step: 3, time: clock - 5_000 },
      { name: 'grep', step: 3, time: clock - 4_000 },
    ],
    sessionId: 'chip-count',
  })
  assert.match(text, /另有 1 个工具并行/)
  assert.match(text, /bash · grep/)
})

test('an unknown anchor shows an em dash instead of pretending it just started', () => {
  clock = 1_700_000_000_000
  // An open step whose start time is absent, and no running call to anchor on.
  const text = render({
    steps: [{ step: 9, status: 'open' }],
    calls: [],
    sessionId: 'no-anchor',
  })
  assert.match(text, /--:--/)
  assert.doesNotMatch(text, /0:00/)
})
