import { appendEvent } from "./state_store.js";
export class EventLog {
    store;
    constructor(store) {
        this.store = store;
    }
    async append(event) {
        return this.store.updateState((state) => appendEvent(state, event));
    }
    async getUpdates(input) {
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
//# sourceMappingURL=event_log.js.map