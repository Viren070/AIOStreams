import { zodResolver } from '@hookform/resolvers/zod';
import { FieldValues, get } from 'react-hook-form';
import * as z from 'zod';

export { zodResolver };

export type Options = {
  min?: number;
  max?: number;
};

const getType = (field: z.ZodTypeAny) => {
  if (field instanceof z.ZodArray) return 'array';
  if (field instanceof z.ZodObject) return 'object';
  if (field instanceof z.ZodNumber) return 'number';
  if (field instanceof z.ZodDate) return 'date';
  return 'text';
};

const getArrayOption = (field: any, name: string) => {
  return field._def[name]?.value;
};

/**
 * A helper function to render forms automatically based on a Zod schema
 *
 * @param schema The Zod schema
 * @returns {FieldProps[]}
 */
export const getFieldsFromSchema = (schema: z.ZodTypeAny): FieldValues[] => {
  const fields: FieldValues[] = [];

  let schemaFields: Record<string, any> = {};
  if (schema instanceof z.ZodArray) {
    schemaFields = (schema.element as z.ZodObject<z.ZodRawShape>).shape;
  } else if (schema instanceof z.ZodObject) {
    schemaFields = schema.shape;
  } else {
    return fields;
  }

  for (const name in schemaFields) {
    const field = schemaFields[name];

    const options: Options = {};
    if (field instanceof z.ZodArray) {
      options.min = getArrayOption(field, 'minLength');
      options.max = getArrayOption(field, 'maxLength');
    }

    const meta = field.description && zodParseMeta(field.description);

    fields.push({
      name,
      label: meta?.label || field.description || name,
      type: meta?.type || getType(field),
      ...options,
    });
  }
  return fields;
};

export const getNestedSchema = (schema: z.ZodTypeAny, path: string) => {
  return get((schema as z.ZodObject<z.ZodRawShape>).shape, path);
};

export const zodFieldResolver = <T extends z.ZodTypeAny>(schema: T) => {
  return {
    getFields() {
      return getFieldsFromSchema(schema);
    },
    getNestedFields(name: string) {
      return getFieldsFromSchema(getNestedSchema(schema, name));
    },
  };
};

export interface ZodMeta {
  label: string;
  type?: string;
}

export const zodMeta = (meta: ZodMeta) => {
  return JSON.stringify(meta);
};

export const zodParseMeta = (meta: string) => {
  try {
    return JSON.parse(meta);
  } catch (e) {
    return meta;
  }
};

/**
 * @link https://github.com/colinhacks/zod/discussions/1953#discussioncomment-4811588
 * @param schema
 */
export function getZodDefaults<Schema extends z.ZodObject<z.ZodRawShape>>(
  schema: Schema
) {
  return Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => {
      if (value instanceof z.ZodDefault) return [key, value.parse(undefined)];
      return [key, undefined];
    })
  );
}

/**
 * @param schema
 */
export function getZodDescriptions<Schema extends z.ZodObject<z.ZodRawShape>>(
  schema: Schema
) {
  return Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => {
      return [key, (value as any)._def.description ?? undefined];
    })
  );
}

/**
 * @example
 * const meta = useMemo(() => getZodParsedDescription<{ minValue: CalendarDate }>(schema, props.name), [])
 * @param schema
 * @param key
 */
export function getZodParsedDescription<
  T extends {
    [p: string]: any;
  },
>(schema: z.ZodObject<z.ZodRawShape>, key: string): T | undefined {
  const obj = getZodDescriptions(schema);
  const parsedDescription: any =
    typeof obj[key as keyof typeof obj] === 'string' ||
    obj[key as keyof typeof obj] instanceof String
      ? JSON.parse(obj[key as keyof typeof obj])
      : undefined;
  if (parsedDescription.constructor == Object) {
    return parsedDescription as T;
  }
  return undefined;
}
