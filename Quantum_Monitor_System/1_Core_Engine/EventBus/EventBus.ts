import type { EventHandler, EventPayloadMap, SystemEventName } from '../../4_Shared_Types/standard_models/eventTypes.js';

export class EventBus {
  private handlers = new Map<SystemEventName, Set<(payload: unknown) => void>>();

  subscribe<TEvent extends SystemEventName>(eventName: TEvent, handler: EventHandler<TEvent>): () => void {
    const handlers = this.handlers.get(eventName) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler as (payload: unknown) => void);
    this.handlers.set(eventName, handlers);

    return () => {
      handlers.delete(handler as (payload: unknown) => void);
      if (handlers.size === 0) {
        this.handlers.delete(eventName);
      }
    };
  }

  publish<TEvent extends SystemEventName>(eventName: TEvent, payload: EventPayloadMap[TEvent]): void {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    for (const handler of handlers) {
      handler(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();

