export async function gatewayCall(action, fn, warnings = []) {
    try {
        return {
            ok: true,
            action,
            data: await fn(),
            warnings,
        };
    }
    catch (error) {
        return gatewayFailure(action, error, warnings);
    }
}
export function gatewayFailure(action, error, warnings = []) {
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
function errorCodeForMessage(message) {
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
function isRecoverable(message) {
    return !/permission denied by policy|not a directory|does not exist/i.test(message);
}
//# sourceMappingURL=gateway_result.js.map