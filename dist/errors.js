"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NemaError = void 0;
/** Thrown for any non-2xx response from the NemaDb gateway. */
class NemaError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "NemaError";
        this.status = status;
        Object.setPrototypeOf(this, NemaError.prototype);
    }
}
exports.NemaError = NemaError;
