export type ZoteroErrorCode =
  | "INVALID_CONFIG"
  | "UNAVAILABLE"
  | "EXPORT_UNAVAILABLE"
  | "CANCELLED"
  | "TIMEOUT"
  | "FORBIDDEN"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "AUTH_REQUIRED"
  | "CONFLICT"
  | "WRITE_UNSUPPORTED"
  | "BUSY";

/** Einheitliche Fehler für die Oberfläche und den späteren MCP-Server. */
export class ZoteroError extends Error {
  readonly status: number | undefined;
  constructor(
    readonly code: ZoteroErrorCode,
    message: string,
    options?: ErrorOptions & { readonly status?: number },
  ) {
    super(message, options);
    this.name = "ZoteroError";
    this.status = options?.status;
  }
}
