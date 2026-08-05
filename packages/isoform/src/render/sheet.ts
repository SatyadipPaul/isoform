/**
 * Several renders, composed into one image.
 *
 * Three questions share this machinery, because all three are answered by
 * putting pictures next to each other rather than by making one picture better:
 *
 *  - *What does this look like from elsewhere?* — `renderSheet`
 *  - *What happens over the course of this move?* — `renderStory`
 *  - *What changed between these two documents?* — `renderDiff`
 *
 * All three exist mostly for a reader who cannot orbit: a pull request, a
 * changelog, a printed page, an agent with no eyes. A GIF answers the second
 * question better wherever motion is allowed — the contact sheet is what you
 * reach for when it is not, and it has the advantage of being scannable at a
 * glance rather than only in real time.
 *
 * Tiles are composed on a 2D canvas from PNG data URLs, so the whole module is
 * asynchronous: decoding an image is. The alternative — reading pixels straight
 * out of the render target and blitting them — avoids the decode but means
 * duplicating the flip, the transparency handling and the colour-space dance
 * that `renderFrames` already does correctly.
 */

import type { Doc, DocEdge, DocNode } from '../doc/schema.js'
import { frameToPng, renderFrames, type LabelMode } from './frames.js'
import { renderDocument, type SnapshotOptions } from './snapshot.js'
import { storyboardDuration, type CameraPose, type Shot, type Storyboard } from './shots.js'

/** One cell of a composed image. */
interface Tile {
  url: string
  caption?: string
}

export interface ComposeOptions {
  /** Tiles per row. Defaults to a roughly square arrangement. */
  columns?: number
  /** Width of one tile, in pixels. */
  tileWidth?: number
  /** Width ÷ height of one tile. */
  aspect?: number
  /** Pixels between tiles and around the edge. */
  gap?: number
  /** Sheet background. `null` leaves it transparent. */
  background?: string | null
  /** Draw the per-tile captions. On by default when any tile has one. */
  captions?: boolean
}

const CAPTION_PX = 30
const DEFAULT_GAP = 16
/* Matches the studio backdrop's darkest tone, so tiles sit on the sheet rather
   than float on a rectangle of some unrelated grey. */
const DEFAULT_BG = '#0b0d12'

async function decode(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  /* `decode()` rather than an onload race: it resolves when the pixels are
     actually ready to draw, and it rejects rather than hanging on a bad URL. */
  await img.decode()
  return img
}

/** Lay tiles out in a grid and return the sheet as a PNG data URL. */
async function compose(tiles: Tile[], opts: ComposeOptions = {}): Promise<string> {
  if (!tiles.length) throw new Error('Isoform: nothing to compose')

  const tileWidth = Math.max(64, Math.round(opts.tileWidth ?? 700))
  const aspect = opts.aspect ?? 16 / 9
  const tileHeight = Math.round(tileWidth / aspect)
  const gap = opts.gap ?? DEFAULT_GAP
  const columns = Math.max(1, opts.columns ?? Math.ceil(Math.sqrt(tiles.length)))
  const rows = Math.ceil(tiles.length / columns)
  const withCaptions = opts.captions ?? tiles.some((t) => t.caption)
  const capH = withCaptions ? CAPTION_PX : 0

  const canvas = document.createElement('canvas')
  canvas.width = columns * tileWidth + (columns + 1) * gap
  canvas.height = rows * (tileHeight + capH) + (rows + 1) * gap
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Isoform: 2D context unavailable')

  const bg = opts.background === undefined ? DEFAULT_BG : opts.background
  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const images = await Promise.all(tiles.map((t) => decode(t.url)))
  images.forEach((img, i) => {
    const col = i % columns
    const row = Math.floor(i / columns)
    const x = gap + col * (tileWidth + gap)
    const y = gap + row * (tileHeight + capH + gap)
    ctx.drawImage(img, x, y, tileWidth, tileHeight)

    const caption = tiles[i].caption
    if (withCaptions && caption) {
      ctx.fillStyle = '#c7cede'
      ctx.font = '500 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(caption, x + 2, y + tileHeight + capH / 2, tileWidth - 4)
    }
  })

  return canvas.toDataURL('image/png')
}

/* ------------------------------------------------------------------ *
 * Contact sheet
 * ------------------------------------------------------------------ */

export interface SheetView {
  pose?: CameraPose | 'hero' | 'iso' | 'top'
  caption?: string
  focus?: Iterable<string>
  trace?: string
  traceAt?: number
}

export interface SheetOptions extends ComposeOptions, Omit<SnapshotOptions, 'pose' | 'width'> {
  /** What to render. Defaults to four azimuths a quarter-turn apart. */
  views?: SheetView[]
}

