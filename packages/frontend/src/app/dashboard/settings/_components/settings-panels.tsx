import React from 'react';
import { useController, useFormContext } from 'react-hook-form';
import { toName } from './settings-field';

/**
 * A setting the schema renderer cannot draw (a list of credentialed objects,
 * say) but which should still behave like every other field on the page: one
 * Save button, one unsaved-changes alert, one Reset.
 *
 * The trick is that its value IS a form field, so react-hook-form tracks its
 * dirtiness and reverts it on reset like anything else. Only persistence is
 * special: the value goes to the panel's own endpoint instead of the settings
 * PATCH, which is why the key is `hidden` in the schema and never appears in
 * the generic payload.
 */
export interface SettingsPanelSaver {
  /**
   * Persist the field's value. `message` is a phrase for the combined toast;
   * `value` is what the server now holds, which becomes the field's new
   * baseline, so a secret typed into the editor is replaced by its stored
   * form rather than lingering in form state.
   */
  save(value: unknown): Promise<{ message?: string; value?: unknown }>;
}

interface PanelRegistry {
  register(name: string, saver: SettingsPanelSaver): void;
  unregister(name: string): void;
}

const PanelContext = React.createContext<PanelRegistry | null>(null);

/** Collects the panels rendered inside one tab, keyed by form field name. */
export function SettingsPanelsProvider({
  panelsRef,
  children,
}: {
  panelsRef: React.MutableRefObject<Map<string, SettingsPanelSaver>>;
  children: React.ReactNode;
}) {
  const registry = React.useMemo<PanelRegistry>(
    () => ({
      register: (name, saver) => void panelsRef.current.set(name, saver),
      unregister: (name) => void panelsRef.current.delete(name),
    }),
    [panelsRef]
  );
  return (
    <PanelContext.Provider value={registry}>{children}</PanelContext.Provider>
  );
}

/**
 * Bind a bespoke editor to a form field named after its config key.
 *
 * `seed` publishes the server's value as the field's DEFAULT (not just its
 * value), so the form starts clean and only the user's edits count as dirty.
 */
export function useSettingsPanelField<T>(
  key: string,
  saver: SettingsPanelSaver
): {
  /** Form field name, so nested paths can be handed to the shared fields. */
  name: string;
  value: T | undefined;
  setValue(next: T): void;
  seed(value: T): void;
} {
  const name = toName(key);
  const registry = React.useContext(PanelContext);
  const { resetField } = useFormContext();
  // Registers the field, so it takes part in dirty tracking and `reset()`
  // even though nothing renders an input for it.
  const { field } = useController({ name });

  // `saver` closes over fresh state each render, so re-register every time.
  React.useEffect(() => {
    if (!registry) return;
    registry.register(name, saver);
    return () => registry.unregister(name);
  });

  const seed = React.useCallback(
    (initial: T) => resetField(name, { defaultValue: initial }),
    [name, resetField]
  );

  return {
    name,
    value: field.value as T | undefined,
    setValue: field.onChange,
    seed,
  };
}

/**
 * Panels whose value differs from the form's defaults, which is exactly what
 * react-hook-form calls dirty, so the alert and the Save button already agree.
 */
export function dirtyPanels(
  panels: Map<string, SettingsPanelSaver>,
  values: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined
): [string, SettingsPanelSaver][] {
  return [...panels].filter(
    ([name]) =>
      values[name] !== undefined &&
      JSON.stringify(values[name]) !== JSON.stringify(defaults?.[name])
  );
}

/**
 * Persist the given panels, in order. Writes each server-canonical value back
 * into `values`, which the caller then uses as the form's new baseline.
 */
export async function savePanels(
  panels: [string, SettingsPanelSaver][],
  values: Record<string, unknown>
): Promise<string[]> {
  const messages: string[] = [];
  for (const [name, saver] of panels) {
    const { message, value } = await saver.save(values[name]);
    if (message) messages.push(message);
    if (value !== undefined) values[name] = value;
  }
  return messages;
}
