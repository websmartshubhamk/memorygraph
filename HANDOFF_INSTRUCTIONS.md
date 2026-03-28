# MemoryGraph — Handoff Instructions

## Project Status
- **Scaffold**: COMPLETE — directories, package.json, tsconfig, tsup, vitest, eslint, prettier, gitignore, licence
- **Implementation**: NOT STARTED

## Next Steps

Open a new Claude Code instance in this project directory:

```bash
cd C:\Users\proje\Documents\MasterClaude\projects\memorygraph
claude
```

Then paste this to begin:

---

Build the MemoryGraph MCP server. The full build prompt with every specification is saved in CLAUDE.md. Follow the implementation order exactly:

1. `npm install` — install all dependencies
2. Initialise git repo: `git init && git add . && git commit -m "chore: project scaffold"`
3. Start with Phase 2: Database layer — DatabaseManager, MigrationRunner, all 4 SQL migration files
4. Then Phase 3: Core models — all TypeScript types/interfaces with Zod validation schemas
5. Continue through all 18 phases in order

Use `/non-stop` mode for autonomous execution. Write tests alongside each phase. Push after each phase commit.

The build prompt in CLAUDE.md contains:
- Complete database schema (4 SQL migration files)
- All core model interfaces with full type definitions
- Detailed service specifications (store, recall, forget, reinforce, relate, context operations)
- All 10 MCP tool definitions with exact inputSchema
- Salience calculation formula
- Louvain cluster detection specification
- Entity resolution algorithm
- Edge case handling table
- Performance targets
- Testing requirements (unit + integration + performance)

Everything needed for autonomous execution is specified. No ambiguity.

---

## Important Notes
- The full build prompt was provided as a single message — all specifications are in CLAUDE.md
- This is an npm package (`@memorygraph/server`), not a website — no Vercel deployment
- sqlite-vec may need native compilation on Windows — test early
- @xenova/transformers downloads the model on first run (~23MB) — needs internet once
- Data directory: `~/.memorygraph/`