/**
 * Four views a quarter-turn apart, at the hero elevation.
 *
 * Chosen over the three named presets because the question a contact sheet
 * usually answers is "what is hiding behind what" — and orthographic top and iso
 * views answer that by removing the perspective the diagram is composed in,
 * which changes the picture more than the camera does. Turning on the spot keeps
 * every tile comparable.
 */
function defaultViews(): SheetView[] {
  const el = 0.42
  return [0, 0.25, 0.5, 0.75].map((turn) => ({
    pose: { az: 0.6 + turn * Math.PI * 2, el },
    caption: `azimuth ${Math.round(((0.6 + turn * Math.PI * 2) * 180) / Math.PI) % 360}°`,
  }))
}

/**
 * Render one document from several camera positions into a single image.
 *
 * The tiles share one canvas, and therefore one WebGL context. Rendering four
 * views by calling `renderDocument` four times burns four contexts, and browsers
 * cap how many may be live at once — after which the oldest is killed and comes
 * back blank with no error.
 */
export async function renderSheet(doc: Doc, opts: SheetOptions = {}): Promise<string> {
  const views = opts.views?.length ? opts.views : defaultViews()
  const aspect = opts.aspect ?? 16 / 9
  const tileWidth = opts.tileWidth ?? 700
  const canvas = opts.canvas ?? document.createElement('canvas')

  const tiles = views.map((v) => ({
    url: renderDocument(doc, {
      ...opts,
      canvas,
      width: tileWidth,
      aspect,
      pose: typeof v.pose === 'string' || v.pose === undefined ? undefined : v.pose,
      preset: typeof v.pose === 'string' ? v.pose : opts.preset,
      focus: v.focus ?? opts.focus,
      trace: v.trace ?? opts.trace,
      traceAt: v.traceAt ?? opts.traceAt,
    }),
    caption: v.caption,
  }))

  return compose(tiles, { ...opts, aspect, tileWidth })
}

/* ------------------------------------------------------------------ *
 * Storyboard contact sheet
 * ------------------------------------------------------------------ */

export interface StoryOptions extends ComposeOptions, Partial<Storyboard> {
  /** How many moments to sample. */
  frames?: number
  labels?: LabelMode
  padding?: number
  grid?: boolean
  transparent?: boolean
  canvas?: HTMLCanvasElement
}

/**
 * Render a storyboard as a strip of stills — the printable form of a GIF.
 *
 * Sampling is delegated to `renderFrames` rather than reimplemented, by choosing
 * the frame rate that yields exactly the requested number of frames. That keeps
 * one definition of what the camera is doing at time `t`: a second sampler would
 * be a second thing to keep in step, and the two would disagree the first time
 * the easing changed.
 */
export async function renderStory(doc: Doc, opts: StoryOptions = {}): Promise<string> {
  const shots = opts.shots ?? []
  if (!shots.length) throw new Error('Isoform: renderStory needs at least one shot')

  const count = Math.max(1, Math.round(opts.frames ?? 6))
  const duration = storyboardDuration({ from: opts.from, shots })
  /* `frameTimes` emits at i/count for i in 0…count-1, so count = duration × fps.
     Solving for fps gives exactly the requested number of samples, evenly spread
     and including t=0 but not t=1 — the same convention that keeps a turntable
     from repeating its first frame at the loop point. */
  const fps = count / Math.max(duration, 1e-6)

  const frames = await renderFrames(doc, {
    from: opts.from,
    shots,
    fps,
    width: opts.tileWidth ?? 560,
    aspect: opts.aspect ?? 16 / 9,
    labels: opts.labels ?? 'plain',
    padding: opts.padding,
    grid: opts.grid,
    transparent: opts.transparent,
    canvas: opts.canvas,
  })

  const tiles = frames.map((f, i) => ({
    url: frameToPng(f),
    caption: `${((i / frames.length) * duration).toFixed(1)}s`,
  }))

  return compose(tiles, {
    columns: opts.columns ?? Math.min(frames.length, 3),
    ...opts,
    tileWidth: opts.tileWidth ?? 560,
  })
}

/* ------------------------------------------------------------------ *
 * Diff
 * ------------------------------------------------------------------ */

export interface DocDiff {
  /** Node ids present in the later document only. */
  added: string[]
  /** Node ids present in the earlier document only. */
  removed: string[]
  /** Node ids in both, whose identity or appearance differs. */
  changed: string[]
  /** Node ids in both that only moved. */
  moved: string[]
  edgesAdded: string[]
  edgesRemoved: string[]
  /** One line, suitable for a commit message or a caption. */
  summary: string
}

/** What a connector is, for comparison: its ends and its kind, never its id. */
const edgeKey = (e: DocEdge): string => `${e.from.node} ${e.kind} ${e.to.node}`

