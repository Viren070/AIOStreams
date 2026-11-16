import { failedTest, type EndpointTestResult } from '../test-result.js';
import { XtreamClient, type XtreamLogin } from './api.js';

export async function testXtreamLogin(
  login: XtreamLogin
): Promise<EndpointTestResult> {
  let client: XtreamClient;
  try {
    client = new XtreamClient(login);
  } catch (err) {
    return failedTest(
      err instanceof Error ? err.message : 'That is not a valid address'
    );
  }
  try {
    const info = (await client.account(true)).user_info ?? {};
    const expires = Number(info.exp_date);
    const connections = Number(info.max_connections);
    return {
      ok: true,
      title: `Signed in to ${new URL(client.base).host}`,
      description: [
        expires > 0
          ? `expires ${new Date(expires * 1000).toISOString().slice(0, 10)}`
          : 'never expires',
        connections > 0 &&
          `${connections} connection${connections === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  } catch (err) {
    return failedTest(err instanceof Error ? err.message : String(err));
  }
}
