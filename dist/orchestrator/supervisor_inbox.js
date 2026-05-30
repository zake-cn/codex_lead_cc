import { WAKE_PRIORITIES } from "../types.js";
import { nowIso } from "./state_store.js";
import { comparePriority, defaultWakeTypes, priorityRank } from "./wake_policy.js";
export class SupervisorInbox {
    store;
    constructor(store) {
        this.store = store;
    }
    async getInbox(input) {
        const state = await this.store.readState();
        return {
            notifications: filterNotifications(Object.values(state.notifications), {
                projectId: input.project_id,
                planId: input.plan_id,
                onlyUnread: input.only_unread ?? false,
                minPriority: input.min_priority,
            })
                .sort(sortNotifications)
                .slice(0, input.max_notifications ?? 50),
        };
    }
    async markRead(input) {
        if (!Array.isArray(input.notification_ids) || input.notification_ids.length === 0) {
            throw new Error("notification_ids must be a non-empty array.");
        }
        const timestamp = nowIso();
        return this.store.updateState((state) => {
            const marked = [];
            for (const id of input.notification_ids) {
                const notification = state.notifications[id];
                if (!notification) {
                    continue;
                }
                notification.read = true;
                notification.read_at = timestamp;
                marked.push(id);
            }
            return { marked_read: marked };
        });
    }
    async getWakeCandidates(input) {
        const state = await this.store.readState();
        return selectWakeCandidates(Object.values(state.notifications), input);
    }
}
export function selectWakeCandidates(notifications, input) {
    const wakeOn = new Set(input.wake_on?.length ? input.wake_on : defaultWakeTypes());
    const since = input.since_event_id ?? 0;
    return filterNotifications(notifications, {
        projectId: input.project_id,
        planId: input.plan_id,
        onlyUnread: true,
    })
        .filter((notification) => notification.event_id > since)
        .filter((notification) => wakeOn.has(notification.type))
        .sort(sortNotifications)
        .slice(0, input.max_events ?? 5);
}
function filterNotifications(notifications, filters) {
    const minPriority = filters.minPriority ? normalizePriority(filters.minPriority) : undefined;
    return notifications.filter((notification) => {
        if (filters.projectId && notification.project_id !== filters.projectId) {
            return false;
        }
        if (filters.planId && notification.plan_id !== filters.planId) {
            return false;
        }
        if (filters.onlyUnread && notification.read) {
            return false;
        }
        if (minPriority && priorityRank(notification.priority) < priorityRank(minPriority)) {
            return false;
        }
        return true;
    });
}
function sortNotifications(a, b) {
    const priority = comparePriority(a.priority, b.priority);
    if (priority !== 0) {
        return priority;
    }
    return a.event_id - b.event_id;
}
function normalizePriority(priority) {
    if (!WAKE_PRIORITIES.includes(priority)) {
        throw new Error(`min_priority must be one of: ${WAKE_PRIORITIES.join(", ")}.`);
    }
    return priority;
}
//# sourceMappingURL=supervisor_inbox.js.map