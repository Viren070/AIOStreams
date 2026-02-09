/**
 * API Client Library
 *
 */

// =============================================================================
// Types
// =============================================================================

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type Endpoint = `${Method} /${string}` | `/${string}`;

/**
 * Standard API Response structure from the server
 */
interface APIResponse<T> {
  success: boolean;
  detail: string | null;
  data: T | null;
  error: {
    code: string;
    message: string;
    issues?: any;
  } | null;
}

// =============================================================================
// API Error Class
// =============================================================================

/**
 * API Error thrown when the server returns an error response
 */
export class APIError extends Error {
  status: number;
  code: string;
  detail: string | null;
  issues?: any;

  constructor(
    status: number,
    code: string,
    message: string,
    detail: string | null = null,
    issues?: any
  ) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.issues = issues;
  }

  /**
   * Check if this is a specific error code
   */
  is(code: string): boolean {
    return this.code === code;
  }
}

// =============================================================================
// Request Options
// =============================================================================

type RequestOptions = Omit<RequestInit, 'body' | 'method'> & {
  body?: Record<string, unknown> | FormData | string;
};

// =============================================================================
// API Client
// =============================================================================

/**
 * Make a type-safe API request
 *
 * @param endpoint - API endpoint (e.g., "GET /quizzes" or "/quizzes")
 * @param options - Request options
 * @returns The data from a successful response
 * @throws APIError if the server returns an error
 *
 * @example
 * // GET request
 * const quiz = await api<QuizResponse>('/quizzes/123');
 *
 * // POST with body
 * const newQuiz = await api<QuizResponse>('POST /quizzes', {
 *   body: { title: 'My Quiz', description: 'A fun quiz' }
 * });
 *
 * // Handle errors
 * try {
 *   await api('POST /auth/login', { body: { email, password } });
 * } catch (err) {
 *   if (err instanceof APIError) {
 *     if (err.is('UNAUTHORIZED')) {
 *       // Invalid credentials
 *     }
 *     if (err.is('VALIDATION_ERROR')) {
 *       const issues = err.issues;
 *       // Handle validation issues
 *     }
 *   }
 * }
 */
