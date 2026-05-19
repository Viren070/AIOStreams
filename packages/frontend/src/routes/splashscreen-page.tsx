import { LoadingOverlay } from '@/components/ui/loading-spinner';

export function SplashscreenPage() {
  return (
    <LoadingOverlay showSpinner={false}>
      <img
        src="/logo_2.png"
        alt="Launching..."
        width={180}
        height={180}
        className="animate-pulse"
      />
      Launching...
    </LoadingOverlay>
  );
}
