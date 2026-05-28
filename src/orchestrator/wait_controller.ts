import type {
  AgentForemanState,
  CompactWakeContext,
  SupervisorNotificationRecord,
  WaitForEventsInput,
  WakePacket,
  WakePriority,
} from "../types.js";
import { StateStore } from "./state_store.js";
import { SupervisorInbox, selectWakeCandidates } from "./supervisor_inbox.js";
import { highestPriority } from "./wake_policy.js";

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 55;
const DEFAULT_MAX_EVENTS = 5;
const POLL_INTERVAL_MS = 250;

export class WaitController {
  private readonly inbox: SupervisorInbox;

  constructor(private readonly store: StateStore) {
    this.inbox = new SupervisorInbox(store);
  }

  async waitForEvents(input: WaitForEventsInput): Promise<WakePacket> {
    const timeoutSec = normalizeTimeout(input.timeout_sec);
    const maxEvents = normalizeMaxEvents(input.max_events);
    const startedAt = Date.now();

    for (;;) {
      const state = await this.store.readState();
      const candidates = selectWakeCandidates(Object.values(state.notifications), {
        project_id: input.project_id,
        plan_id: input.plan_id,
        since_event_id: input.since_event_id,
        wake_on: input.wake_on,
        max_events: maxEvents,
      });

      if (candidates.length > 0) {
        return buildWakePacket({
          input,
          state,
          notifications: candidates,
          woke: true,
        });
      }

      if (Date.now() - startedAt >= timeoutSec * 1000) {
        return buildWakePacket({
          input,
          state,
          notifications: [],
          woke: false,
        });
      }

      await delay(POLL_INTERVAL_MS);
    }
  }

  async getWakeCandidates(input: WaitForEventsInput): Promise<SupervisorNotificationRecord[]> {
    return this.inbox.getWakeCandidates(input);
  }
}

function buildWakePacket(args: {
  input: WaitForEventsInput;
  state: AgentForemanState;
  notifications: SupervisorNotificationRecord[];
  woke: boolean;
}): WakePacket {
  const currentLatestEventId = latestEventId(args.state, args.input.project_id);
  if (!args.woke) {
    return {
      woke: false,
      wake_reason: "timeout",
      priority: "low",
      project_id: args.input.project_id,
      plan_id: args.input.plan_id,
      latest_event_id: currentLatestEventId,
      notifications: [],
      message: "No wake-worthy events occurred before timeout.",
      compact_context: compactContext(args.state, args.input.project_id, args.input.plan_id),
    };
  }

  const priority = highestPriority(args.notifications);
  const primary = args.notifications[0];
  return {
    woke: true,
    wake_reason: primary.type,
    priority,
    project_id: args.input.project_id ?? primary.project_id,
    plan_id: args.input.plan_id ?? primary.plan_id,
    latest_event_id: Math.max(currentLatestEventId, ...args.notifications.map((notification) => notification.event_id)),
    notifications: args.notifications,
    suggested_decision: suggestedDecision(primary),
    compact_context: compactContext(args.state, args.input.project_id, args.input.plan_id),
  };
}

function compactContext(
  state: AgentForemanState,
  projectId?: string,
  planId?: string,
): CompactWakeContext {
  const tasks = Object.values(state.tasks).filter((task) => {
    if (projectId && task.project_id !== projectId) {
      return false;
    }
    if (planId && task.plan_id !== planId) {
      return false;
    }
    return true;
  });
  const unreadReports = Object.values(state.notifications).filter((notification) => {
    if (notification.read) {
      return false;
    }
    if (projectId && notification.project_id !== projectId) {
      return false;
    }
    if (planId && notification.plan_id !== planId) {
      return false;
    }
    return Boolean(notification.report_id);
  }).length;

  return {
    active_tasks: tasks.filter((task) => task.status === "running" || task.status === "waiting_permission").length,
    completed_tasks: tasks.filter((task) => task.status === "completed").length,
    pending_permissions: Object.values(state.permission_requests).filter((request) => {
      if (request.status !== "pending") {
        return false;
      }
      return projectId ? request.project_id === projectId : true;
    }).length,
    failed_tasks: tasks.filter((task) => task.status === "failed" || task.status === "timeout").length,
    unread_reports: unreadReports,
  };
}

function latestEventId(state: AgentForemanState, projectId?: string): number {
  return state.events
    .filter((event) => !projectId || event.project_id === projectId)
    .reduce((latest, event) => Math.max(latest, event.event_id), 0);
}

function suggestedDecision(notification: SupervisorNotificationRecord): { type: string; reason: string } {
  if (notification.type === "permission_requested") {
    return {
      type: "review_permission",
      reason: "A worker is blocked waiting for supervisor permission.",
    };
  }
  if (notification.type === "patch_generated") {
    return {
      type: "read_diff_summary",
      reason: "An implementer generated patch artifacts; inspect the diff summary before testing or review.",
    };
  }
  if (notification.type === "test_completed") {
    return {
      type: "read_test_summary",
      reason: "Tester completed; inspect the test report summary before deciding whether to review or request fixes.",
    };
  }
  if (notification.type === "review_completed") {
    return {
      type: "read_review_summary",
      reason: "Reviewer completed; inspect findings and decide accept, request changes, or reject.",
    };
  }
  if (notification.type === "task_failed" || notification.type === "task_timeout") {
    return {
      type: "triage_failure",
      reason: "A worker task failed or timed out and needs supervisor triage.",
    };
  }
  return {
    type: "read_summary_report",
    reason: "A wake-worthy event occurred; inspect lightweight report information before loading full details.",
  };
}

function normalizeTimeout(timeoutSec?: number): number {
  const value = timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("timeout_sec must be a positive integer.");
  }
  return Math.min(value, MAX_TIMEOUT_SEC);
}

function normalizeMaxEvents(maxEvents?: number): number {
  const value = maxEvents ?? DEFAULT_MAX_EVENTS;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("max_events must be a positive integer.");
  }
  return Math.min(value, 25);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
