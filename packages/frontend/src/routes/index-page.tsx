import { Button } from '@/components/ui/button';
import { useNavigate } from '@tanstack/react-router';

export function IndexPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/logo.png"
          alt="AIOStreams"
          className="max-h-[90px] object-contain"
        />
        <h1 className="text-3xl font-semibold tracking-tight">AIOStreams</h1>
        <p className="max-w-md text-[--muted]">
          The all-in-one addon for Stremio. Configure your addon or manage this
          instance from the dashboard.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          intent="primary"
          onClick={() => {
            navigate({ to: '/stremio/configure' });
          }}
        >
          Configure
        </Button>
        <Button
          intent="primary-outline"
          onClick={() => navigate({ to: '/dashboard' })}
        >
          Dashboard
        </Button>
        <Button
          intent="gray-outline"
          onClick={() =>
            window.open('https://docs.aiostreams.viren070.me', '_blank')
          }
        >
          Documentation
        </Button>
      </div>
    </main>
  );
}
