import { Cache, createLogger, Env, makeRequest } from '../../utils/index.js';
import {
  GDriveFile,
  GDriveFileGetResponseSchema,
  GDriveFileQueryResponseSchema,
  RefreshTokenResponse,
  RefreshTokenResponseSchema,
} from './schemas.js';

const accessTokenCache = Cache.getInstance<string, string>(
  'gdrive-access-token'
);
const logger = createLogger('gdrive');

interface GDriveFileQueryParams {
  q?: string;
  pageSize?: number;
  pageToken?: string;
  fields?: string;
  includeItemsFromAllDrives?: boolean;
  supportsAllDrives?: boolean;
  corpora?: string;
  driveId?: string;
  orderBy?: string;
  includeLabels?: string;
}

interface GDriveFileGetParams {
  acknowledgeAbuse?: boolean;
  supportsAllDrives?: boolean;
  includeLabels?: string;
  includePermissionsForView?: string;
  fields?: string;
}

export enum GoogleOAuthErrorCode {
  INVALID_CLIENT = 'invalid_client',
  INVALID_GRANT = 'invalid_grant',
  INVALID_REQUEST = 'invalid_request',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type',
}

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    public readonly errorCode: GoogleOAuthErrorCode,
    public readonly errorDescription: string
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

export class GDriveAPIError extends Error {
  constructor(
    message: string,
    public readonly errorCode: number
  ) {
    super(message);
    this.name = 'GDriveAPIError';
  }
}

export class GoogleOAuth {
  private static readonly tokenUrl: string =
    'https://oauth2.googleapis.com/token';
  private static readonly oauthUrl: string =
    'https://accounts.google.com/o/oauth2/v2/auth';

  private refreshToken: string;
  private accessToken: string | undefined;

  constructor(refreshToken: string) {
    if (!Env.BUILTIN_GDRIVE_CLIENT_ID || !Env.BUILTIN_GDRIVE_CLIENT_SECRET) {
      throw new Error('Builtin GDrive client ID and secret are not set');
    }
    this.refreshToken = refreshToken;
    this.accessToken = undefined;
  }

  private static get clientId(): string {
    if (!Env.BUILTIN_GDRIVE_CLIENT_ID) {
      throw new Error('Builtin GDrive client ID is not set');
    }
    return Env.BUILTIN_GDRIVE_CLIENT_ID;
  }

  private static get clientSecret(): string {
    if (!Env.BUILTIN_GDRIVE_CLIENT_SECRET) {
      throw new Error('Builtin GDrive client secret is not set');
    }
    return Env.BUILTIN_GDRIVE_CLIENT_SECRET;
  }

  private static get redirectUrl(): string {
    if (!Env.BASE_URL) {
      throw new Error('Base URL is not set');
    }
    return `${Env.BASE_URL}/oauth/callback/gdrive`;
  }

  static getAuthorisationUrl() {
    const params = new URLSearchParams({
      client_id: GoogleOAuth.clientId,
      redirect_uri: GoogleOAuth.redirectUrl,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive',
      prompt: 'consent',
      access_type: 'offline',
    });
    return `${GoogleOAuth.oauthUrl}?${params.toString()}`;
  }

