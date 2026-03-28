# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-03-29

### Added
- Initial release
- Entity-anchored graph memory with vector search
- Louvain community detection for automatic knowledge clustering
- Local embedding inference via all-MiniLM-L6-v2 (no API keys required)
- 10 MCP tools: store, recall, context, relate, reinforce, forget, entities, clusters, status, maintain
- Salience-weighted memory with automatic decay
- SQLite + sqlite-vec for embedded vector search
- Auto-maintenance: salience decay, expiry cleanup, cluster recalculation, log pruning
