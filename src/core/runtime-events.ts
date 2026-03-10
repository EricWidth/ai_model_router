import { randomUUID } from 'node:crypto'

export interface RuntimeEvent {
  id: string
  type: string
  timestamp: number
  payload?: Record<string, unknown>
}

type EventListener = (event: RuntimeEvent) => void

export class RuntimeEvents {
  private readonly listeners = new Set<EventListener>()

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(type: string, payload?: Record<string, unknown>): void {
    const event: RuntimeEvent = {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      payload
    }
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
