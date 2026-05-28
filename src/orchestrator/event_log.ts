import type { EventRecord, GetUpdatesInput } from "../types.js";
import { appendEvent, StateStore } from "./state_store.js";

export class EventLog {
  constructor(private readonly store: StateStore) {}

  async append(event: Omit<EventRecord, "event_id" | "time">): Promise<EventRecord> {
    return this.store.updateState((state) => appendEvent(state, event));
  }

  async getUpdates(input: GetUpdatesInput): Promise<{ events: EventRecord[] }> {
    const since = input.since_event_id ?? 0;
    const state = await this.store.readState();
    return {
      events: state.events.filter((event) => {
        if (event.event_id <= since) {
          return false;
        }
        if (input.project_id && event.project_id !== input.project_id) {
          return false;
        }
        return true;
      }),
    };
  }
}
