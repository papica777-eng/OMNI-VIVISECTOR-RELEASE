#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// 🔱 OMNI-VIVISECTOR — Local Model Context Protocol (MCP) Server
// ═══════════════════════════════════════════════════════════════════════════════
// Complies with JSON-RPC 2.0 over stdin/stdout, exposing ZK-WASM formal
// verification tools to LLMs (Claude, GPT, Gemini).
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { auditApiEndpoint } = require('./api-auditor');

const wasmPath = path.resolve(__dirname, '../vivisector_core.wasm');
const os = require('os');
let defaultToken = "AETERNA9669_OFFLINE_SOVEREIGN_TOKEN_BYPASS_KEY_4121_VORTEX";

try {
    const userInfo = os.userInfo();
    if (userInfo && userInfo.username === 'papic' && os.platform() === 'win32') {
        defaultToken = 'LOGOS_DIMITAR_PRODROMOV!';
    }
} catch(e) {}

// WASM State
let wasmInstance = null;
let isWasmLoaded = false;
let isWasmUnlocked = false;

// Initialize WASM Engine
async function initWasm() {
    if (isWasmLoaded) return true;
    try {
        if (!fs.existsSync(wasmPath)) {
            logError(`WASM Core not found at: ${wasmPath}`);
            return false;
        }

        const wasmBuffer = fs.readFileSync(wasmPath);
        const wasmMemory = new WebAssembly.Memory({
            initial: 64,
            maximum: 256
        });

        const importObject = {
            env: {
                memory: wasmMemory
            }
        };

        const result = await WebAssembly.instantiate(wasmBuffer, importObject);
        wasmInstance = result.instance;
        isWasmLoaded = true;

        // Unlock
        const encoder = new TextEncoder();
        const tokenBytes = encoder.encode(defaultToken);
        const ptr = wasmInstance.exports.wasm_alloc(tokenBytes.length);
        if (ptr === 0) return false;

        const mem = new Uint8Array(wasmInstance.exports.memory.buffer);
        mem.set(tokenBytes, ptr);

        const unlockResult = wasmInstance.exports.unlock_engine(ptr, tokenBytes.length);
        wasmInstance.exports.wasm_free(ptr, tokenBytes.length);

        isWasmUnlocked = unlockResult === 1;
        return isWasmUnlocked;
    } catch (err) {
        logError(`Failed to load WASM engine: ${err.message}`);
        return false;
    }
}

// Write error logs silently to stderr to keep stdout pure for JSON-RPC
function logError(msg) {
    process.stderr.write(`[VIVISECTOR-MCP ERROR] ${msg}\n`);
}

