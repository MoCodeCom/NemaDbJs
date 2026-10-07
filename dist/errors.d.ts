/** Thrown for any non-2xx response from the NemaDb gateway. */
export declare class NemaError extends Error {
    /** The HTTP status code the gateway responded with. */
    readonly status: number;
    constructor(message: string, status: number);
}
