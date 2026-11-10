import { PgsSets, type DrawnSet } from './sets';

export type PgsRequest =
  | { add: { startMs: number; data: Uint8Array }[] }
  | { drop: number }
  | { draw: number; id: number };

export interface PgsReply {
  id: number;
  drawn: DrawnSet | null;
}

const scope = self as unknown as Worker;
const sets = new PgsSets();

scope.onmessage = ({ data }: MessageEvent<PgsRequest>) => {
  if ('add' in data) sets.add(data.add);
  else if ('drop' in data) sets.drop(data.drop);
  else {
    const { id } = data;
    void sets
      .draw(data.draw)
      .catch(() => null)
      .then((drawn) =>
        scope.postMessage(
          { id, drawn } satisfies PgsReply,
          drawn?.pictures.map((p) => p.image) ?? []
        )
      );
  }
};
