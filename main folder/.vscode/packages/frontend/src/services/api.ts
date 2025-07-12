import { FormatterType, ParsedStream, UserData } from '@aiostreams/core';

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
        method: 'PUT',
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
        method: 'POST',
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

  static async formatStream(
    stream: ParsedStream,
    formatter: FormatterType,
    definition?: { name: string; description: string },
    addonName?: string
  ): Promise<ApiResponse<{ name: string; description: string }>> {
    const response = await fetch(`${this.BASE_URL}/format`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stream,
        formatter,
        definition,
        addonName,
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
}
