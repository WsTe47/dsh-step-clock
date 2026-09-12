window.__ModuleLoader__.load({
	id: "@crimber47/dsh-step-clock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const React = react;
//#region src/client/styles.js
/**
 * @crimber47/dsh-step-clock — browser half styles.
 *
 * Kept beside the component so the bundle's injected stylesheet has a readable
 * source. Colours and geometry come from dsh theme tokens and the composer
 * layout variables, with fallbacks so a missing token degrades instead of
 * breaking the bar. The `--dsh-composer-*` variables are declared on the
 * conversation root, which is an ancestor of both dock seats.
 *
 * @module @crimber47/dsh-step-clock/client/styles
 */

const CSS = [
  // The dock row is full viewport width; this wrapper centres a composer-width
  // column inside it, mirroring the shipped GoalBar dock convention.
  '.dsh-stepclock-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));margin:0 auto;}',
  '.dsh-stepclock-root{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width,780px) - 4 * var(--dsh-composer-dock-inset,8px));margin:0 auto;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;}',
  // A filled dot marks real activity; a hollow one marks an idle bar.
  '.dsh-stepclock-dot{flex:none;align-self:center;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);}',
  '.dsh-stepclock-dot-idle{flex:none;align-self:center;width:8px;height:8px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);}',
  '.dsh-stepclock-say{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);}',
  '.dsh-stepclock-where{flex:none;opacity:.6;font-size:12px;}',
  '.dsh-stepclock-time{flex:none;color:var(--dsw-alias-brand-primary);font-weight:600;font-size:15px;}',
  '.dsh-stepclock-chip{flex:none;max-width:22em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:16px;}',
  '.dsh-stepclock-mono{font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}',
].join('')
//#endregion
//#region src/client/index.js
/**
 * @crimber47/dsh-step-clock — browser half (readable source).
 *
 * The shipped file is `lib/client.js`, which wraps this component in the
 * `window.__ModuleLoader__.load({ id, factory })` registration shape a dsh
 * client bundle must have. This file is the same logic kept readable so a
 * reader can review what the package does without unwrapping the bundle.
 *
 * What it does
 * ------------
 * Renders one ambient entry in the composer dock while an agent step is
 * running, in plain language:
 *
 *     正在执行 bash，已运行 1 分 12 秒    第 12 步   [bash]        1:12
 *
 * and keeps the finished step on screen once it ends:
 *
 *     上一步（第 12 步）已完成，用时 3 分 45 秒                    3:45
 *
 * Why the second line matters
 * ---------------------------
 * A step is often over in under a second, so a bar that only exists *during*
 * a step is easy to miss entirely. Holding the last step's duration until the
 * next step replaces it means a slow step can be identified after the fact.
 * The record is only kept when the step's own `start` and `end` timestamps are
 * both available; when they are not, the bar says it is idle rather than
 * inventing a duration.
 *
 * It reads the live facts the engine already publishes rather than polling
 * anything itself:
 *
 *   - the open Turn and its open Step, from the Chat timeline snapshot, give
 *     the step number and the step's start time;
 *   - `legacy.runningCalls` holds one entry per in-flight Tool call and exists
 *     only while that call is in flight, so its `time` is the exact moment the
 *     call started — this is what makes "bash has been running 47s" precise
 *     instead of an estimate;
 *   - `legacy.partial` tells whether the model is currently streaming, which
 *     separates "thinking" from "waiting for the model".
 *
 * The clock ticks from 0s with no delay threshold.
 *
 * @module @crimber47/dsh-step-clock/client
 */


/** Tool names named inline before collapsing the remainder into `+N`. */
const MAX_NAMES = 4

/**
 * Last-finished-step records, keyed by session so two open conversations never
 * clash. Module-level so the record survives re-renders.
 */
const RECORDS = new Map()

/** Floor a duration to whole seconds. */
function secondsOf(ms) {
  return Math.max(0, Math.floor(ms / 1000))
}

/**
 * Natural-language duration: `47 秒` / `1 分 12 秒` / `1 小时 3 分`.
 * An exact minute drops the redundant `0 秒`; hours imply minutes.
 * @param ms - duration in milliseconds.
 * @returns the display string.
 */
function humanDuration(ms) {
  const total = secondsOf(ms)
  if (total < 60) return total + ' 秒'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    const rest = total % 60
    return rest === 0 ? minutes + ' 分钟' : minutes + ' 分 ' + rest + ' 秒'
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? hours + ' 小时' : hours + ' 小时 ' + restMinutes + ' 分'
}

/**
 * Compact clock for the right edge: `m:ss`, widening to `h:mm:ss` past an hour.
 * @param ms - duration in milliseconds.
 * @returns the display string.
 */
function clockOf(ms) {
  const total = secondsOf(ms)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const pad = function (value) {
    return (value < 10 ? '0' : '') + value
  }
  if (minutes < 60) return minutes + ':' + pad(seconds)
  return Math.floor(minutes / 60) + ':' + pad(minutes % 60) + ':' + pad(seconds)
}

/** Newest Turn still open in the loaded timeline, or null. */
function latestOpenTurn(timeline) {
  if (timeline === undefined || timeline === null) return null
  const order = timeline.turnOrder
  const turns = timeline.turns
  if (order === undefined || turns === undefined || typeof turns.get !== 'function') return null
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const turn = turns.get(order[index])
    if (turn !== undefined && turn !== null && turn.status === 'open') return turn
  }
  return null
}

/** Newest Step of a Turn, when it is still open. */
function openStepOf(turn) {
  const steps = turn.steps
  if (steps === undefined || steps.length === 0) return null
  const step = steps[steps.length - 1]
  if (step === undefined || step === null || step.status !== 'open') return null
  return step
}

/** Newest Turn in the loaded timeline whatever its status — the idle record source. */
function latestTurn(timeline) {
  if (timeline === undefined || timeline === null) return null
  const order = timeline.turnOrder
  const turns = timeline.turns
  if (order === undefined || turns === undefined || typeof turns.get !== 'function' || order.length === 0) return null
  return turns.get(order[order.length - 1])
}

/** Read or create this session's record slot. */
function recordFor(sessionKey) {
  const existing = RECORDS.get(sessionKey)
  if (existing !== undefined) return existing
  const fresh = { final: null, pending: null, seenTurn: null, seenStep: null }
  RECORDS.set(sessionKey, fresh)
  return fresh
}

/**
 * The dock entry component.
 *
 * Receives only standard slot props: `useChat` selects from the live Chat
 * snapshot (driving re-render on every engine update) and `timer` supplies a
 * disposable interval, so nothing here creates a process-wide side effect.
 */
function StepClock(props) {
  const useChat = props.useChat
  const timer = props.timer
  const label = props.label === undefined ? '' : props.label
  const sessionKey = props.sessionId === undefined ? 'default' : String(props.sessionId)
  // Wall clock, injectable so the duration maths is testable without freezing time.
  const now = props.now === undefined ? Date.now() : props.now
  const hold = React.useState(0)
  const tick = hold[0]
  const bump = hold[1]
  const timeline = useChat(function (snapshot) {
    return snapshot.timeline
  })
  const legacy = useChat(function (snapshot) {
    return snapshot.legacy
  })

  const turn = latestOpenTurn(timeline)
  const step = turn === null ? null : openStepOf(turn)
  const stepNumber = step === null ? 0 : step.step
  const stepStart =
    step !== null && step.start !== undefined && step.start !== null && typeof step.start.time === 'number'
      ? step.start.time
      : null

  const runningCalls =
    legacy === undefined || legacy === null || legacy.runningCalls === undefined || legacy.runningCalls === null
      ? []
      : legacy.runningCalls
  const partial = legacy === undefined || legacy === null ? null : legacy.partial

  let firstCallTime = null
  const names = []
  let callCount = 0
  for (let index = 0; index < runningCalls.length; index += 1) {
    const call = runningCalls[index]
    if (call === undefined || call === null) continue
    if (call.step !== stepNumber) continue
    callCount += 1
    if (typeof call.time === 'number' && (firstCallTime === null || call.time < firstCallTime)) firstCallTime = call.time
    if (typeof call.name === 'string' && call.name !== '' && names.indexOf(call.name) < 0) names.push(call.name)
  }

  const thinking = stepNumber > 0 && partial !== null && partial !== undefined && partial.step === stepNumber

  // A running Tool call is the most precise anchor there is: it starts when the
  // call is logged and disappears when the result lands. Thinking falls back to
  // the step boundary, the closest honest anchor for model time.
  let anchor = firstCallTime
  if (anchor === null && thinking && stepStart !== null) anchor = stepStart
  if (anchor === null) anchor = stepStart

  // Always ticking: an active clock needs it, and the idle record has to reveal
  // itself once its duration is worth reporting.
  React.useEffect(function () {
    const dispose = timer.interval(function () {
      bump(function (value) {
        return value + 1
      })
    }, 500)
    return function () {
      if (typeof dispose === 'function') dispose()
    }
  }, [])

  const live = turn !== null && step !== null

  // Record the step of any closed Turn.
  //
  // Keyed on (turn, step) rather than on the turn alone: the engine reopens a
  // finished Turn when follow-up work arrives, so a Turn can close more than
  // once, and a turn-keyed guard would silently stop updating after the first
  // close. Recording also runs while a Turn is live, which is what lets a
  // reopened Turn's newly finished step land without waiting for it to close
  // again.
  //
  // Only a step whose own `start` AND `end` are both present is recorded; an
  // absent pair means the loaded window does not carry the evidence, and the
  // bar reports itself idle rather than inventing a duration.
  const record = recordFor(sessionKey)
  const candidate = latestTurn(timeline)
  if (candidate !== undefined && candidate !== null) {
    const steps = candidate.steps
    const last = steps === undefined || steps === null || steps.length === 0 ? null : steps[steps.length - 1]
    if (last !== undefined && last !== null && last.status !== 'open') {
      const began = last.start === undefined || last.start === null ? null : last.start.time
      const ended = last.end === undefined || last.end === null ? null : last.end.time
      if (typeof began === 'number' && typeof ended === 'number' && ended >= began) {
        if (record.seenTurn !== candidate.turn || record.seenStep !== last.step) {
          record.final = record.pending
          record.pending = { turn: candidate.turn, step: last.step, ms: ended - began, closedAt: now }
          record.seenTurn = candidate.turn
          record.seenStep = last.step
        }
      }
    }
  }

  let say = ''
  let where = ''
  let clock = ''
  let tone = 'idle'
  let chips = []
  const shown = record.pending === null ? record.final : record.pending

  if (live) {
    tone = 'active'
    const elapsedMs = anchor === null ? 0 : now - anchor
    if (callCount > 0) {
      chips = names.length > MAX_NAMES ? names.slice(0, MAX_NAMES).concat('+' + (names.length - MAX_NAMES)) : names
      const lead = names.length > 0 ? '正在执行 ' + names[0] : '正在执行工具'
      say =
        callCount > 1
          ? lead + '，另有 ' + (callCount - 1) + ' 个工具并行，本步已运行 ' + humanDuration(elapsedMs)
          : lead + '，已运行 ' + humanDuration(elapsedMs)
      where = '第 ' + stepNumber + ' 步'
    } else if (thinking) {
      say = '模型正在思考，本步已耗时 ' + humanDuration(elapsedMs)
      where = '第 ' + stepNumber + ' 步'
    } else {
      say = '已提交，正在等待模型响应，已等待 ' + humanDuration(elapsedMs)
      where = '第 ' + stepNumber + ' 步'
    }
    clock = clockOf(elapsedMs)
  } else if (shown !== null) {
    // No step is running (yet). Keep reporting the previous step, so the gap
    // between a Turn closing and the next step starting — and a fresh page load
    // whose newest Turn is already closed — both stay informative.
    tone = 'done'
    say = '上一步（第 ' + shown.step + ' 步）已完成，用时 ' + humanDuration(shown.ms)
    clock = clockOf(shown.ms)
  } else {
    say = '空闲，等待下一步'
  }

  const children = []
  children.push(
    React.createElement('span', {
      key: 'dot',
      className: tone === 'idle' ? 'dsh-stepclock-dot-idle' : 'dsh-stepclock-dot',
    }),
  )
  children.push(React.createElement('span', { key: 'say', className: 'dsh-stepclock-say' }, say))
  if (where !== '') children.push(React.createElement('span', { key: 'where', className: 'dsh-stepclock-where' }, where))
  if (chips.length > 0) {
    children.push(
      React.createElement(
        'span',
        { key: 'chips', className: 'dsh-stepclock-chip', title: names.join(' + ') },
        chips.join(' · '),
      ),
    )
  }
  if (clock !== '') {
    children.push(React.createElement('span', { key: 'clock', className: 'dsh-stepclock-time dsh-stepclock-mono' }, clock))
  }

  return React.createElement(
    'div',
    { className: 'dsh-stepclock-dock' },
    React.createElement(
      'div',
      { className: 'dsh-stepclock-root', role: 'status', 'aria-live': 'off', title: label + ' ' + say },
      children,
    ),
  )
}

/**
 * Services this plugin waits for before applying.
 *
 * Declared rather than assumed: `styles` and `slots` are owned by the renderer
 * module, and Cordis parks this plugin until they exist instead of calling
 * `apply` with a half-built context. `timer` supplies the ticking interval.
 */
const inject = ['slots', 'styles', 'timer']

/**
 * Register the dock entry.
 *
 * A single additive entry in `conversation.input.dock` (the strip above the
 * composer, beside the todo / goal / queue bars). `replaceRisk: none`: a fresh
 * `id` is added beside the shipped entries rather than replacing any of them.
 */
function apply(ctx) {
  ctx.effect(function () {
    return ctx.styles.insert(CSS)
  })
  const mount = function (slot, id, order, label) {
    ctx.slots.inject(slot, function () {
      return ctx.slots.register({ name: slot, id: id, order: order }, function (props) {
        return React.createElement(StepClock, {
          useChat: props.useChat,
          timer: ctx.timer,
          sessionId: props.sessionId,
          label: label,
        })
      })
    })
  }
  mount('conversation.input.dock', 'step-clock', 15, '上')
}
//#endregion
		exports.StepClock = StepClock;
		exports.CSS = CSS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
