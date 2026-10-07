/**
 * What `NemaDatabase`/`NemaCollection` need from a client, expressed
 * as an interface rather than importing the concrete `NemaClient`
 * class directly — `NemaClient.db()` returns a `NemaDatabase`, so a
 * direct import the other way would make `client.ts` and
 * `database.ts` import each other. Depending only on this shape
 * avoids that entirely.
 */
export interface RequestExecutor {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}
