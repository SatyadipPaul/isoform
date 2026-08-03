/**
 * The editor's own DOM and styles.
 *
 * These used to live in the demo's `index.html`, and the editor script reached
 * into them through thirty-six `getElementById` calls. That is fine for an app
 * and impossible for a library: mounting it anywhere else meant copying a slab
 * of markup and a stylesheet and keeping both in step with the code by hand.
 *
 * So the editor builds its own chrome and hands back typed references to it.
 * The ids are gone — nothing is looked up by name, which also means two editors
 * can sit on one page without colliding.
 *
 * Everything is scoped under a root element carrying `iso-root`, and positioned
 * against that element rather than the viewport, so the editor occupies the box
 * it was given instead of assuming it owns the window.
 */

/** Class marking an editor root. Also the CSS scope for everything below. */
const ROOT = 'iso-root'

/**
 * Styles, injected once per document.
 *
 * A string rather than a `.css` file consumers import: a library that renders
 * nothing until you remember a second import is a library that gets filed as
 * broken. Guarded by a data attribute so mounting several editors, or the same
 * one twice, does not stack copies.
 */
const STYLE_MARK = 'data-isoform-styles'

export const CSS = `
.${ROOT}{
  --iso-bg:#0E1116; --iso-plate:#151920; --iso-line:#252B36; --iso-line-soft:#1E232C;
  --iso-ink:#E7EBF2; --iso-ink-2:#98A3B4; --iso-ink-3:#5F6A7B;
  --iso-brass:#D9AE6B; --iso-brass-dim:#8A6F42;
  --iso-rail:264px;
  position:relative; overflow:hidden; background:var(--iso-bg); color:var(--iso-ink);
  font-family:"IBM Plex Sans",system-ui,sans-serif; -webkit-font-smoothing:antialiased;
  /* The host decides the box. A library that positions itself against the
     viewport cannot be embedded in a panel, a split view or a modal. */
  width:100%; height:100%;
}
.${ROOT} *{box-sizing:border-box}
.${ROOT} .mono{font-family:"IBM Plex Mono",monospace}
/* Explicit width/height matter: a canvas whose backing store exceeds its CSS
   box and has no stated CSS size lays out at its intrinsic pixel size, so on a
   1.5x display it overflows its container anchored top-left. */
.${ROOT} .iso-stage{position:absolute;inset:0;z-index:0;display:block;width:100%;height:100%}

.${ROOT} .bar{position:absolute;top:0;left:0;right:0;height:46px;z-index:3;display:flex;
  align-items:center;gap:14px;padding:0 16px;border-bottom:1px solid var(--iso-line);
  background:rgba(14,17,22,.86);backdrop-filter:blur(8px)}
.${ROOT} .bar .dot{width:10px;height:10px;background:var(--iso-brass);
  transform:rotate(45deg) skewY(-12deg);border-radius:1px}
.${ROOT} .bar b{font-family:"Archivo",sans-serif;font-size:14.5px;letter-spacing:-.01em}
.${ROOT} .bar .sep{width:1px;height:20px;background:var(--iso-line)}
.${ROOT} .bar .grow{margin-left:auto}
.${ROOT} button.t{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;background:transparent;color:var(--iso-ink-2);
  border:1px solid var(--iso-line);padding:6px 10px;border-radius:5px;cursor:pointer;transition:.14s}
.${ROOT} button.t:hover:not(:disabled){color:var(--iso-ink);border-color:var(--iso-ink-3)}
.${ROOT} button.t:disabled{opacity:.35;cursor:default}
.${ROOT} button.t[aria-pressed="true"]{color:var(--iso-brass);border-color:var(--iso-brass-dim);
  background:rgba(217,174,107,.08)}
.${ROOT} .readout{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.1em;
  color:var(--iso-ink-3)}

.${ROOT} .rail{position:absolute;top:46px;bottom:0;left:0;width:var(--iso-rail);z-index:2;
  overflow-y:auto;border-right:1px solid var(--iso-line);background:rgba(21,25,32,.9);
  backdrop-filter:blur(8px);padding:14px 12px 40px}
.${ROOT} .rail h4{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--iso-brass);margin:16px 4px 8px}
.${ROOT} .rail h4:first-child{margin-top:0}
.${ROOT} .parts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.${ROOT} .part{border:1px solid var(--iso-line-soft);border-radius:8px;background:#11151b;
  cursor:grab;overflow:hidden;transition:.14s;user-select:none}
.${ROOT} .part:hover{border-color:var(--iso-brass-dim);transform:translateY(-1px)}
.${ROOT} .part img{display:block;width:100%;aspect-ratio:1;background:#0E1116}
.${ROOT} .part span{display:block;padding:5px 7px 7px;font-size:11px;color:var(--iso-ink-2);
  border-top:1px solid var(--iso-line-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.${ROOT} .insp{position:absolute;top:46px;right:0;width:230px;z-index:2;padding:14px;
  border-left:1px solid var(--iso-line);background:rgba(21,25,32,.9);backdrop-filter:blur(8px);
  border-bottom-left-radius:10px}
.${ROOT} .insp h4{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--iso-brass);margin:0 0 10px}
.${ROOT} .insp .row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;
  color:var(--iso-ink-2)}
.${ROOT} .insp .row label{width:56px;color:var(--iso-ink-3);font-family:"IBM Plex Mono",monospace;
  font-size:10px;letter-spacing:.1em;text-transform:uppercase}
.${ROOT} .insp input[type=text]{flex:1;min-width:0;background:#0E1116;border:1px solid var(--iso-line);
  color:var(--iso-ink);border-radius:4px;padding:4px 6px;font:inherit;font-size:12px}
.${ROOT} .insp input[type=color]{width:24px;height:22px;padding:0;border:1px solid var(--iso-line);
  background:none;border-radius:4px;cursor:pointer}
.${ROOT} .insp select{flex:1;background:#0E1116;border:1px solid var(--iso-line);color:var(--iso-ink);
  border-radius:4px;padding:4px 6px;font:inherit;font-size:12px}
.${ROOT} .insp input.num{flex:none;width:54px;text-align:center}
.${ROOT} .insp button.t.sq{padding:3px 8px;font-size:13px;line-height:1.25}
.${ROOT} .insp .hint{font-size:11px;color:var(--iso-ink-3);line-height:1.55}
.${ROOT} .insp kbd{border:1px solid var(--iso-line);border-radius:3px;padding:0 4px;
  font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--iso-ink-2)}

.${ROOT} .help{position:absolute;left:calc(var(--iso-rail) + 16px);bottom:14px;z-index:2;
  font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.08em;color:var(--iso-ink-3);
  line-height:1.95;pointer-events:none}
.${ROOT} .help kbd{border:1px solid var(--iso-line);border-radius:3px;padding:1px 5px;
  color:var(--iso-ink-2)}

.${ROOT} .sheet{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;
  width:min(680px,86%);height:min(560px,78%);display:flex;flex-direction:column;
  background:rgba(17,21,27,.97);border:1px solid var(--iso-line);border-radius:10px;
  box-shadow:0 24px 70px rgba(0,0,0,.6);backdrop-filter:blur(10px)}
.${ROOT} .sheet header{display:flex;align-items:center;gap:12px;padding:11px 14px;
  border-bottom:1px solid var(--iso-line)}
.${ROOT} .sheet header b{font-family:"Archivo",sans-serif;font-size:13.5px}
.${ROOT} .sheet header span{font-size:10px;letter-spacing:.06em;color:var(--iso-ink-3)}
.${ROOT} .sheet textarea{flex:1;margin:0;padding:14px;background:transparent;border:0;resize:none;
  color:var(--iso-ink);font-family:"IBM Plex Mono",monospace;font-size:12.5px;line-height:1.75;
  outline:none;white-space:pre;overflow:auto}
.${ROOT} .sheet .bad{color:#F0655F}

/* Trace strip. Anchored to the right of the palette rail rather than to the
   viewport centre, so it stays centred over the *stage* rather than drifting
   under the rail as the panel narrows. Hidden entirely when the document has no
   traces — an empty transport control is a promise of something that isn't there. */
.${ROOT} .trace{position:absolute;left:calc(var(--iso-rail) + 50%/2 + 8px);bottom:52px;z-index:4;
  transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 12px;
  border:1px solid var(--iso-line);border-radius:8px;background:rgba(17,21,27,.94);
  backdrop-filter:blur(10px);box-shadow:0 10px 34px rgba(0,0,0,.45)}
.${ROOT} .trace select{background:#0E1116;border:1px solid var(--iso-line);color:var(--iso-ink);
  border-radius:4px;padding:4px 6px;font:inherit;font-size:12px;max-width:190px}
.${ROOT} .trace input[type=range]{width:210px;accent-color:var(--iso-brass);cursor:pointer}
.${ROOT} .trace .info{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.08em;
  color:var(--iso-ink-3);min-width:86px}
.${ROOT} .trace .info.warn{color:#E9A247}

.${ROOT} .hidden{display:none!important}
`

