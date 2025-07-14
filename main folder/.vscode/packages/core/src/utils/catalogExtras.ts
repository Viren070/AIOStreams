import { Extras, ExtrasSchema, ExtrasTypesSchema } from '../db/schemas';

export class CatalogExtras {
  private extras: Partial<Extras>;

  constructor(extras?: string) {
    this.extras = this.parseExtras(extras);
  }

  private parseExtras(extras?: string): Partial<Extras> {
    if (!extras) {
      return {};
    }
    const mapped = extras.split('&').map((e) => {
      const [key, value] = e.split('=');
      return { key, value };
    });
    const extrasObject = Object.fromEntries(
      mapped.map(({ key, value }) => {
        if (ExtrasTypesSchema.safeParse(key).success) {
          return [key, value];
        }
        return [key, undefined];
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

  get year(): number | undefined {
    return 'year' in this.extras ? this.extras.year : undefined;
  }

  set year(value: number | undefined) {
    this.extras = { ...this.extras, year: value };
  }

  get month(): number | undefined {
    return 'month' in this.extras ? this.extras.month : undefined;
  }

  set month(value: number | undefined) {
    this.extras = { ...this.extras, month: value };
  }

  get notifications(): string | undefined {
    return 'notifications' in this.extras ? this.extras.notifications : undefined;
  }

  set notifications(value: string | undefined) {
    this.extras = { ...this.extras, notifications: value };
  }

  public toString(): string {
    return Object.entries(this.extras)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }
}
