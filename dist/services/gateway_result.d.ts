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
export declare function gatewayCall<T>(action: string, fn: () => Promise<T>, warnings?: string[]): Promise<GatewayResult<T>>;
export declare function gatewayFailure(action: string, error: unknown, warnings?: string[]): GatewayFailure;