/** Every element the editor holds on to. Built once, never looked up by id. */
export interface Chrome {
  root: HTMLElement
  canvas: HTMLCanvasElement
  bar: HTMLElement
  readout: HTMLElement
  undo: HTMLButtonElement
  redo: HTMLButtonElement
  view: Record<'hero' | 'iso' | 'top', HTMLButtonElement>
  fit: HTMLButtonElement
  grid: HTMLButtonElement
  labels: HTMLButtonElement
  tidy: HTMLButtonElement
  dslToggle: HTMLButtonElement
  png: HTMLButtonElement
  gif: HTMLButtonElement
  html: HTMLButtonElement
  save: HTMLButtonElement
  load: HTMLButtonElement
  file: HTMLInputElement
  rail: HTMLElement
  inspTitle: HTMLElement
  inspBody: HTMLElement
  insp: HTMLElement
  sheet: HTMLElement
  dslText: HTMLTextAreaElement
  dslStatus: HTMLElement
  dslApply: HTMLButtonElement
  dslClose: HTMLButtonElement
  help: HTMLElement
  traceBar: HTMLElement
  tracePick: HTMLSelectElement
  tracePlay: HTMLButtonElement
  traceScrub: HTMLInputElement
  traceInfo: HTMLElement
  dispose(): void
}

