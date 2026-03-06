import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { instances } from '@/lib/instances';
import { Callout } from 'fumadocs-ui/components/callout';

export function InstanceTabs() {
  return (
    <Tabs items={instances.map((i) => i.name)}>
      {instances.map((instance) => {
        const link = (base: string) => `${base}/stremio/configure`;
        const label = (base: string) => base.replace('https://', '');

        return (
          <Tab key={instance.id} value={instance.name}>
            <h3 className="mt-0 flex items-center gap-2">
              {instance.name} AIOStreams
            </h3>

            {instance.hostedBy && (
              <p>
                Hosted by{' '}
                {instance.hostedByUrl ? (
                  <a href={instance.hostedByUrl}>{instance.hostedBy}</a>
                ) : (
                  instance.hostedBy
                )}
                .
              </p>
            )}

            {instance.description && <p>{instance.description}</p>}

            {instance.warning && (
              <Callout type="warning">{instance.warning}</Callout>
            )}

            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                {instance.stable && (
                  <tr>
                    <td>Stable</td>
                    <td>
                      <a href={link(instance.stable)}>
                        {label(instance.stable)}
                      </a>
                    </td>
                  </tr>
                )}
                {instance.nightly && (
                  <tr>
                    <td>Nightly</td>
                    <td>
                      <a href={link(instance.nightly)}>
                        {label(instance.nightly)}
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Tab>
        );
      })}
    </Tabs>
  );
}
