# MemoryGraph

**Entity-anchored, vector-searchable, salience-weighted graph memory for Claude Code.**

MemoryGraph is an MCP (Model Context Protocol) server that gives Claude Code persistent, intelligent memory. It stores information anchored to named entities, finds relevant memories through semantic search, and automatically discovers clusters of related entities using Louvain community detection.

Everything runs locally. No cloud. No API keys. Your data stays on your machine.

```bash
claude mcp add --scope user memory-graph -- npx @memorygraph/server
```

---

## Why MemoryGraph?

Claude Code has no long-term memory between conversations. Each session starts from zero. MemoryGraph fixes this by providing a persistent memory layer that:

- **Remembers across sessions** — Store facts, decisions, preferences, and context that persist between conversations
- **Finds what matters** — Semantic vector search finds relevant memories by meaning, not just keywords
- **Prioritises important memories** — A salience system ensures critical information surfaces first while stale information fades naturally
- **Discovers connections** — Louvain community detection reveals hidden relationships between entities
- **Grows smarter over time** — Memories that get accessed more often become stronger; unused ones decay gracefully

### Key Benefits

| Benefit | How |
|---------|-----|
| **Context continuity** | Memories persist across Claude Code sessions — no repeated explanations |
| **Semantic recall** | Vector search understands meaning: "deployment issues" finds memories about "CI/CD failures" |
| **Automatic prioritisation** | Salience scoring surfaces important memories first, decays irrelevant ones |
| **Entity graph** | Named entities (people, projects, tools) form a knowledge graph with typed relations |
| **Associative recall** | Cluster expansion finds related memories through entity communities |
| **Deduplication** | Content hashing prevents duplicate memories; entity resolution merges equivalent entities |
| **Privacy-first** | All local — SQLite database, local embeddings, no data leaves your machine |
| **Zero config** | One install command. Automatic database creation, model download, and maintenance |

---

## How It Works

### Architecture Overview

```
Claude Code ←──stdio──→ MCP Server ←──→ Memory Service (orchestrator)
                                            │
                        ┌───────────────────┼───────────────────┐
                        ↓                   ↓                   ↓
                  Entity Resolver     Recall Engine       Cluster Engine
                  (name → entity)    (semantic search)   (Louvain communities)
                        │                   │                   │
                        └───────────────────┼───────────────────┘
                                            ↓
                                    SQLite + sqlite-vec
                                   (~/.memorygraph/memory.db)
```

### The Memory Lifecycle

**1. Storing** — When Claude stores a memory, MemoryGraph:
- Checks for duplicate content via SHA-256 hash
- Resolves each entity name to an existing or new entity
- Generates a 384-dimension embedding using all-MiniLM-L6-v2 (local, no API)
- Stores the memory, its vector, and entity links in SQLite

**2. Recalling** — When Claude searches memory:
- Embeds the query text
- Searches the vector table for semantically similar memories
- Filters by entity, type, and salience threshold
- Scores each result: `(similarity × 0.6) + (salience × 0.4)`
- Optionally expands through entity clusters for associative recall

**3. Decaying** — Over time:
- Memory salience decreases based on age and decay rate
- Accessed memories get boosted (recency, frequency)
- Reinforced memories get a persistent boost
- Permanent memories never drop below 0.8
- Auto-maintenance runs hourly to update scores and prune dead memories

---

## MCP Tools

MemoryGraph exposes 10 tools to Claude Code:

| Tool | Purpose |
|------|---------|
| `memory_store` | Store a memory anchored to one or more entities. Duplicate content is detected automatically. |
| `memory_recall` | Semantic search with salience-weighted ranking. Scores combine vector similarity (60%) and salience (40%). |
| `memory_context` | Full context for an entity — its memories, relations, and cluster membership. |
| `memory_relate` | Create or strengthen a typed relation between two entities. |
| `memory_reinforce` | Boost a memory's salience, making it surface more often and decay slower. |
| `memory_forget` | Soft-delete a memory. Excluded from recall but retained for audit. |
| `memory_entities` | List known entities, filterable by name query or type. |
| `memory_clusters` | Show Louvain community clusters with optional fresh detection. |
| `memory_status` | System statistics: counts, database size, average salience. |
| `memory_maintain` | Run maintenance: decay stale memories, prune below threshold, refresh clusters. |

### Entity Types

`person` · `organisation` · `project` · `concept` · `location` · `tool` · `event` · `other`

### Memory Types

`episodic` (events/experiences) · `semantic` (facts/knowledge) · `procedural` (how-to/processes)

### Relation Types

`related_to` · `works_on` · `part_of` · `depends_on` · `created_by` · `uses` · `knows` · `similar_to` · `caused_by` · `followed_by`

---

## Core Algorithms

### Salience Calculation

Salience determines how important a memory is and how likely it is to surface in recall. The score combines multiple signals:

```
Permanent memories:
  salience = max(initialSalience, 0.8)

Non-permanent memories:
  base       = initialSalience
  decay      = base × decayRate × ageDays
  recency    = 0.1 × (1 / (1 + daysSinceAccess))
  frequency  = 0.05 × log₂(1 + accessCount)
  reinforcement = min(0.15 × reinforcementCount, 0.6)

  salience = clamp(base − decay + recency + frequency + reinforcement, 0, 1)
```

| Component | Effect | Range |
|-----------|--------|-------|
| **Base** | Starting importance set at creation | 0–1 |
| **Decay** | Reduces salience over time | Proportional to age |
| **Recency boost** | Recently accessed memories score higher | 0–0.1 |
| **Frequency boost** | Frequently accessed memories score higher | Logarithmic growth |
| **Reinforcement boost** | Explicitly reinforced memories persist | 0–0.6 (capped) |