/**
 * What differs between two nodes, ignoring where they sit.
 *
 * Position is handled separately because moving a thing and changing what it is
 * are different edits, and a layout run moves everything — collapsing the two
 * would report every node as changed after any re-layout.
 */
function identityDiffers(a: DocNode, b: DocNode): boolean {
  return (
    a.type !== b.type ||
    a.label !== b.label ||
    a.sublabel !== b.sublabel ||
    a.tint !== b.tint ||
    a.state !== b.state
  )
}

function positionDiffers(a: DocNode, b: DocNode): boolean {
  return a.pos[0] !== b.pos[0] || a.pos[1] !== b.pos[1] || (a.y ?? 0) !== (b.y ?? 0)
}

/**
 * Compare two documents structurally.
 *
 * Pure, and deliberately separate from rendering it: this is the part with logic
 * in it, so it is the part worth testing without a GPU.
 */
export function diffDocs(before: Doc, after: Doc): DocDiff {
  const a = new Map(before.nodes.map((n) => [n.id, n]))
  const b = new Map(after.nodes.map((n) => [n.id, n]))

  const added = [...b.keys()].filter((id) => !a.has(id))
  const removed = [...a.keys()].filter((id) => !b.has(id))
  const changed: string[] = []
  const moved: string[] = []
  for (const [id, na] of a) {
    const nb = b.get(id)
    if (!nb) continue
    if (identityDiffers(na, nb)) changed.push(id)
    else if (positionDiffers(na, nb)) moved.push(id)
  }

  const ea = new Set(before.edges.map(edgeKey))
  const eb = new Set(after.edges.map(edgeKey))
  const edgesAdded = [...eb].filter((k) => !ea.has(k))
  const edgesRemoved = [...ea].filter((k) => !eb.has(k))

  const parts: string[] = []
  if (added.length) parts.push(`+${added.length} node${added.length === 1 ? '' : 's'}`)
  if (removed.length) parts.push(`−${removed.length} node${removed.length === 1 ? '' : 's'}`)
  if (changed.length) parts.push(`${changed.length} changed`)
  if (moved.length) parts.push(`${moved.length} moved`)
  if (edgesAdded.length) parts.push(`+${edgesAdded.length} edge${edgesAdded.length === 1 ? '' : 's'}`)
  if (edgesRemoved.length) {
    parts.push(`−${edgesRemoved.length} edge${edgesRemoved.length === 1 ? '' : 's'}`)
  }

  return {
    added,
    removed,
    changed,
    moved,
    edgesAdded,
    edgesRemoved,
    summary: parts.length ? parts.join(', ') : 'no changes',
  }
}

export interface DiffOptions extends ComposeOptions, Omit<SnapshotOptions, 'focus' | 'width'> {
  /** Captions for the two panels. */
  labelBefore?: string
  labelAfter?: string
}

/**
 * Render two documents side by side, each emphasising what the diff found.
 *
 * Emphasis rather than annotation: the panels are focused on the nodes that
 * differ, so everything unchanged dims toward the backdrop. That reuses the
 * focus machinery already in the renderer and, unlike drawing markers over the
 * image, it survives the camera being moved.
 *
 * Both panels are framed by their own content, so a node added at the edge of
 * the system will shift the second panel. That is honest — it is what the
 * diagram now looks like — but it does mean the two are not pixel-comparable.
 */
export async function renderDiff(before: Doc, after: Doc, opts: DiffOptions = {}): Promise<string> {
  const diff = diffDocs(before, after)
  const canvas = opts.canvas ?? document.createElement('canvas')
  const aspect = opts.aspect ?? 16 / 9
  const tileWidth = opts.tileWidth ?? 760

  /* Emphasis follows the *semantic* changes only. Movement is deliberately left
     out: inserting one node re-runs the layout and shifts most of the others, so
     focusing on what moved lit up six of nine nodes in a diff whose real content
     was a single added cache — emphasis on almost everything is emphasis on
     nothing. The move count still reaches the reader, in the caption.
     Nothing to emphasise means emphasise nothing, rather than dimming the whole
     diagram to point at an empty set. */
  const gone = diff.removed
  const fresh = [...diff.added, ...diff.changed]

  const tiles: Tile[] = [
    {
      url: renderDocument(before, {
        ...opts,
        canvas,
        width: tileWidth,
        aspect,
        focus: gone.length ? gone : undefined,
      }),
      caption: opts.labelBefore ?? 'before',
    },
    {
      url: renderDocument(after, {
        ...opts,
        canvas,
        width: tileWidth,
        aspect,
        focus: fresh.length ? fresh : undefined,
      }),
      caption: `${opts.labelAfter ?? 'after'} — ${diff.summary}`,
    },
  ]

  return compose(tiles, { ...opts, columns: 2, aspect, tileWidth })
}

export type { Shot, Storyboard }
