/** Thrown for any non-2xx response from the NemaDb gateway. */
export class NemaError extends Error {
  /** The HTTP status code the gateway responded with. */
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NemaError";
    this.status = status;
    Object.setPrototypeOf(this, NemaError.prototype);
  }
}
