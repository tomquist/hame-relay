import { createServer, IncomingMessage, ServerResponse } from 'http';
import { MqttClient } from 'mqtt';

export class HealthServer {
  private server: ReturnType<typeof createServer>;
  private configBroker: MqttClient;
  private hameBroker: MqttClient;

  constructor(configBroker: MqttClient, hameBroker: MqttClient, port: number = 8080) {
    this.configBroker = configBroker;
    this.hameBroker = hameBroker;
    
    this.server = createServer(this.handleRequest.bind(this));
    this.server.listen(port, () => {
      console.log(`Health server listening on port ${port}`);
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === '/health' && req.method === 'GET') {
      const status = {
        status: 'ok',
        configBroker: this.configBroker.connected,
        hameBroker: this.hameBroker.connected,
        timestamp: new Date().toISOString()
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
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