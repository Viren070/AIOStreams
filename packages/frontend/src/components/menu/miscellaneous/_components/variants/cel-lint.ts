import { Diagnostic as CMDiagnostic, linter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import {
  parseCelScript,
  type CelLimits,
} from '../../../../../../../core/src/variants/language';

/** Runs the same parser the server uses on save. UX only, not a gate. */
export function celLinter(limits: CelLimits) {
  return linter(
    (view: EditorView): CMDiagnostic[] => {
      const text = view.state.doc.toString();
      const len = text.length;
      return parseCelScript(text, limits).diagnostics.map((d) => {
        const from = Math.max(0, Math.min(d.index, len));
        const rawTo = d.index + (d.source ? d.source.length : 1);
        const to = Math.max(from + 1, Math.min(rawTo, len));
        const diagnostic: CMDiagnostic = {
          from,
          to,
          severity: d.severity,
          message: d.message,
        };
        if (d.suggestion) {
          const suggestion = d.suggestion;
          diagnostic.actions = [
            {
              name: `Replace with ${suggestion}`,
              apply(v, aFrom, aTo) {
                v.dispatch({
                  changes: { from: aFrom, to: aTo, insert: suggestion },
                });
              },
            },
          ];
        }
        return diagnostic;
      });
    },
    { delay: 200 }
  );
}
