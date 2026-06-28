export type NextFunction = (error?: unknown) => void;

export interface RelayRequest {
  method?: string;
  path?: string;
  url?: string;
  query?: Record<string, unknown>;
  semanticRelay?: SemanticRelayState;
  [key: string]: unknown;
}

export interface RelayResponse {
  statusCode?: number;
  json(data: unknown): unknown;
  send?(data: unknown): unknown;
  [key: string]: unknown;
}

export type RequestHandler = (
  req: RelayRequest,
  res: RelayResponse,
  next: NextFunction
) => unknown;

export interface SemanticRelayIntent {
  intentId: string;
  resource: string;
  page: number;
  limit: number;
  filters: Record<string, unknown>;
}

export interface SemanticRelayQuery {
  filter: Record<string, unknown>;
  skip: number;
  limit: number;
  pages: number[];
  baseLimit: number;
}

export interface SemanticRelayState {
  aggregated: boolean;
  groupSize: number;
  leader?: boolean;
  query: SemanticRelayQuery | null;
  error?: string;
  callbackError?: unknown;
  fallbackReason?: string;
}

export interface SemanticRelayContext {
  req: RelayRequest;
  res: RelayResponse;
  next: NextFunction;
  intent: SemanticRelayIntent;
  resolve(value: unknown[] | null): void;
  reject(error: unknown): void;
}

export interface WindowAdapter {
  add(resourceKey: string, intentCtx: SemanticRelayContext): void;
  flush(resourceKey: string): Promise<SemanticRelayContext[]> | SemanticRelayContext[];
  clear(resourceKey: string): void;
}

export interface SemanticRelayOptions {
  windowMs?: number;
  threshold?: number;
  include?: string[];
  responseTimeoutMs?: number;
  onAggregate?: (group: SemanticRelayContext[]) => void;
  onFallback?: (req: RelayRequest) => void;
  window?: WindowAdapter;
  /** Query param holding the page number. Default 'page'. */
  pageParam?: string;
  /** Query param holding the page size. Default 'limit'. */
  limitParam?: string;
  /**
   * If provided, ONLY these query params are treated as filters. Otherwise
   * every param except the page/limit params is treated as a filter (the safe
   * default — requests differing in any param are never merged).
   */
  filterFields?: string[] | null;
}

export interface SemanticRelayMetrics {
  totalRequests: number;
  aggregatedRequests: number;
  soloRequests: number;
  totalWindowsOpened: number;
  queriesSaved: number;
  reductionPercent: number;
}

/**
 * The effective query a route handler should run, with the leader/follower
 * fallback already applied.
 */
export interface ResolvedQuery {
  filter: Record<string, unknown>;
  skip: number;
  limit: number;
  aggregated: boolean;
  groupSize: number;
}

export interface SemanticRelayMiddleware extends RequestHandler {
  getMetrics(): SemanticRelayMetrics;
  resolve(req: RelayRequest): ResolvedQuery;
}

export class MemoryWindow implements WindowAdapter {
  constructor();
  add(resourceKey: string, intentCtx: SemanticRelayContext): void;
  flush(resourceKey: string): Promise<SemanticRelayContext[]>;
  clear(resourceKey: string): void;
}

export function semanticRelay(options?: SemanticRelayOptions): SemanticRelayMiddleware;

/**
 * Standalone form of the middleware's `resolve` helper. Returns the effective
 * query for a request, applying the leader/follower fallback.
 */
export function resolve(req: RelayRequest): ResolvedQuery;

export default semanticRelay;
