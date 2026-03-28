/**
 * MCP resource definitions for MemoryGraph.
 */

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const resourceDefinitions: ResourceDefinition[] = [
  {
    uri: 'memorygraph://status',
    name: 'MemoryGraph Status',
    description: 'Current system statistics including entity, memory, relation, and cluster counts, database size, and average salience.',
    mimeType: 'application/json',
  },
];
