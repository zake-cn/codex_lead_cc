import { createRuntime } from "../orchestrator/runtime.js";
import type { GetUpdatesInput } from "../types.js";

export async function ccGetUpdates(input: GetUpdatesInput) {
  const runtime = createRuntime();
  return runtime.events.getUpdates(input);
}