export async function api<T>(
  endpoint: Endpoint,
  options: RequestOptions = {}
): Promise<T> {
  const { body, ...fetchOptions } = options;

  // Parse endpoint for method and path
  const [method, path] = endpoint.includes(' /')
    ? (endpoint.split(' /') as [Method, string])
    : (['GET', endpoint.slice(1)] as [Method, string]);

  const url = `/api/v1/${path}`;

  // Build request
  const headers = new Headers(fetchOptions.headers);

  const request: RequestInit = {
    method,
    credentials: 'include',
    ...fetchOptions,
    headers,
  };

  // Handle body
  if (body !== undefined) {
    if (body instanceof FormData) {
      request.body = body;
    } else if (typeof body === 'string') {
      request.body = body;
    } else {
      headers.set('Content-Type', 'application/json');
      request.body = JSON.stringify(body);
    }
  }

  // Make request
  const response = await fetch(url, request);

  // Handle 204 No Content
  if (response.status === 204) {
    return null as T;
  }

  // Check content type
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON response but got ${contentType} response of ${response.status} ${response.statusText}`
    );
  }

  // Parse response
  const json = (await response.json()) as APIResponse<T>;

  // Handle error response
  if (!json.success) {
    const errorCode = json.error?.code || 'UNKNOWN_ERROR';
    const errorMessage = json.error?.message || 'An unknown error occurred';
    const detail = json.detail;
    const issues = json.error?.issues;

    throw new APIError(
      response.status,
      errorCode,
      errorMessage,
      detail,
      issues
    );
  }

  // Return data (null is a valid response)
  return json.data as T;
}

// =============================================================================
// API Helper Functions
// =============================================================================

// Import types from core package (types only)
import type { UserData, ParsedStream } from '@aiostreams/core';

/**
 * User configuration response types
 */
interface LoadUserResponse {
  userData: UserData;
  encryptedPassword: string;
}

interface CreateUserResponse {
  uuid: string;
  encryptedPassword: string;
}

interface UpdateUserResponse {
  uuid: string;
  userData: UserData;
}

interface ResolvePatternsResponse {
  patterns: { name: string; pattern: string; score?: number }[];
}

interface ResolveSyncedResponse {
  patterns?: { name: string; pattern: string; score?: number }[];
  expressions?: {
    expression: string;
    name?: string;
    score?: number;
    enabled?: boolean;
  }[];
  errors?: { url: string; error: string }[];
}

interface FormatStreamResponse {
  name: string;
  description: string;
}

interface CatalogInfo {
  id: string;
  type: string;
  name: string;
  hideable: boolean;
  searchable: boolean;
  addonName: string;
}

interface GDriveTokenResponse {
  accessToken: string;
  refreshToken: string;
}

/**
 * Load user configuration
 */
export async function loadUserConfig(uuid: string, password: string) {
  return api<LoadUserResponse>(
    `GET /user?uuid=${uuid}&password=${encodeURIComponent(password)}`
  );
}

/**
 * Create user configuration
 */
export async function createUserConfig(config: UserData, password: string) {
  return api<CreateUserResponse>('POST /user', {
    body: { config, password },
  });
}

/**
 * Update user configuration
 */
export async function updateUserConfig(
  uuid: string,
  config: UserData,
  password: string
) {
  return api<UpdateUserResponse>('PUT /user', {
    body: { uuid, config, password },
  });
}

/**
 * Delete user
 */
export async function deleteUserConfig(uuid: string, password: string) {
  return api<void>('DELETE /user', {
    body: { uuid, password },
  });
}

/**
 * Resolve synced items (regex patterns and/or stream expressions) from URLs
 */
export async function resolveSynced(
  options: {
    regexUrls?: string[];
    selUrls?: string[];
  },
  credentials?: { uuid: string; password: string }
) {
  return api<ResolveSyncedResponse>('POST /sync/resolve', {
    body: {
      regexUrls: options.regexUrls,
      selUrls: options.selUrls,
      uuid: credentials?.uuid,
      password: credentials?.password,
    },
  });
}

/**
 * Resolve regex patterns from URLs (convenience wrapper)
 */
export async function resolveRegexPatterns(
  urls: string[],
  credentials?: { uuid: string; password: string }
) {
  const result = await resolveSynced({ regexUrls: urls }, credentials);
  return { patterns: result.patterns || [], errors: result.errors };
}

/**
 * Resolve stream expressions from URLs (convenience wrapper)
 */
export async function resolveStreamExpressions(
  urls: string[],
  credentials?: { uuid: string; password: string }
) {
  const result = await resolveSynced({ selUrls: urls }, credentials);
  return { expressions: result.expressions || [], errors: result.errors };
}

/**
 * Format stream for display
 */
export async function getFormattedStream(stream: ParsedStream, context?: any) {
  return api<FormatStreamResponse>('POST /format', {
    body: { stream, context },
  });
}

/**
 * Get catalogs for user data
 */
export async function fetchCatalogs(userData: UserData) {
  return api<CatalogInfo[]>('POST /catalogs', {
    body: { userData },
  });
}

/**
 * Exchange Google Drive OAuth code for tokens
 */
export async function exchangeGDriveCode(code: string) {
  return api<GDriveTokenResponse>('POST /oauth/exchange/gdrive', {
    body: { code },
  });
}

/**
 * Get templates
 */
export async function fetchTemplates() {
  return api<any[]>('GET /templates');
}

export type {
  ParsedStream,
  LoadUserResponse,
  CreateUserResponse,
  UpdateUserResponse,
  ResolvePatternsResponse,
  ResolveSyncedResponse,
  FormatStreamResponse,
  CatalogInfo,
  GDriveTokenResponse,
};