  static async exchangeAuthorisationCode(
    code: string
  ): Promise<RefreshTokenResponse> {
    const params = new URLSearchParams({
      client_id: GoogleOAuth.clientId,
      client_secret: GoogleOAuth.clientSecret,
      code,
      redirect_uri: GoogleOAuth.redirectUrl,
      grant_type: 'authorization_code',
      scope: '',
    });

    const response = await fetch(GoogleOAuth.tokenUrl, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = await response.json();
    const parsedResponse = RefreshTokenResponseSchema.safeParse(data);

    if (!parsedResponse.success) {
      throw new Error('Failed to parse authorisation code response');
    }

    if ('error' in parsedResponse.data) {
      throw new GoogleOAuthError(
        `Failed to exchange authorisation code`,
        parsedResponse.data.error as GoogleOAuthErrorCode,
        parsedResponse.data.error_description
      );
    }

    return parsedResponse.data;
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    await this.refreshAccessToken();
    if (!this.accessToken) {
      throw new Error('Failed to get or refresh access token');
    }
    return this.accessToken;
  }

  private async refreshAccessToken(): Promise<void> {
    const cachedToken = await accessTokenCache.get(this.refreshToken);
    if (cachedToken) {
      this.accessToken = cachedToken;
      return;
    }

    const params = new URLSearchParams({
      client_id: GoogleOAuth.clientId,
      client_secret: GoogleOAuth.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });

    try {
      const response = await fetch(GoogleOAuth.tokenUrl, {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const data = await response.json();
      const parsedResponse = RefreshTokenResponseSchema.safeParse(data);

      if (!parsedResponse.success) {
        throw new Error('Failed to parse refresh token response');
      }

      if ('error' in parsedResponse.data) {
        throw new GoogleOAuthError(
          `Failed to refresh token`,
          parsedResponse.data.error as GoogleOAuthErrorCode,
          parsedResponse.data.error_description
        );
      }

      const { access_token, expires_in } = parsedResponse.data;
      accessTokenCache.set(this.refreshToken, access_token, expires_in);
      this.accessToken = access_token;
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        throw error;
      }
      throw new Error(
        `Failed to refresh token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export class GDriveAPI {
  private static readonly baseUrl: string =
    'https://www.googleapis.com/drive/v3';
  private oauth: GoogleOAuth;

  constructor(oauth: GoogleOAuth) {
    this.oauth = oauth;
  }

  private async getHeaders() {
    const token = await this.oauth.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  public async listFiles(params: GDriveFileQueryParams) {
    const url = new URL(`${GDriveAPI.baseUrl}/files`);
    url.search = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined)
      ) as Record<string, string>
    ).toString();
    const headers = await this.getHeaders();
    const response = await makeRequest(url.toString(), {
      headers,
      timeout: 10000,
    });

    const data = await response.json();
    const parsedResponse = GDriveFileQueryResponseSchema.safeParse(data);

    if (!parsedResponse.success || !parsedResponse.data) {
      throw new Error('Failed to parse GDrive file query response');
    }

    if ('error' in parsedResponse.data) {
      let errorMsg = parsedResponse.data.error.message;
      if (parsedResponse.data.error.errors) {
        errorMsg += `, ${parsedResponse.data.error.errors.map((error) => `[${error.reason}] ${error.message} at ${error.location}`).join(', ')}`;
      }
      throw new GDriveAPIError(
        `GDrive API error: ${errorMsg}`,
        parsedResponse.data.error.code
      );
    }

    return {
      files: parsedResponse.data.files,
      nextPageToken: parsedResponse.data.nextPageToken,
      incompleteSearch: parsedResponse.data.incompleteSearch,
      kind: parsedResponse.data.kind,
    };
  }

  public async getFile(
    fileId: string,
    params: GDriveFileGetParams
  ): Promise<GDriveFile> {
    const url = new URL(`${GDriveAPI.baseUrl}/files/${fileId}`);
    url.search = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== undefined)
      ) as Record<string, string>
    ).toString();
    const headers = await this.getHeaders();
    const response = await makeRequest(url.toString(), {
      headers,
      timeout: 10000,
    });

    const data = await response.json();
    const parsedResponse = GDriveFileGetResponseSchema.safeParse(data);

    if (!parsedResponse.success || !parsedResponse.data) {
      throw new Error('Failed to parse GDrive file get response');
    }

    if ('error' in parsedResponse.data) {
      throw new Error(
        `GDrive API error: ${parsedResponse.data.error.code}: ${parsedResponse.data.error.message}: ${parsedResponse.data.error.errors.map((error) => `[${error.reason}] ${error.message} at ${error.location}`).join(', ')}`
      );
    }

    return parsedResponse.data;
  }
}
