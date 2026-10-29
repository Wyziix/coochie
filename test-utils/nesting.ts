// Finds a pressable inside another pressable in a rendered tree. On web,
// react-native-web renders role="button" pressables as <button>, and a
// <button> inside a <button> is invalid HTML (React logs an error, and
// clicks/keyboard focus misbehave). Pressables show up as host Views with an
// onClick handler; Text with onPress counts too.

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children?: (HostNode | string)[];
};

const isPressable = (n: HostNode) =>
  typeof n.props.onClick === 'function' ||
  (n.type === 'Text' && typeof n.props.onPress === 'function');

const describe = (n: HostNode) =>
  `${String(n.type)}${n.props.accessibilityLabel ? ` "${n.props.accessibilityLabel}"` : ''}${
    n.props.accessibilityRole ? ` [${n.props.accessibilityRole}]` : ''
  }`;

export function findNestedPressables(root: HostNode): string[] {
  const problems: string[] = [];
  const walk = (node: HostNode, outer: HostNode | null) => {
    let ancestor = outer;
    if (isPressable(node)) {
      if (outer) problems.push(`${describe(node)} is inside ${describe(outer)}`);
      ancestor = node;
    }
    for (const child of node.children ?? []) {
      if (typeof child === 'object' && child) walk(child, ancestor);
    }
  };
  walk(root, null);
  return problems;
}
