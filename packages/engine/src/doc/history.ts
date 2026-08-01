/**
 * Undo/redo — a plain stack over commands.
 *
 * The inverse is computed at the moment a command is applied, while the
 * pre-state is still to hand. Storing it beats recomputing later, and it beats
 * snapshotting whole documents.
 */

import type { Command } from './commands.js'
import { apply, invert } from './commands.js'
import type { Doc } from './schema.js'

interface Entry {
  cmd: Command
  inv: Command
  label: string
}

export type DocListener = (doc: Doc, touched: Set<string> | null) => void

export class History {
  private undone: Entry[] = []
  private done: Entry[] = []
  private listeners: DocListener[] = []

  constructor(
    private current: Doc,
    /** Cap on retained history. Diagrams are small; the stack need not be. */
    private limit = 200,
  ) {}

  get doc(): Doc {
    return this.current
  }

  get canUndo(): boolean {
    return this.done.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  subscribe(fn: DocListener): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  private emit(touched: Set<string> | null): void {
    for (const l of this.listeners) l(this.current, touched)
  }

  /** Apply a command, record its inverse, and notify. */
  run(cmd: Command, label?: string): Doc {
    const inv = invert(this.current, cmd)
    this.current = apply(this.current, cmd)
    this.done.push({ cmd, inv, label: label ?? cmd.t })
    if (this.done.length > this.limit) this.done.shift()
    /* Any new action invalidates the redo branch. */
    this.undone = []
    this.emit(null)
    return this.current
  }

  /**
   * Apply without recording — for continuous gestures such as a drag, where
   * every pointer-move would otherwise become its own undo step. Commit the
   * whole gesture with `run` once it ends.
   */
  preview(cmd: Command): Doc {
    this.current = apply(this.current, cmd)
    this.emit(null)
    return this.current
  }

  undo(): Doc {
    const e = this.done.pop()
    if (!e) return this.current
    this.current = apply(this.current, e.inv)
    this.undone.push(e)
    this.emit(null)
    return this.current
  }

  redo(): Doc {
    const e = this.undone.pop()
    if (!e) return this.current
    this.current = apply(this.current, e.cmd)
    this.done.push(e)
    this.emit(null)
    return this.current
  }

  /** Replace the document wholesale — loading a file, not an edit. */
  reset(doc: Doc): void {
    this.current = doc
    this.done = []
    this.undone = []
    this.emit(null)
  }

  /** Labels of the pending undo and redo, for menu text. */
  get labels(): { undo: string | null; redo: string | null } {
    return {
      undo: this.done.at(-1)?.label ?? null,
      redo: this.undone.at(-1)?.label ?? null,
    }
  }
}
