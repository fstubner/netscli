# OUI Dataset Generation

## Rust vs TypeScript/Python

**Why Rust?**
- ✅ Consistent with the rest of the project (all Rust)
- ✅ No external runtime dependencies (no Node.js/Python needed)
- ✅ Faster execution
- ✅ Single binary when compiled
- ✅ Better for CI/CD (no need to install Node/Python)

**Why TypeScript/Python?**
- ❌ Requires Node.js/Bun or Python runtime
- ❌ Adds another language to the project
- ❌ More dependencies to manage

**Recommendation**: **Keep the Rust version** - it's more consistent with the project and has fewer dependencies.

## Usage

```bash
cd scripts
cargo run --bin generate-oui
```

This will:
1. Fetch OUI data from IEEE (3 CSV files)
2. Fetch Wireshark manuf database
3. Merge all sources
4. Output `crates/netscli-core/data/oui.min.json.gz`

## Updating

Run monthly or before major releases to keep vendor data current.
