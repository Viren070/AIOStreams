import { ParsedStream, UserData } from '@aiostreams/core';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface CreateUserResponse {
  uuid: string;
  encryptedPassword: string;
}

interface LoadUserResponse {
  config: UserData;
  encryptedPassword: string;
}

export class UserConfigAPI {
  private static BASE_URL =
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL || '/api/v1';

  static async loadConfig(
    uuid: string,
    password: string
  ): Promise<ApiResponse<LoadUserResponse>> {
    try {
      const response = await fetch(
        `${this.BASE_URL}/user?uuid=${uuid}&password=${encodeURIComponent(password)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'Failed to load configuration',
          },
        };
      }

      return {
        success: true,
        data: {
          config: data.data.userData,
          encryptedPassword: data.data.encryptedPassword,
        } as LoadUserResponse,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message:
            err instanceof Error ? err.message : 'Failed to load configuration',
        },
      };
    }
  }

  static async createConfig(
    config: UserData,
    password: string
  ): Promise<ApiResponse<CreateUserResponse>> {
    try {
      const response = await fetch(`${this.BASE_URL}/user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'Failed to create configuration',
          },
        };
      }

      return {
        success: true,
        data: {
          uuid: data.data.uuid,
          encryptedPassword: data.data.encryptedPassword,
        } as CreateUserResponse,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to create configuration',
        },
      };
    }
  }

  static async updateConfig(
    uuid: string,
    config: UserData,
    password: string
  ): Promise<ApiResponse<void>> {
    try {
      const response = await fetch(`${this.BASE_URL}/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config,
          password,
          uuid,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'Failed to update configuration',
          },
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to update configuration',
        },
      };
    }
  }

  static async deleteUser(
    uuid: string,
    password: string
  ): Promise<ApiResponse<void>> {
    try {
      const response = await fetch(`${this.BASE_URL}/user`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uuid,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'Failed to delete configuration',
          },
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to delete configuration',
        },
      };
    }
  }

  static async resolvePatterns(
    urls: string[]
  ): Promise<ApiResponse<{ patterns: { name: string; pattern: string; score?: number }[] }>> {
    try {
      const response = await fetch(`${this.BASE_URL}/user/resolve_patterns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ urls }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'Failed to resolve patterns',
          },
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message:
            err instanceof Error ? err.message : 'Failed to resolve patterns',
        },
      };
    }
  }

  static async formatStream(
    stream: ParsedStream,
    userData: UserData
  ): Promise<ApiResponse<{ name: string; description: string }>> {
    const response = await fetch(`${this.BASE_URL}/format`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stream,
        userData,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: data.error?.code || 'UNKNOWN_ERROR',
          message: data.error?.message || 'Failed to format stream',
        },
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  static async getCatalogs(userData: UserData): Promise<
    ApiResponse<
      {
        id: string;
        type: string;
        name: string;
        hideable: boolean;
        searchable: boolean;
        addonName: string;
      }[]
    >
  > {
    try {
      const response = await fetch(`${this.BASE_URL}/catalogs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userData,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'Failed to get catalogs',
          },
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message:
            err instanceof Error ? err.message : 'Failed to get catalogs',
        },
      };
    }
  }

  static async exchangeGDriveAuthCode(code: string): Promise<
    ApiResponse<{
      accessToken: string;
      refreshToken: string;
    }>
  > {
    if (!code) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Code is required',
        },
      };
    }
    const response = await fetch(`${this.BASE_URL}/oauth/exchange/gdrive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: data.error?.code || 'UNKNOWN_ERROR',
          message: data.error?.message || 'Failed to exchange GDrive auth code',
        },
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }
}
