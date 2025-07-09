import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";

class MCPTimeServer {
  constructor() {
    this.server = new Server({
      name: "mcp-time-server",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    this.setupTools();
    this.sessions = new Map();
  }

  // Handle SSE connection initiation (GET request)
  async handleSSEConnection(req, res) {
    const sessionId = randomUUID();
    const transport = new SSEServerTransport("/mcp", res);

    // Store the session
    this.sessions.set(sessionId, transport);

    // Connect the server to the transport
    await this.server.connect(transport);

    // Start the SSE connection
    await transport.start();

    console.log(`SSE connection established for session: ${sessionId}`);

    // Handle cleanup when connection closes
    transport.onclose = () => {
      this.sessions.delete(sessionId);
      console.log(`Session ${sessionId} closed`);
    };
  }

  // Handle POST messages
  async handlePostMessage(req, res) {
    const sessionId = req.query.sessionId;

    if (!sessionId || !this.sessions.has(sessionId)) {
      return res.status(400).json({ error: "Invalid session ID" });
    }

    const transport = this.sessions.get(sessionId);
    await transport.handlePostMessage(req, res);
  }

  setupTools() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_current_time",
            description: "Get the current date and time",
            inputSchema: {
              type: "object",
              properties: {
                format: {
                  type: "string",
                  description: "Time format: 'iso', 'local', or 'unix'",
                  enum: ["iso", "local", "unix"]
                }
              },
              required: []
            }
          },
          {
            name: "get_timezone_info",
            description: "Get timezone information for the current system",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      console.log(`Received request for tool: ${name}`, args);

      if (name === "get_current_time") {
        const now = new Date();
        const format = args?.format || "iso";

        let timeString;
        switch (format) {
          case "unix":
            timeString = `Unix timestamp: ${Math.floor(now.getTime() / 1000)}`;
            break;
          case "local":
            timeString = `Local time: ${now.toString()}`;
            break;
          case "iso":
          default:
            timeString = `ISO time: ${now.toISOString()}`;
            break;
        }

        return {
          content: [
            {
              type: "text",
              text: timeString
            }
          ]
        };
      }

      if (name === "get_timezone_info") {
        const now = new Date();
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offset = now.getTimezoneOffset();
        const offsetHours = Math.floor(Math.abs(offset) / 60);
        const offsetMinutes = Math.abs(offset) % 60;
        const offsetSign = offset <= 0 ? '+' : '-';

        const tzInfo = [
          `Timezone: ${timeZone}`,
          `UTC Offset: ${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`,
          `Current local time: ${now.toString()}`,
          `Current UTC time: ${now.toUTCString()}`
        ].join('\n');

        return {
          content: [
            {
              type: "text",
              text: tzInfo
            }
          ]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  async cleanup() {
    // Close all sessions
    for (const [sessionId, transport] of this.sessions) {
      transport.close?.();
    }
    this.sessions.clear();
    await this.server.close();
  }
}

// Express app setup
const app = express();
app.use(express.json());

const mcpServer = new MCPTimeServer();

// MCP endpoints
app.get("/mcp", async (req, res) => {
  await mcpServer.handleSSEConnection(req, res);
});

app.post("/mcp", async (req, res) => {
  await mcpServer.handlePostMessage(req, res);
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "mcp-time-server",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Time Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await mcpServer.cleanup();
  process.exit(0);
});