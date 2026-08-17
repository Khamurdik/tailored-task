import { Injectable, Logger } from '@nestjs/common';
import type { EventMap, EventName } from '@dataroom/shared';

export type Listener<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;

/**
 * The typed event bus.
 *
 * `common` owns it because every other candidate is a domain module and would
 * drag its concerns into the layer below it. The payload contract lives in
 * `packages/shared` so both ends of every listener compile against one
 * definition.
 *
 * Emitters and listeners, so the wiring is greppable in one place:
 *
 *   user.created        seeder → sharing
 *   user.authenticated  auth   → sharing
 *   node.deleted        nodes  → sharing
 *
 * ## Why this is a Map and not `@nestjs/event-emitter`
 *
 * The spec named that package, and it is the obvious choice, but it is not
 * installed and adding it now would be paying for a subsystem before knowing
 * whether the subsystem survives. There is an open question about exactly that
 * — `user.created` has one emitter and one listener, and login-time claiming is
 * already the guarantee behind it, so the bus may be deleted outright when
 * `sharing` is written.
 *
 * What that package buys over this file is `@OnEvent()` decorators, wildcard
 * patterns, and namespacing. Three events need none of them. What it costs is a
 * dependency, a lockfile change, and a removal that touches more than one file.
 *
 * Node's own `EventEmitter` was the first attempt and is a worse fit than it
 * looks: wrapping each listener to swallow its errors means `listeners()`
 * hands back the wrappers, so an `emitAsync` built on it awaits the wrapper
 * rather than the handler and returns before any of them have finished. A Map
 * of handlers has no such gap.
 */
@Injectable()
export class EventBus {
  private readonly listeners = new Map<EventName, Listener<EventName>[]>();
  private readonly logger = new Logger(EventBus.name);

  on<K extends EventName>(event: K, listener: Listener<K>): void {
    const existing = this.listeners.get(event);
    const entry = listener as Listener<EventName>;
    if (existing) existing.push(entry);
    else this.listeners.set(event, [entry]);
  }

  /**
   * Fire and forget. **A listener failure must never fail the request that
   * emitted the event** — every listener here is a convenience path with a
   * guarantee behind it (a pending grant a listener misses is claimed at login
   * instead), so a handler that throws is a logged anomaly, not a reason to
   * fail an upload.
   */
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      void this.run(event, listener, payload);
    }
  }

  /**
   * Awaits delivery, still swallowing failures.
   *
   * For tests, and for the seeder — which is a script rather than a request and
   * exits as soon as it is done, so a fire-and-forget listener there would
   * simply never run.
   *
   * Request paths should use `emit`. Awaiting listeners puts their latency on
   * the request that fired the event, which is the coupling the bus exists to
   * remove.
   */
  async emitAsync<K extends EventName>(event: K, payload: EventMap[K]): Promise<void> {
    await Promise.all(
      (this.listeners.get(event) ?? []).map((listener) => this.run(event, listener, payload)),
    );
  }

  private async run<K extends EventName>(
    event: K,
    listener: Listener<EventName>,
    payload: EventMap[K],
  ): Promise<void> {
    try {
      await (listener as Listener<K>)(payload);
    } catch (cause) {
      this.logger.error(
        `Listener for "${event}" threw and was swallowed`,
        cause instanceof Error ? cause.stack : String(cause),
      );
    }
  }
}
