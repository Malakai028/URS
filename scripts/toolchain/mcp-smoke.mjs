const endpoint = "https://developers.openai.com/mcp";
let session;
async function rpc(message) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("MCP HTTP " + response.status);
  session = response.headers.get("mcp-session-id") || session;
  const text = await response.text();
  if (!text.trim()) return;
  const payload = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)))
        .find((item) => item.id === message.id)
    : JSON.parse(text);
  if (payload?.error) throw Error("MCP RPC " + payload.error.code);
  return payload?.result;
}
const init = await rpc({
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ure-toolchain-smoke", version: "0.1.0" },
  },
});
await rpc({ method: "notifications/initialized" });
const catalog = await rpc({ id: 2, method: "tools/list", params: {} });
console.log(
  JSON.stringify({
    server: init.serverInfo,
    tools: catalog.tools.map((t) => t.name),
  }),
);
const search = catalog.tools.find((t) => /search/i.test(t.name));
if (!search) throw Error("No documentation search tool");
const answer = await rpc({
  id: 3,
  method: "tools/call",
  params: {
    name: search.name,
    arguments: { query: "Codex skills" },
  },
});
if (answer.isError || !answer.content?.length)
  throw Error("Documentation search failed");
console.log("PASS MCP initialize, tools/list and documentation search");
