import { TemplateNode } from './ast.js';
import { eachTemplate, parseTemplate } from './parser.js';

/** Matches the parser's own branch cap, so both give up at the same nesting. */
const MAX_BRANCH_DEPTH = 5;

function collect(
  nodes: TemplateNode[],
  found: Set<string>,
  depth: number
): void {
  for (const node of nodes) {
    if (node.kind === 'group') {
      collect(node.nodes, found, depth);
      continue;
    }
    if (node.kind !== 'expression') continue;

    for (const operand of node.operands) {
      if (depth < MAX_BRANCH_DEPTH) {
        for (const modifier of operand.modifiers) {
          const template = eachTemplate(modifier);
          if (template) {
            collect(parseTemplate(template.content).nodes, found, depth + 1);
          }
        }
      }
      // quoted literals stand in for a field but reference none
      if (operand.literal !== undefined || !operand.section) continue;
      found.add(`${operand.section}.${operand.property}`);
    }

    // branches are raw text until compiled, so they need their own parse
    if (!node.check || depth >= MAX_BRANCH_DEPTH) continue;
    for (const branch of [
      node.check.trueTemplate,
      node.check.falseTemplate,
      node.check.absentTemplate,
    ]) {
      if (!branch) continue;
      collect(parseTemplate(branch).nodes, found, depth + 1);
    }
  }
}

/**
 * Every `section.property` a template reads, in canonical spelling. Unknown
 * fields never parse as expressions, so anything returned here is in
 * `FIELD_REGISTRY`.
 */
export function collectFieldReferences(template: string): Set<string> {
  const found = new Set<string>();
  if (!template) return found;
  collect(parseTemplate(template).nodes, found, 0);
  return found;
}
