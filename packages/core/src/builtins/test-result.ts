/** What a configure page's test button shows for an endpoint. */
export interface EndpointTestResult {
  ok: boolean;
  title: string;
  description?: string;
  warning?: { title: string; description: string };
}

export const failedTest = (description: string): EndpointTestResult => ({
  ok: false,
  title: 'Test failed',
  description,
});
