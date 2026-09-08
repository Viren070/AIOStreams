import React from 'react';
import { ArrInstancesEditor } from './arr-instances-editor';
import { QueueRulesEditor } from './queue-rules-editor';
import { ConnectPanel } from './connect-panel';
import { FuseStatusPanel } from './fuse-status-panel';
import { UsenetProfileLinker } from './usenet-profile-linker';

/**
 * Bespoke editors for settings the generic schema renderer cannot express:
 * a list of credentialed objects, say, which has its own endpoint so secrets
 * never round-trip through the form. A tab declares them by key in
 * `TAB_MANIFEST`; they render as their own panels after the schema cards,
 * outside the settings form, and save themselves.
 *
 * The key is the config key the editor owns. That key is marked
 * `ui: { hidden: true }` in the schema, so it is absent from the generic
 * settings payload and can only be written through its own route.
 */
export const SETTINGS_EDITORS: Record<string, React.ComponentType> = {
  'arr.instances': ArrInstancesEditor,
  'arr.queueCleanup.rules': QueueRulesEditor,
  // Not settings at all: the FUSE mount's runtime state (mounted, failed,
  // unavailable and why), and mount recipes built from the live config, which
  // is the step users get wrong far more often than any of the toggles.
  'shares.fuse': FuseStatusPanel,
  'shares.connect': ConnectPanel,
  // `usenet.providers` is deliberately absent: the provider editor keeps its
  // own page under the usenet dashboard.
};

/** One editor by key, for a card slot that places it itself. */
export function editorFor(key: string): React.ComponentType | undefined {
  return SETTINGS_EDITORS[key];
}

export function editorsFor(keys: string[] | undefined): React.ComponentType[] {
  return (keys ?? [])
    .map((k) => SETTINGS_EDITORS[k])
    .filter((c): c is React.ComponentType => !!c);
}

/**
 * Widgets rendered INSIDE a tab's settings form, keyed by tab id. They drive
 * form state (cross-field coupling) rather than owning a setting of their own,
 * and render nothing themselves.
 */
export const SETTINGS_FORM_WIDGETS: Record<string, React.ComponentType> = {
  usenet: UsenetProfileLinker,
};