export interface ChromeOptions {
  /** Shown in the top bar. Set to '' to drop the wordmark entirely. */
  title?: string
  /** Show the keyboard-shortcut strip along the bottom. */
  help?: boolean
  /** Show the text-DSL button and sheet. */
  dsl?: boolean
  /** Show the PNG / Save / Load group. */
  files?: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function button(label: string, cls = 't'): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  return b
}

/** Add the stylesheet to this document if it is not already there. */
function ensureStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARK}]`)) return
  const s = doc.createElement('style')
  s.setAttribute(STYLE_MARK, '')
  s.textContent = CSS
  doc.head.appendChild(s)
}

/**
 * Build the editor's chrome inside `container`.
 *
 * The container is not cleared: an editor is a thing you put *in* a page, and
 * silently emptying whatever it was given is how a library eats someone's
 * layout. Everything it creates hangs off one root element it can remove again.
 */
export function buildChrome(container: HTMLElement, opts: ChromeOptions = {}): Chrome {
  ensureStyles(container.ownerDocument)

  const root = el('div', ROOT)
  const canvas = el('canvas', 'iso-stage')

  /* ---- top bar ---- */
  const bar = el('div', 'bar')
  if (opts.title !== '') {
    bar.append(el('span', 'dot'), el('b', undefined, opts.title ?? 'Isoform'))
  }
  const readout = el('span', 'readout mono', '—')
  const undo = button('Undo')
  const redo = button('Redo')
  undo.disabled = true
  redo.disabled = true
  const view = {
    hero: button('Hero'),
    iso: button('Iso'),
    top: button('Top'),
  }
  view.hero.setAttribute('aria-pressed', 'true')
  view.iso.setAttribute('aria-pressed', 'false')
  view.top.setAttribute('aria-pressed', 'false')
  const fit = button('Fit')
  const grid = button('Grid')
  grid.setAttribute('aria-pressed', 'true')
  const labels = button('Labels')
  labels.setAttribute('aria-pressed', 'true')
  const tidy = button('Tidy')
  const dslToggle = button('Text')
  const png = button('PNG')
  /* A still, a moving still, and the live thing — in ascending fidelity, which
     is also the order of what a destination will accept. */
  const gif = button('GIF')
  const html = button('HTML')
  const save = button('Save')
  const load = button('Load')
  const file = el('input', 'hidden')
  file.type = 'file'
  file.accept = '.isoform,.json'

  const sep = (): HTMLElement => el('span', 'sep')
  bar.append(readout, sep(), undo, redo, sep(), view.hero, view.iso, view.top, fit, sep(), grid, labels)
  if (opts.dsl !== false) bar.append(sep(), tidy, dslToggle)
  else bar.append(sep(), tidy)
  bar.append(el('span', 'grow'))
  if (opts.files !== false) bar.append(png, gif, html, save, load, file)

  /* ---- palette rail ---- */
  const rail = el('aside', 'rail')

  /* ---- inspector ---- */
  const insp = el('aside', 'insp')
  const inspTitle = el('h4', undefined, 'Nothing selected')
  const inspBody = el('div')
  insp.append(inspTitle, inspBody)

  /* ---- text sheet ---- */
  const sheet = el('div', 'sheet hidden')
  const sheetHead = el('header')
  const dslStatus = el('span', 'mono', 'nodes: id type "Label" · edges: -> ~> => +> <->')
  const dslApply = button('Build diagram')
  const dslClose = button('Close')
  sheetHead.append(
    el('b', undefined, 'Describe the system'),
    dslStatus,
    el('span', 'grow'),
    dslApply,
    dslClose,
  )
  const dslText = el('textarea')
  dslText.spellcheck = false
  sheet.append(sheetHead, dslText)

  /* ---- trace strip ---- */
  const traceBar = el('div', 'trace hidden')
  const tracePick = el('select')
  tracePick.title = 'Trace to play'
  const tracePlay = button('Play')
  const traceScrub = el('input')
  traceScrub.type = 'range'
  traceScrub.min = '0'
  traceScrub.max = '1000'
  traceScrub.value = '0'
  traceScrub.title = 'Scrub'
  const traceInfo = el('span', 'info', '')
  traceBar.append(tracePick, tracePlay, traceScrub, traceInfo)

  /* ---- help ---- */
  const help = el('div', 'help')
  help.innerHTML = HELP_HTML

  root.append(canvas, bar, rail, insp, traceBar)
  if (opts.dsl !== false) root.append(sheet)
  if (opts.help !== false) root.append(help)
  container.appendChild(root)

  return {
    root,
    canvas,
    bar,
    readout,
    undo,
    redo,
    view,
    fit,
    grid,
    labels,
    tidy,
    dslToggle,
    png,
    gif,
    html,
    save,
    load,
    file,
    rail,
    inspTitle,
    inspBody,
    insp,
    sheet,
    dslText,
    dslStatus,
    dslApply,
    dslClose,
    help,
    traceBar,
    tracePick,
    tracePlay,
    traceScrub,
    traceInfo,
    dispose: () => root.remove(),
  }
}

const HELP_HTML = `
  <kbd>drag</kbd> palette → place · <kbd>click</kbd> select part, connector or group · <kbd>Shift</kbd>+<kbd>click</kbd> multi-select<br>
  <kbd>Ctrl</kbd>+<kbd>G</kbd> group selection · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> ungroup<br>
  <kbd>drag</kbd> the ring to turn · <kbd>[</kbd> <kbd>]</kbd> rotate 15° · <kbd>Alt</kbd> turn freely<br>
  <kbd>Del</kbd> delete selected · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd> undo · <kbd>F</kbd> fit`
