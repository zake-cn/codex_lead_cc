export interface GatewaySuccess<T = unknown> {
  ok: true;
  action: string;
  data: T;
  warnings: string[];
}

export interface GatewayFailure {
  ok: false;
  action: string;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  warnings: string[];
}

export type GatewayResult<T = unknown> = GatewaySuccess<T> | GatewayFailure;

export async function gatewayCall<T>(
  action: string,
  fn: () => Promise<T>,
  warnings: string[] = [],
): Promise<GatewayResult<T>> {
  try {
    return {
      ok: true,
      action,
      data: await fn(),
      warnings,
    };
  } catch (error) {
    return gatewayFailure(action, error, warnings);
  }
}

export function gatewayFailure(
  action: string,
  error: unknown,
  warnings: string[] = [],
): GatewayFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    action,
    error: {
      code: errorCodeForMessage(message),
      message,
      recoverable: isRecoverable(message),
    },
    warnings,
  };
}

function errorCodeForMessage(message: string): string {
  if (/task not found/i.test(message)) {
    return "TASK_NOT_FOUND";
  }
  if (/worker not found/i.test(message)) {
    return "WORKER_NOT_FOUND";
  }
  if (/plan not found/i.test(message)) {
    return "PLAN_NOT_FOUND";
  }
  if (/permission request not found/i.test(message)) {
    return "PERMISSION_NOT_FOUND";
  }
  if (/required|must be|invalid|unknown action/i.test(message)) {
    return "INVALID_INPUT";
  }
  if (/already running|busy/i.test(message)) {
    return "WORKER_BUSY";
  }
  if (/timed out|timeout/i.test(message)) {
    return "TIMEOUT";
  }
  return "INTERNAL_ERROR";
}

function isRecoverable(message: string): boolean {
  return !/permission denied by policy|not a directory|does not exist/i.test(message);
}
