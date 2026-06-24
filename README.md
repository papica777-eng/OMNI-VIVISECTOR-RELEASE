# 🔱 OMNI-VIVISECTOR (Public Release)

Welcome to the public deployment repository for **AETERNA OMNI-VIVISECTOR** — the Sovereign Autonomous Cognitive Engine.

This repository contains the local execution clients, the Model Context Protocol (MCP) server integration, and the VS Code extension for interacting with the AETERNA Zero-Knowledge WebAssembly (ZK-WASM) proving core.

> **⚠️ NOTE:** The inner cognitive core (Mojo Tensors, Rust AST parsers, and `.soul` logic models) are completely decoupled and retained in our private sovereign repository to ensure Zero Data Exfiltration and Proprietary Integrity.

## 🚀 Installation

### 1. Local Node.js CLI (`viver.js`)
Run formal verifications directly on your local machine:
```bash
npm i -g @aeterna/omni-vivisector-mcp
viver ./my-smart-contracts/ --key sk_vortex_...
```

### 2. VS Code Extension
Download the compiled extension from `vscode-extension/omni-vivisector-8.2.0.vsix` and install it in your IDE.
Go to Extensions -> `...` (Top right) -> **Install from VSIX**.

### 3. MCP Server (For Claude Desktop & Cursor)
To link the OMNI-VIVISECTOR formal logic engine with Claude or Cursor:
1. Ensure the package is installed globally: `npm i -g @aeterna/omni-vivisector-mcp`
2. Add the following to your `claude_desktop_config.json` or Cursor MCP settings:
```json
{
  "mcpServers": {
    "omni-vivisector": {
      "command": "npx",
      "args": ["-y", "@aeterna/omni-vivisector-mcp"]
    }
  }
}
```

## ⚖️ Pricing & Licenses
To acquire an `sk_vortex` key or purchase a Single Audit Ticket, visit our official portal:
👉 **[https://aeterna.website](https://aeterna.website)**

## 🛡️ CI/CD Integration (GitHub Actions)
You can directly integrate the ZK-WASM Engine to block CI pipelines if vulnerabilities are found:
```yaml
- name: AETERNA Audit
  uses: papica777-eng/OMNI-VIVISECTOR-RELEASE/.github/actions/vivisector@main
  with:
    target_directory: './contracts'
    vortex_api_key: ${{ secrets.VORTEX_KEY }}
```
