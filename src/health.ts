import { createServer, IncomingMessage, ServerResponse } from "http";
import { MqttClient } from "mqtt";
import { logger } from "./logger.js";

export class HealthServer {
  private server: ReturnType<typeof createServer>;
  private brokers: Record<string, MqttClient> = {};

  constructor(port: number = 8080) {
    this.server = createServer(this.handleRequest.bind(this));
    this.server.listen(port, () => {
      logger.info(`Health server listening on port ${port}`);
    });
  }

  public addBroker(id: string, client: MqttClient): void {
    this.brokers[id] = client;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === "/health" && req.method === "GET") {
      const brokerStatuses: Record<string, boolean> = {};
      for (const [id, client] of Object.entries(this.brokers)) {
        brokerStatuses[id] = client.connected;
      }
      const status = {
        status: "ok",
        brokers: brokerStatuses,
        timestamp: new Date().toISOString(),
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404);
      res.end();
    }
  }

  public close(): void {
    this.server.close();
  }
}
