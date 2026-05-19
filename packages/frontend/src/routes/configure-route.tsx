import ConfigurePage from '@/app/configure/page';

// Auth gating and status pre-fetch are handled by the route's beforeLoad in
// router.tsx — this component just renders the configure UI.
export function ConfigureRoute() {
  return <ConfigurePage />;
}
