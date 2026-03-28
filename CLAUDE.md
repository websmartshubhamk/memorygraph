# MemoryGraph — Claude Code MCP Memory Server

## Project Overview
MCP server providing entity-anchored, vector-searchable, salience-weighted graph memory with Louvain community detection for Claude Code.

**Install**: `claude mcp add --scope user memory-graph -- npx @memorygraph/server`

One install command. Runs locally. No cloud. No API keys. Privacy-first.

## Tech Stack
- **Language**: TypeScript 5.x (strict mode)
- **Runtime**: Node.js 20+ (LTS)
- **MCP SDK**: @modelcontextprotocol/sdk
- **Database**: better-sqlite3 (embedded, zero-config, single-file)
- **Vector Search**: sqlite-vec (vec0 virtual table, KNN search)
- **Embeddings**: @xenova/transformers (local inference, no API calls)
- **Embedding Model**: all-MiniLM-L6-v2 (384 dimensions, ~23MB)
- **Graph Analysis**: graphology + graphology-communities-louvain
- **Validation**: Zod
- **Logging**: pino (structured)
- **Testing**: vitest
- **Build**: tsup
- **Distribution**: npm registry as @memorygraph/server

## Architecture
- `src/core/` — Business logic (zero I/O dependencies). Models, services, interfaces.
- `src/infrastructure/` — I/O implementations. SQLite stores, embedding provider, config.
- `src/tools/` — MCP tool definitions (10 tools).
- `src/resources/` — MCP resource definitions.
- `src/utils/` — Text processing, hashing, logging.

## Database
Single SQLite file at `~/.memorygraph/memory.db` with WAL mode.

Tables: config, entities, memories, entity_memories, relations, clusters, access_log, schema_version.
Vector tables: memory_vectors (vec0), entity_vectors (vec0) — 384 dimensions.

## MCP Tools
| Tool | Purpose |
|------|---------|
| `memory_store` | Store memory anchored to entities |
| `memory_recall` | Semantic search with salience ranking |
| `memory_context` | Full entity context with graph |
| `memory_relate` | Create/strengthen entity relations |
| `memory_reinforce` | Boost memory salience |
| `memory_forget` | Soft-delete a memory |
| `memory_entities` | List known entities |
| `memory_clusters` | Show Louvain communities |
| `memory_status` | System statistics |
| `memory_maintain` | Run maintenance operations |

## Key Algorithms

### Salience Calculation
```
If permanent: return max(initialSalience, 0.8)
base = initialSalience
decay = base * decayRate * ageDays
recencyBoost = 0.1 * (1 / (1 + daysSinceAccess))
frequencyBoost = 0.05 * log2(1 + accessCount)
reinforcementBoost = min(0.15 * reinforcementCount, 0.6)
score = clamp(base - decay + recencyBoost + frequencyBoost + reinforcementBoost, 0, 1)
```

### Recall Scoring
```
combinedScore = (similarity * 0.6) + (salience * 0.4)
```
Plus optional cluster expansion for associative recall.

### Entity Resolution
1. Exact name match (case-insensitive)
2. Alias match
3. Vector similarity > 0.85 = same entity
4. 0.7-0.85 = potential match, create new
5. < 0.7 = definitely new

## Implementation Order
1. Project scaffold (DONE)
2. Database layer (DatabaseManager, MigrationRunner, SQL migrations)
3. Core models (types, Zod schemas)
4. Embedding provider (@xenova/transformers wrapper + cache)
5. Stores (SQLite CRUD for each table)
6. Entity resolver
7. Salience engine
8. Recall engine
9. Cluster engine (Louvain)
10. Memory service (orchestrator)
11. MCP server setup + tool registration
12. Individual tool implementations
13. Auto-maintenance timers
14. Configuration manager
15. Logging setup
16. Integration tests
17. Polish and error messages
18. Publish to npm

## Standards
- UK English throughout
- 80%+ test coverage
- All edge cases handled (see build prompt for full table)
- Performance targets: store <200ms, recall <300ms (1k memories), <500ms (10k)

## Git
- Private repository
- Attribution: `Co-Authored-By: COR Intelligence <enquiries@corsolutions.co.uk>`
