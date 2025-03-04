import { Message } from '../types';

class WebSocketService {
  private ws: WebSocket | null = null;
  private userId: string | null = null;

  connect(userId: string, onMessage: (data: Message | { type: string, userId: string, contactId: string }) => void) {
    this.userId = userId;
    this.ws = new WebSocket(`ws://192.168.31.185:4000?userId=${userId}`);
    this.ws.onopen = () => console.log('WebSocket connected');
    this.ws.onmessage = (event) => onMessage(JSON.parse(event.data));
    this.ws.onerror = (err) => console.error('WebSocket error:', err);
    this.ws.onclose = () => console.log('WebSocket closed');
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    this.ws?.close();
  }
}

const webSocketService = new WebSocketService();
export default webSocketService;