/**
 * Render the images the README uses.
 *
 * They were drawn by hand for 0.3.0 and never regenerated, so the hero shot was
 * showing a version of the library that no longer exists — and showing it badly:
 * the diagram sat in a thin band with most of the canvas empty, because a wide
 * flat system framed into 16:9 fits by width and leaves the height unused.
 *
 * Rendering them from the live library instead means they cannot drift from what
 * the code does, and the framing is a decision recorded here rather than
 * whatever the window happened to be when someone pressed a button.
 */

import {
  DSL_EXAMPLE,
  MANIFESTS,
  PART_IDS,
  emptyDoc,
  fitGroups,
  layout,
  parseDsl,
  renderDocument,
  type Doc,
  type DocNode,
  type PartId,
} from '@satyadip28/isoform'

const log = (s: string) => {
  document.getElementById('log')!.textContent += s + '\n'
}

function laidOut(text: string): Doc {
  const { doc, issues } = parseDsl(text)
  for (const i of issues) log(`dsl line ${i.line}: ${i.message}`)
  const { positions } = layout(doc)
  for (const n of doc.nodes) {
    const p = positions.get(n.id)
    if (p) n.pos = p
  }
  doc.groups = fitGroups(doc)
  return doc
}

/**
 * The hero.
 *
 * Rendered at 21:9 rather than 16:9. A system diagram is wide, flat and shallow
 * — that is the shape of nearly every real one — so a 16:9 frame fits it by
 * width and leaves nearly half the image empty above and below. The wide crop is
 * the frame the subject actually has.
 *
 * A few nodes carry states, because a hero should show what the library can say
 * rather than only what it can draw.
 */
function heroDoc(): Doc {
  const doc = laidOut(DSL_EXAMPLE)
  const state: Record<string, DocNode['state']> = {
    pg: 'degraded',
    psp: 'deprecated',
    find: 'new',
  }
  for (const n of doc.nodes) if (state[n.id]) n.state = state[n.id]
  return doc
}

/**
 * The catalog: every part at palette size, in a grid.
 *
 * Laid out by hand rather than by `layout`, which arranges by connectivity —
 * there are no edges here, and the point is to compare silhouettes, so a regular
 * grid in registry order is the only arrangement that reads.
 */
function catalogDoc(): Doc {
  const doc = emptyDoc()
  const COLS = 6

  /* `boundary` is excluded, and the README has always said so — "the catalog —
     24 parts", against a `PART_IDS` of 25. It is the group container rather than
     a component, and it is 4×4 against a typical 1.4, so including it both
     misstated the count and wrecked the picture: the pitch is derived from the
     widest member, so one oversized box pushed every other part three times
     further apart than it needed and shrank them all to specks. */
  const parts = PART_IDS.filter((id) => id !== 'boundary')
  const pitch = Math.max(...parts.map((id) => Math.max(MANIFESTS[id].footprint.w, MANIFESTS[id].footprint.d))) + 1.1

  doc.nodes = parts.map((id, i): DocNode => ({
    id,
    type: id as PartId,
    label: MANIFESTS[id].name,
    pos: [(i % COLS) * pitch, Math.floor(i / COLS) * pitch],
    rot: 0,
  }))
  return doc
}

interface Shot {
  name: string
  doc: Doc
  width: number
  aspect: number
  preset?: 'hero' | 'iso' | 'top'
  pose?: { az: number; el: number; zoom?: number }
}

/**
 * How much of the frame the diagram actually covers.
 *
 * Framing fits the diagram's *axis-aligned* box, so a run laid out along one
 * axis and seen at an angle lands on screen as a diagonal and the corners of
 * that box come out empty. Measuring the non-background pixels is the only way
 * to compare two poses honestly — by eye they both look "framed".
 */
function coverage(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      const scale = 240 / img.width
      c.width = 240
      c.height = Math.round(img.height * scale)
      const x = c.getContext('2d')!
      x.drawImage(img, 0, 0, c.width, c.height)
      const { data } = x.getImageData(0, 0, c.width, c.height)
      let minX = c.width, maxX = 0, minY = c.height, maxY = 0
      for (let p = 0; p < c.width * c.height; p++) {
        const i = p * 4
        /* The backdrop is a near-black gradient; anything meaningfully brighter
           is the diagram. */
        if (data[i] + data[i + 1] + data[i + 2] < 120) continue
        const px = p % c.width
        const py = (p / c.width) | 0
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
      }
      resolve({ w: (maxX - minX) / c.width, h: (maxY - minY) / c.height })
    }
    img.src = dataUrl
  })
}

const SHOTS: Shot[] = [
  /* The locked hero pose, at 21:9.
     A system diagram is wide, flat and shallow, and framing now fits the parts
     themselves rather than the box around them — so the wide crop is filled
     rather than being a letterbox with a small diagram in the middle of it. */
  { name: 'hero', doc: heroDoc(), width: 2100, aspect: 21 / 9 },
  /* Isometric for the catalog: parallel edges stay parallel, so silhouettes can
     be compared across the grid instead of foreshortening away toward the back.
     6 × 4 of them, so 3:2 sits closer to the grid's own shape than 4:3 does. */
  { name: 'catalog', doc: catalogDoc(), width: 1700, aspect: 3 / 2, preset: 'iso' },
]

function render(shot: Shot, canvas: HTMLCanvasElement): string {
  return renderDocument(shot.doc, {
    canvas,
    width: shot.width,
    aspect: shot.aspect,
    preset: shot.preset ?? 'hero',
    pose: shot.pose,
    labels: true,
    grid: false,
    padding: 0.35,
  })
}

function download(name: string, url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.png`
  a.click()
}

const SINK = 'http://localhost:5199/'

async function main(save: boolean): Promise<void> {
  document.getElementById('log')!.textContent = ''
  document.getElementById('out')!.replaceChildren()
  const canvas = document.createElement('canvas')

  for (const shot of SHOTS) {
    const t0 = performance.now()
    const url = render(shot, canvas)
    log(
      `${shot.name}: ${shot.width}×${Math.round(shot.width / shot.aspect)} · ` +
        `${(url.length / 1024 / 1.37).toFixed(0)} kB · ${(performance.now() - t0).toFixed(0)}ms`,
    )

    const img = new Image()
    img.src = url
    document.getElementById('out')!.append(img)

    if (save) download(shot.name, url)
    /* Best-effort: the sink is a local dev convenience and absent for anyone
       else, so a failure here must not stop the download above. */
    await fetch(SINK + shot.name, { method: 'POST', body: url }).catch(() => {})
  }
}

/** Try a range of azimuths on the hero and report which one fills the frame. */
async function sweep(): Promise<void> {
  document.getElementById('log')!.textContent = ''
  document.getElementById('out')!.replaceChildren()
  const canvas = document.createElement('canvas')
  const doc = heroDoc()

  log('az     el     coverage w × h    area')
  for (const az of [0, 0.15, 0.3, 0.45, 0.6, 0.75]) {
    for (const el of [0.3, 0.42]) {
      const url = renderDocument(doc, {
        canvas,
        width: 1400,
        aspect: 21 / 9,
        pose: { az, el },
        padding: 0.35,
      })
      const c = await coverage(url)
      log(
        `${az.toFixed(2)}   ${el.toFixed(2)}   ${(c.w * 100).toFixed(0)}% × ${(c.h * 100).toFixed(0)}%` +
          `      ${(c.w * c.h * 100).toFixed(0)}%`,
      )
    }
  }
}

document.getElementById('save')!.addEventListener('click', () => void main(true))
document.getElementById('sweep')!.addEventListener('click', () => void sweep())
void main(false)
