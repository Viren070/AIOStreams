import { createLogger } from '@aiostreams/core';
const logger = createLogger('server');

type ApiResponseOptions = {
  success: boolean;
  detail?: string;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
};

export function createResponse(options: ApiResponseOptions) {
  const { success, detail, data, error } = options;

  return {
    success,
    detail: detail || null,
    data: data || null,
    error: error || null,
  };
}
