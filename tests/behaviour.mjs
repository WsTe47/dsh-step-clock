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
  assert.deepEqual(bundle.inject, ['slots', 'styles', 'timer'])
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

test('apply registers one dock seat and owns its stylesheet', () => {
  const calls = []
  const ctx = {
    styles: {
      insert: (css) => {
        calls.push(['styles.insert', typeof css === 'string' && css.length > 0])
        return () => {}
      },
    },
    effect: (fn) => {
      fn()
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
  const registered = calls.filter((entry) => entry[0] === 'slots.register')
  assert.equal(registered.length, 1, 'exactly one seat must be registered')
  assert.deepEqual(
    registered.map((entry) => [entry[1], entry[2]]),
    [['conversation.input.dock', 'step-clock']],
  )
  assert.ok(
    calls.some((entry) => entry[0] === 'styles.insert' && entry[1] === true),
    'the stylesheet must be inserted',
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
