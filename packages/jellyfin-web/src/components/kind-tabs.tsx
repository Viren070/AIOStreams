import { Button } from '@aiostreams/ui/button';

export const KINDS = [
  { label: 'All', types: 'Movie,Series' },
  { label: 'Movies', types: 'Movie' },
  { label: 'Shows', types: 'Series' },
];

export function KindTabs({
  types,
  onChange,
}: {
  types: string;
  onChange: (types: string) => void;
}) {
  return (
    <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-gray-900 p-1 [scrollbar-width:none]">
      {KINDS.map((kind) => (
        <Button
          key={kind.label}
          size="xs"
          intent={types === kind.types ? 'white' : 'gray-basic'}
          className="rounded-full"
          onClick={() => onChange(kind.types)}
        >
          {kind.label}
        </Button>
      ))}
    </div>
  );
}
