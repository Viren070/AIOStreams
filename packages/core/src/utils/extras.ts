import { Extras, ExtrasSchema } from '../db/schemas.js';

export class ExtrasParser {
  private extras: Partial<Extras>;

  constructor(extras?: string) {
    this.extras = this.parseExtras(extras);
  }

  private parseExtras(extras?: string): Partial<Extras> {
    if (!extras) {
      return {};
    }
    const extrasObject = Object.fromEntries(
      extras.split('&').map((e) => {
        const [key, value] = e.split('=');
        return [key, encodeURIComponent(value)];
      })
    );

    const parsedExtras = ExtrasSchema.safeParse(extrasObject);
    if (!parsedExtras.success) {
      return {};
    }

    return parsedExtras.data;
  }

  get genre(): string | undefined {
    return 'genre' in this.extras ? this.extras.genre : undefined;
  }

  set genre(value: string | undefined) {
    this.extras = { ...this.extras, genre: value };
  }

  get search(): string | undefined {
    return 'search' in this.extras ? this.extras.search : undefined;
  }

  set search(value: string | undefined) {
    this.extras = { ...this.extras, search: value };
  }

  get skip(): number | undefined {
    return 'skip' in this.extras ? this.extras.skip : undefined;
  }

  set skip(value: number | undefined) {
    this.extras = { ...this.extras, skip: value };
  }

  public toString(): string {
    return Object.entries(this.extras)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }
}