// Main Scan implementation
function scanCodeBuffer(fileContent, filePath = '', extension = '') {
    if (!isWasmLoaded || !isWasmUnlocked) return [];

    wasmInstance.exports.wasm_reset();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const fileBytes = encoder.encode(fileContent);
    const filePtr = wasmInstance.exports.wasm_alloc(fileBytes.length);
    if (filePtr === 0) return [];

    const wasmMem = new Uint8Array(wasmInstance.exports.memory.buffer);
    wasmMem.set(fileBytes, filePtr);

    const count = wasmInstance.exports.scan_buffer(filePtr, fileBytes.length);

    if (count > 0) {
        const outputPtr = wasmInstance.exports.get_output_ptr();
        const outputLen = wasmInstance.exports.get_output_len();
        const outputMem = new Uint8Array(wasmInstance.exports.memory.buffer);
        const jsonBytes = outputMem.slice(outputPtr, outputPtr + outputLen);
        const jsonStr = decoder.decode(jsonBytes);

        try {
            const rawFindings = JSON.parse(jsonStr);
            const deduplicated = [];
            const seen = new Set();
            for (const f of rawFindings) {
                // Ignore dependencies
                if (filePath.includes('vendor/') || filePath.includes('node_modules/') || filePath.includes('lib/')) {
                    continue;
                }
                
                // Solidity rules only on .sol files
                if (f.id.startsWith('SOL-') && extension !== '.sol') continue;

                // Ignore SOL-003 for test/demo files
                const lowerPath = filePath.toLowerCase();
                if (f.id === 'SOL-003' && (lowerPath.includes('test') || lowerPath.includes('demo') || lowerPath.includes('mock'))) {
                    continue;
                }
                
                // Deduplication
                const key = `${f.id}:${f.line || 0}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    deduplicated.push(f);
                }
            }
            return deduplicated;
        } catch (err) {
            logError(`Failed to parse scan JSON output: ${err.message}`);
            return [];
        }
    }
    return [];
}

// Recursive directory scan helper
function scanDirectoryRecursively(dir, findings = []) {
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== '.zig-cache' && file !== 'target' && file !== 'vendor' && file !== 'lib') {
                scanDirectoryRecursively(fullPath, findings);
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            if (ext === '.sol' || ext === '.rs' || ext === '.zig' || ext === '.js' || ext === '.ts') {
                const code = fs.readFileSync(fullPath, 'utf-8');
                const fileFindings = scanCodeBuffer(code, fullPath, ext);
                if (fileFindings.length > 0) {
                    for (const f of fileFindings) {
                        f.file_path = fullPath;
                        findings.push(f);
                    }
                }
            }
        }
    }
    return findings;
}

// Helper to generate a detailed Markdown report from API findings
function generateApiMarkdownReport(findings, url, reportTitle = "API Security Audit Report") {
    let md = `# 🔱 OMNI-VIVISECTOR — ${reportTitle}\n\n`;
    md += `## 📊 Audit Metadata\n`;
    md += `* **Target URL:** \`${url}\`\n`;
    md += `* **Date of Scan:** ${new Date().toUTCString()}\n`;
    md += `* **Engine:** CyberCody / Api-Interceptor (via vivisector-mcp)\n`;
    md += `* **Total Identified Vulnerabilities:** **${findings.length}**\n\n`;

    md += `## ⚠️ Findings & Remediation Steps\n\n`;

    if (findings.length === 0) {
        md += `### ✅ No Vulnerabilities Found\n`;
        md += `The target API endpoint appears secure based on the performed checks.\n`;
    } else {
        const severityOrder = { "CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4 };
        const sortedFindings = [...findings].sort((a, b) => (severityOrder[a.severity] || 5) - (severityOrder[b.severity] || 5));

        for (const f of sortedFindings) {
            const sevIcon = f.severity === 'CRITICAL' ? '🔴' : f.severity === 'HIGH' ? '🟠' : '🟡';
            md += `### ${sevIcon} ${f.id}: ${f.name}\n\n`;
            md += `* **Severity:** ${f.severity}\n`;
            md += `* **CWE:** ${f.cwe || 'N/A'}\n`;
            md += `* **Endpoint:** \`${f.file}\`\n\n`;
            
            md += `#### Description\n`;
            md += `${f.description}\n\n`;

            md += `#### Impact\n`;
            if (f.id === 'API-001') {
                md += `An attacker could potentially access or modify data belonging to other users by manipulating the identifier in the URL (e.g., changing \`/users/123\` to \`/users/456\`). This can lead to massive data breaches, unauthorized actions, and complete account takeovers.\n\n`;
            } else if (f.id === 'API-002') {
                md += `Undocumented or "shadow" APIs often lack the same security hardening as public-facing endpoints. They can expose sensitive internal functionality, bypass security controls, and provide a hidden attack surface for malicious actors to exploit the system's backend infrastructure.\n\n`;
            } else if (f.id === 'API-003') {
                md += `A leaked JWT is equivalent to a leaked password. An attacker who obtains this token can impersonate a user or a service, gaining full access to their account and permissions. This is a critical vulnerability that can lead to complete system compromise.\n\n`;
            }

            md += `#### Recommended Remediation\n`;
            md += `${f.remediation}\n\n---\n\n`;
        }
    }
    return md;
}
// ─────────────────────────────────────────────────────────────────────────────
// § MCP JSON-RPC 2.0 Server Stdin/Stdout Stream
// ─────────────────────────────────────────────────────────────────────────────

let buffer = "";

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (line) {
            await handleRequest(line);
        }
        lineEnd = buffer.indexOf('\n');
    }
});

async function handleRequest(rawLine) {
    let req;
    try {
        req = JSON.parse(rawLine);
    } catch (err) {
        sendResponse(null, { code: -32700, message: "Parse error" });
        return;
    }

    if (req.method === 'initialize') {
        sendResponse(req.id, {
            protocolVersion: "2024-11-05",
            capabilities: {
                tools: {}
            },
            serverInfo: {
                name: "omni-vivisector",
                version: "6.0.0"
            }
        });
        return;
    }

    if (req.method === 'tools/list') {
        sendResponse(req.id, {
            tools: [
                {
                    name: "vivisector_audit_code",
                    description: "Извършва одит на сорс код (Solidity, Rust, Zig) за уязвимости в реално време през ZK-WASM Formal Verification ядрото.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            code: {
                                type: "string",
                                description: "Сорс кодът на файла за сканиране."
                            },
                            extension: {
                                type: "string",
                                description: "Разширението на файла за анализ (.sol, .rs, .zig)."
                            }
                        },
                        required: ["code", "extension"]
                    }
                },
                {
                    name: "vivisector_audit_api",
                    description: "Интегрира CyberCody и Api-Interceptor за одит на API ендпойнти. Търси BOLA/IDOR, Shadow APIs и изтекли секретни ключове.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: {
                                type: "string",
                                description: "Целият URL на API ендпойнта за анализ (напр. 'https://api.example.com/v1/users/123')."
                            }
                        },
                        required: ["url"]
                    }
                },
                {
                    name: "vivisector_generate_api_report",
                    description: "Извършва пълен одит на API ендпойнт и генерира детайлен Markdown доклад с откритите уязвимости, тяхното въздействие и препоръки за отстраняване.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: {
                                type: "string",
                                description: "Целият URL на API ендпойнта за анализ (напр. 'https://api.example.com/v1/users/123')."
                            },
                            report_title: {
                                type: "string",
                                description: "Опционално заглавие за доклада."
                            }
                        },
                        required: ["url"]
                    }
                },
                {
                    name: "vivisector_audit_directory",
                    description: "Сканира рекурсивно локална папка за Solidity, Rust и Zig сорс кодове и генерира подробен одит доклад.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            directory_path: {
                                type: "string",
                                description: "Абсолютният път до локалната папка на хард диска."
                            }
                        },
                        required: ["directory_path"]
                    }
                },
                {
                    name: "solodit_search_findings",
                    description: "Търси исторически vulnerability findings в базата данни на Solodit. Връща одити от Trail of Bits, OpenZeppelin, Spearbit, Code4rena, Sherlock и др.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            keywords: { type: "string", description: "Ключови думи за търсене (напр. 'reentrancy flash loan')" },
                            severity: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Филтър по severity" },
                            tags: { type: "array", items: { type: "string" }, description: "Филтър по тагове (напр. ['reentrancy', 'oracle-manipulation'])" },
                            limit: { type: "number", description: "Максимален брой резултати (default: 5)" },
                            quality_score_min: { type: "number", description: "Минимален quality score (0-1)" }
                        }
                    }
                },
                {
                    name: "solodit_get_finding",
                    description: "Извлича пълни детайли за конкретен Solodit finding по ID, URL или slug.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            finding_id: { type: "string", description: "Solodit finding ID или URL" }
                        },
                        required: ["finding_id"]
                    }
                },
                {
                    name: "solodit_get_filter_options",
                    description: "Връща наличните стойности за филтриране: severities, tags, audit firms, protocols.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "vivisector_ai_enrich",
                    description: "Пуска findings през Multi-Agent AI Pipeline (Analyzer → Skeptic → Repair) за автоматично обогатяване и false positive филтриране.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            scan_result_path: { type: "string", description: "Път до scan_result.json файл" }
                        },
                        required: ["scan_result_path"]
                    }
                }
            ]
        });
        return;
    }

    if (req.method === 'tools/call') {
        const { name, arguments: toolArgs } = req.params;
        await initWasm();

        if (name === 'vivisector_audit_code') {
            const { code, extension } = toolArgs;
            const results = scanCodeBuffer(code, '', extension || '');
            sendResponse(req.id, {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            total_findings: results.length,
                            findings: results
                        }, null, 2)
                    }
                ]
            });
            return;
        }

        if (name === 'vivisector_audit_api') {
            const { url } = toolArgs;
            try {
                const findings = auditApiEndpoint(url);
                sendResponse(req.id, {
                    content: [{ type: "text", text: JSON.stringify({ success: true, total_findings: findings.length, findings }, null, 2) }]
                });
            } catch (err) {
                 sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Грешка при API одита: ${err.message}` }]
                });
            }
            return;
        }

        if (name === 'vivisector_generate_api_report') {
            const { url, report_title } = toolArgs;
            try {
                const findings = auditApiEndpoint(url);
                const markdownReport = generateApiMarkdownReport(findings, url, report_title);
                sendResponse(req.id, {
                    content: [{ type: "text", text: markdownReport }]
                });
            } catch (err) {
                 sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Грешка при генериране на API доклад: ${err.message}` }]
                });
            }
            return;
        }

        if (name === 'vivisector_audit_directory') {
            const { directory_path } = toolArgs;
            if (!fs.existsSync(directory_path)) {
                sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Грешка: Пътят не съществува: ${directory_path}` }]
                });
                return;
            }

            try {
                const { execSync } = require('child_process');
                const viverPath = path.resolve(__dirname, 'viver.js');
                
                // Стартираме CLI-а в JSON режим
                const stdout = execSync(`node "${viverPath}" "${directory_path}" --json`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 50 });
                
                // Търсим началото на JSON масива или обекта в изхода
                const jsonStartIndex = stdout.indexOf('[');
                let findings = [];
                if (jsonStartIndex !== -1) {
                    try {
                        const jsonStr = stdout.substring(jsonStartIndex);
                        findings = JSON.parse(jsonStr);
                    } catch (e) {
                        // Фолбек ако JSON-а не е масив а започва с '{'
                        const objStart = stdout.indexOf('{');
                        if (objStart !== -1) {
                            findings = [JSON.parse(stdout.substring(objStart))];
                        }
                    }
                } else {
                    const objStart = stdout.indexOf('{');
                    if (objStart !== -1) {
                        const parsed = JSON.parse(stdout.substring(objStart));
                        findings = Array.isArray(parsed) ? parsed : [parsed];
                    }
                }

                sendResponse(req.id, {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                directory: directory_path,
                                total_findings: findings.length,
                                findings: findings
                            }, null, 2)
                        }
                    ]
                });
            } catch (err) {
                const errorOutput = err.stderr ? err.stderr.toString() : err.message;
                sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Грешка при извикване на viver.js CLI: ${errorOutput}` }]
                });
            }
            return;
        }

        // ─── SOLODIT TOOLS ────────────────────────────────────────────────
        if (name === 'solodit_search_findings') {
            try {
                const { searchFindings } = require('./solodit/solodit-client');
                const results = await searchFindings({
                    keywords: toolArgs.keywords || null,
                    severity: toolArgs.severity || null,
                    tags: toolArgs.tags || null,
                    limit: toolArgs.limit || 5,
                    qualityScoreMin: toolArgs.quality_score_min || null
                });
                sendResponse(req.id, {
                    content: [{ type: "text", text: JSON.stringify({ success: true, results }, null, 2) }]
                });
            } catch (err) {
                sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Solodit search error: ${err.message}` }]
                });
            }
            return;
        }

        if (name === 'solodit_get_finding') {
            try {
                const { getFinding } = require('./solodit/solodit-client');
                const result = await getFinding(toolArgs.finding_id);
                sendResponse(req.id, {
                    content: [{ type: "text", text: JSON.stringify({ success: true, finding: result }, null, 2) }]
                });
            } catch (err) {
                sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Solodit get finding error: ${err.message}` }]
                });
            }
            return;
        }

        if (name === 'solodit_get_filter_options') {
            try {
                const { getFilterOptions } = require('./solodit/solodit-client');
                const options = await getFilterOptions();
                sendResponse(req.id, {
                    content: [{ type: "text", text: JSON.stringify({ success: true, options }, null, 2) }]
                });
            } catch (err) {
                sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `Solodit filter options error: ${err.message}` }]
                });
            }
            return;
        }

        // ─── AI PIPELINE TOOL ────────────────────────────────────────────
        if (name === 'vivisector_ai_enrich') {
            try {
                const { AgentOrchestrator } = require('./ai-pipeline/agent-orchestrator');
                const scanResult = JSON.parse(fs.readFileSync(toolArgs.scan_result_path, 'utf-8'));
                const orchestrator = new AgentOrchestrator();
                const enriched = await orchestrator.processScanResult(scanResult);

                const outputPath = toolArgs.scan_result_path.replace('.json', '_ai_enriched.json');
                fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2));

                sendResponse(req.id, {
                    content: [{ type: "text", text: JSON.stringify({
                        success: true,
                        outputPath,
                        stats: enriched.ai_stats
                    }, null, 2) }]
                });
            } catch (err) {
                sendResponse(req.id, {
                    isError: true,
                    content: [{ type: "text", text: `AI Pipeline error: ${err.message}` }]
                });
            }
            return;
        }

        sendResponse(req.id, {
            isError: true,
            content: [{ type: "text", text: `Инструментът ${name} не е открит.` }]
        });
        return;
    }

    // Default JSON-RPC ping-back
    if (req.id !== undefined) {
        sendResponse(req.id, { message: "Method not supported" });
    }
}

function sendResponse(id, result) {
    const payload = {
        jsonrpc: "2.0",
        id: id,
        result: result
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
}
