export type DetectionErrorCode = "invalid_url" | "unreachable" | "timeout" | "internal";
export type UnreachableReason = "dns" | "refused" | "tls" | "blocked" | "http_error" | "network";

const STATUS: Record<DetectionErrorCode, number> = {
  invalid_url: 400,
  unreachable: 422,
  timeout: 504,
  internal: 500,
};

export class DetectionError extends Error {
  readonly code: DetectionErrorCode;
  readonly reason?: UnreachableReason;
  readonly status: number;

  constructor(code: DetectionErrorCode, message: string, reason?: UnreachableReason) {
    super(message);
    this.name = "DetectionError";
    this.code = code;
    this.reason = reason;
    this.status = STATUS[code];
  }
}
