export function mergeGraphNodes(current, incoming) {
  const previous = new Map(current.map(node => [node.id, node]));
  return incoming.map(next => {
    const before = previous.get(next.id);
    const keepsLocalPosition = next.type !== 'annotation' || before?.dragging;
    return {
      ...before, ...next,
      position: keepsLocalPosition ? before?.position || next.position : next.position,
      measured: before?.measured || next.measured,
      ...(next.style?.width !== undefined ? { width: next.style.width } : {}),
      ...(next.style?.height !== undefined ? { height: next.style.height } : {}),
    };
  });
}
