import { RequestExecutor } from "./internal";
import { NemaError } from "./errors";
import { NemaDatabase, withDynamicCollections } from "./database";
import { NemaCollection } from "./collection";

export interface NemaClientOptions {
  /** The nemadb-gateway's base URL, e.g. `"http://127.0.0.1:8070"`. */
  url: string;
  /**
   * Sent as `Authorization: Bearer <apiKey>` on every request except
   * `/health`. Only needed if the gateway was started with
   * `--api-key`/`NEMADB_API_KEY` — harmless to omit otherwise.
   */
  apiKey?: string;
}

/**
 * A connection to one NemaDb gateway. Talks to it exactly the way the
 * Workbench and NemaDb's own shell do: plain HTTP/JSON, no custom wire
 * protocol — see the gateway's own docs for the full endpoint list
 * this wraps.
 */
export class NemaClient implements RequestExecutor {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: NemaClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  /**
   * The low-level call every other method goes through. Public
   * (rather than hidden entirely) as an escape hatch for a gateway
   * route this package hasn't wrapped yet, and because
   * `NemaDatabase`/`NemaCollection` need it too — see `internal.ts`
   * for why they depend on the `RequestExecutor` shape instead of this
   * concrete class.
   */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined && method !== "GET" && method !== "DELETE") {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new NemaError(`could not reach NemaDb gateway at ${this.baseUrl}: ${message}`, 0);
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const message = (data && typeof data === "object" && "error" in data && String(data.error)) || `request failed: ${res.status}`;
      throw new NemaError(message, res.status);
    }
    return data as T;
  }

  /** Whether the gateway is reachable at all. Never throws. */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Lists every database on this gateway. */
  async listDatabases(): Promise<string[]> {
    return this.request("GET", "/databases");
  }

  /** Creates a new, empty database. */
  async createDatabase(name: string): Promise<{ name: string }> {
    return this.request("POST", "/databases", { name });
  }

  /** Drops a database and every collection/document in it. Cannot be undone. */
  async dropDatabase(name: string): Promise<void> {
    await this.request("DELETE", `/databases/${encodeURIComponent(name)}`);
  }

  /**
   * A handle to a database. Does not itself check that the database
   * exists — that only happens once you call something on it (or
   * `createCollection`/an insert) that actually reaches the gateway.
   *
   * The returned handle also supports `db.posts` as shorthand for
   * `db.collection("posts")` — any collection name works, not just
   * ones with types declared for them, hence the `Record` in the
   * return type. See `withDynamicCollections` for why `then`/`catch`/
   * `finally`/`toJSON` are the one thing this never treats as a
   * collection name.
   */
  db(name: string): NemaDatabase & Record<string, NemaCollection> {
    return withDynamicCollections(new NemaDatabase(this, name));
  }
}