### Entity Resolution

When a memory references an entity name, MemoryGraph resolves it through 5 levels:

1. **Exact match** — Case-insensitive name lookup → return existing entity
2. **Alias match** — Check all entity aliases → return existing entity
3. **Vector similarity > 0.85** — High confidence semantic match → return existing entity
4. **Vector similarity 0.7–0.85** — Ambiguous match → create new entity (avoid false merges)
5. **Vector similarity < 0.7** — No match → create new entity

### Recall Scoring

```
combinedScore = (similarity × 0.6) + (salience × 0.4)
```

Vector similarity contributes 60% — how close the query meaning is to the memory. Salience contributes 40% — how important the memory is. Results are sorted by combined score, with optional cluster expansion to include memories from related entities.

### Louvain Community Detection

MemoryGraph builds an entity graph from relations and runs the Louvain modularity optimisation algorithm to discover communities:

1. Build undirected weighted graph from all entities and relations
2. Run Louvain algorithm (graphology-communities-louvain)
3. Group entities by detected community
4. Discard singleton clusters (< 2 entities)
5. Persist clusters for fast lookup

Clusters enable **associative recall** — when searching for memories about one entity, MemoryGraph can expand results to include memories from related entities in the same cluster.

---

## Database Schema

Single SQLite file at `~/.memorygraph/memory.db` with WAL mode for concurrent reads.

| Table | Purpose |
|-------|---------|
| `entities` | Named entities with type, aliases (JSON), description, metadata |
| `memories` | Memory content with salience scores, decay rate, access counts, content hash |
| `entity_memories` | Many-to-many links between entities and memories |
| `relations` | Typed, weighted directional relations between entities |
| `clusters` | Louvain community groups (entity ID arrays) |
| `access_log` | Audit trail of memory access events |
| `memory_vectors` | 384-dimension embeddings for semantic memory search (vec0) |
| `entity_vectors` | 384-dimension embeddings for entity resolution (vec0) |
| `schema_version` | Migration tracking |
| `config` | Key-value configuration store |

---

## Configuration

All configuration has sensible defaults. Override via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORYGRAPH_DATA_DIR` | `~/.memorygraph` | Data directory |
| `MEMORYGRAPH_DB_PATH` | `~/.memorygraph/memory.db` | Database file path |
| `MEMORYGRAPH_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model |
| `MEMORYGRAPH_DECAY_RATE` | `0.01` | Default decay rate per day |
| `MEMORYGRAPH_DEFAULT_SALIENCE` | `0.5` | Default initial salience |
| `MEMORYGRAPH_MIN_SALIENCE` | `0.01` | Pruning threshold |
| `MEMORYGRAPH_MAX_RESULTS` | `100` | Maximum recall results |
| `MEMORYGRAPH_MAINTENANCE_INTERVAL` | `3600000` | Auto-maintenance interval (ms) |
| `MEMORYGRAPH_LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Node.js 20+ | Server execution |
| Language | TypeScript 5.x (strict) | Type-safe implementation |
| MCP | @modelcontextprotocol/sdk | Protocol implementation |
| Database | better-sqlite3 + WAL | Embedded SQL with concurrent reads |
| Vector search | sqlite-vec (vec0) | KNN search on 384-dim embeddings |
| Embeddings | @xenova/transformers | Local inference, no API calls |
| Model | all-MiniLM-L6-v2 (~23MB) | 384-dimension sentence embeddings |
| Graph | graphology | Entity relationship graph |
| Clustering | graphology-communities-louvain | Modularity optimisation |
| Validation | Zod | Runtime schema validation |
| Logging | Pino | Structured JSON logging (stderr) |
| Build | tsup | TypeScript bundler |
| Testing | Vitest | Unit and integration tests |

---

## Installation

### As an MCP server for Claude Code

```bash
claude mcp add --scope user memory-graph -- npx @memorygraph/server
```

### From npm

```bash
npm install -g @memorygraph/server
memorygraph
```

On first run, the embedding model (~23MB) is downloaded automatically. After that, everything works offline.

---

## Development

```bash
git clone https://github.com/websmartshubhamk/memorygraph.git
cd memorygraph
npm install
npm run build        # Compile to dist/
npm test             # Run 229 tests
npm run test:coverage # Coverage report
npm run typecheck    # Type check
npm run lint         # Lint
npm run dev          # Watch mode
```

### Project Structure

```
src/
├── core/                    # Pure business logic (zero I/O)
│   ├── models/              # Types, Zod schemas
│   ├── interfaces/          # Store and service contracts
│   └── services/            # Engines: salience, recall, clustering, entity resolution
├── infrastructure/          # I/O implementations
│   ├── database/            # SQLite manager, migrations
│   ├── stores/              # 8 SQLite CRUD stores
│   ├── embeddings/          # @xenova/transformers wrapper
│   └── config/              # Environment variable loading
├── tools/                   # MCP tool definitions and handlers
├── resources/               # MCP resource definitions
├── utils/                   # Hashing, text processing, logging
└── index.ts                 # Entry point — wires everything together

tests/
├── unit/                    # Salience engine, schemas, utilities
└── integration/             # Database, all stores against real SQLite
```

### Performance Targets

| Operation | Target |
|-----------|--------|
| Store memory | < 200ms |
| Recall (1K memories) | < 300ms |
| Recall (10K memories) | < 500ms |

---

## Licence

MIT
