// Mutation responses may arrive after another write or a project switch.
export function mergeProjectSnapshot(current, incoming) {
  if (!current || current.id !== incoming.id) return current;
  if (incoming.character.revision < current.character.revision || incoming.updatedAt < current.updatedAt) return current;
  return incoming;
}
