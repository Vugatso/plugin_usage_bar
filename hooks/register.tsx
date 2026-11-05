import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const lines = atom({ plugin: 'usage-bar', key: 'lines' } as const, [], {
  shape: 'lines-1',
})

const STYLES = ['pacman', 'beer', 'tank', 'battery', 'hourglass'] as const
type Style = (typeof STYLES)[number]

const WIDTH = 20
const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * 3600_000,
  seven_day: 7 * 24 * 3600_000,
}
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const isStyle = (s: unknown): s is Style =>
  typeof s === 'string' && (STYLES as readonly string[]).includes(s)

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function countdown(ms: number): string {
  if (ms <= 0) return 'now'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(mm).padStart(2, '0')}m`
  return `${mm}m`
}

// Draws the bar body. `fill` and `pace` are 0..1; `frame` is the animation tick.
function drawBar(style: Style, fill: number, pace: number | null, frame: number): string {
  const filled = Math.round(clamp(fill, 0, 1) * WIDTH)
  const paceAt = pace === null ? -1 : clamp(Math.round(pace * WIDTH), 0, WIDTH - 1)
  const cells: string[] = []

  for (let i = 0; i < WIDTH; i++) {
    const isFilled = i < filled
    const isHead = i === filled - 1
    let c: string
    switch (style) {
      case 'pacman':
        // Pac-Man sits at the fill edge, chewing; remaining cells are pellets.
        c = isHead ? (frame % 2 === 0 ? 'ᗧ' : '●') : isFilled ? ' ' : i % 2 === 0 ? '·' : ' '
        break
      case 'beer':
        // Glass fills; foam on the head; bubbles rise through the beer.
        c = isHead ? '~' : isFilled ? ((i + frame) % 5 === 0 ? 'o' : '▓') : '░'
        break
      case 'tank':
        // Tank at the head, a shell flies ahead of it; trail behind.
        c = isHead
          ? '▄'
          : i === filled && filled < WIDTH
            ? ['>', '»', '>', '-'][frame % 4]
            : isFilled
              ? '='
              : '·'
        break
      case 'battery':
        // Charge cells; the head cell pulses.
        c = isHead ? (frame % 2 === 0 ? '▓' : '█') : isFilled ? '█' : '░'
        break
      case 'hourglass':
        // Sand falls from top (empty) to bottom (used); a grain drops at the head.
        c = isHead ? (frame % 2 === 0 ? '⌛' : '⏳') : isFilled ? '▒' : '·'
        break
    }
    // Pace mark: where usage "should" be if spent evenly across the window.
    if (i === paceAt && c !== (style === 'hourglass' ? '⌛' : '')) c = '┃'
    cells.push(c)
  }
  const body = cells.join('')
  return style === 'battery' ? `[${body}]▫` : style === 'beer' ? `🍺${body}|` : `[${body}]`
}

export const register: Register = (on, options) => {
  let limits: Limit[] = []
  let base: Record<string, number> = {} // percent at the last prompt
  let working = false
  let frame = 0
  let style: Style = isStyle(options?.style) ? options.style : 'pacman'
  let tick: { cancel: () => void } | undefined

  const compose = (now: number): string[] => {
    if (limits.length === 0) {
      return ['usage: waiting for the first rate-limit reading…']
    }
    const rows = limits
      .filter(l => l.kind in LABEL)
      .map(l => {
        const win = WINDOW_MS[l.kind]
        const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
        const left = Number.isFinite(reset) ? reset - now : NaN
        const elapsed = Number.isFinite(left) ? clamp((win - left) / win, 0, 1) : null
        const pct = l.percentUsed

        // Projection: at the current burn rate, where does the window end?
        let proj = ''
        if (elapsed !== null && elapsed > 0.02 && pct > 0) {
          const end = pct / elapsed
          proj = end >= 100 ? ` →${Math.round(end)}% ⚠` : ` →${Math.round(end)}%`
        }
        const delta = l.kind in base ? pct - base[l.kind] : 0
        const d = delta > 0.05 ? ` (+${delta.toFixed(1)})` : ''
        const eta = Number.isFinite(left) ? ` ↻${countdown(left)}` : ''
        const bar = drawBar(style, pct / 100, elapsed, working ? frame : 0)
        return `${LABEL[l.kind]} ${bar} ${pct.toFixed(pct < 10 ? 1 : 0)}%${d}${eta}${proj}`
      })
    return rows
  }

  on('session.start', async ($, e, next) => {
    try {
      limits = (await $.session.usage()).rateLimits
    } catch {
      limits = []
    }
    const saved = await $.store.get('style')
    if (isStyle(saved)) style = saved
    tick = $.clock.every(500, () => {
      frame += 1
      void $.clock.now().then((now: number) => update($, lines, () => compose(now)))
    })
    await $.command.register({
      name: 'usagebar',
      description: `Pick the usage bar style: ${STYLES.join(', ')}`,
    })
    const now = await $.clock.now()
    await update($, lines, () => compose(now))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    working = true
    base = Object.fromEntries(limits.map(l => [l.kind, l.percentUsed]))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    working = false
    const now = await $.clock.now()
    await update($, lines, () => compose(now))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    limits = e.rateLimits
    const now = await $.clock.now()
    await update($, lines, () => compose(now))
    return next(e)
  })

  on('command.run', { command: 'usagebar' }, async ($, e) => {
    const want = e.args.trim().toLowerCase()
    if (!isStyle(want)) {
      return { text: `usage-bar styles: ${STYLES.join(', ')}. Now: ${style}. Try /usagebar tank` }
    }
    style = want
    await $.store.set('style', want)
    const now = await $.clock.now()
    await update($, lines, () => compose(now))
    return { text: `usage-bar style: ${want}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = await read($, lines)
    if (e.props.hasSurvey || rows.length === 0) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text>{row}</Text>
        ))}
      </Box>
    )
  })

  on('session.end', ($, e, next) => {
    tick?.cancel()
    return next(e)
  })
}
