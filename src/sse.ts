#!/usr/bin/env node
import express, { Request, Response } from 'express';
import logger, { LogId } from "./logger.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { config } from "./config.js";
import { Session } from "./session.js";
import { Server } from "./server.js";
import { packageInfo } from "./helpers/packageInfo.js";
import { Telemetry } from "./telemetry/telemetry.js";

const app = express();
app.use(express.json());

const transports: Record<string, SSEServerTransport> = {};

const session = new Session({
    apiBaseUrl: config.apiBaseUrl,
    apiClientId: config.apiClientId,
    apiClientSecret: config.apiClientSecret,
});
const mcpServer = new McpServer({
    name: packageInfo.mcpServerName,
    version: packageInfo.version,
});
const telemetry = Telemetry.create(session, config);
const server = new Server({
    mcpServer,
    session,
    telemetry,
    userConfig: config,
});

app.get('/sse', async (req: Request, res: Response) => {
    console.log('Received GET request to /sse (establishing SSE stream)');
    try {
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;
        transport.onclose = () => {
          console.log(`SSE transport closed for session ${sessionId}`);
          delete transports[sessionId];
        };
        await server.connect(transport);
        console.log(`Established SSE stream with session ID: ${sessionId}`);
    } catch (error) {
        console.error('Error establishing SSE stream:', error);
        if (!res.headersSent) {
            res.status(500).send('Error establishing SSE stream');
        }
    }
});

app.post('/messages', async (req: Request, res: Response) => {
    console.log('Received POST request to /messages');
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
        console.error('No session ID provided in request URL');
        res.status(400).send('Missing sessionId parameter');
        return;
    }
    const transport = transports[sessionId];
    if (!transport) {
        console.error(`No active transport found for session ID: ${sessionId}`);
        res.status(404).send('Session not found');
        return;
    }
    try {
        await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
        console.error('Error handling request:', error);
        if (!res.headersSent) {
            res.status(500).send('Error handling request');
        }
    }
});

const PORT = 6005;
app.listen(PORT, () => {
  console.log(`Simple SSE Server (deprecated protocol version 2024-11-05) listening on port ${PORT}`);
  console.log(`Simple SSE Server Config ${config.connectionString} ${config.connectOptions}`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  for (const sessionId in transports) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  console.log('Server shutdown complete');
  process.exit(0);
});