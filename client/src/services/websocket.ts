import { Message } from '../types';

class WebSocketService {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private onMessageCallback: ((data: Message | { type: string; userId: string; contactId: string }) => void) | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 2000; // 2 секунди

  connect(userId: string, onMessage: (data: Message | { type: string; userId: string; contactId: string }) => void) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`WebSocket already connected for user: ${userId}`);
      this.onMessageCallback = onMessage; // Оновлюємо callback, якщо з'єднання вже є
      return;
    }

    this.userId = userId;
    this.onMessageCallback = onMessage;
    this.ws = new WebSocket(`ws://192.168.31.185:4000?userId=${userId}`);

    this.ws.onopen = () => {
      console.log(`WebSocket connected for user: ${userId}`);
      this.reconnectAttempts = 0; // Скидаємо лічильник спроб
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (this.onMessageCallback) {
          this.onMessageCallback(data);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`WebSocket closed for user: ${userId} (Code: ${event.code}, Reason: ${event.reason || 'unknown'})`);
      this.reconnect();
    };

    this.ws.onerror = (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
    };
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached for user ${this.userId}. Giving up.`);
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting WebSocket for user ${this.userId} (Attempt ${this.reconnectAttempts})...`);
    setTimeout(() => {
      if (this.userId && this.onMessageCallback) {
        this.connect(this.userId, this.onMessageCallback);
      }
    }, this.reconnectInterval);
  }

  send(data: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
        resolve();
      } else {
        reject(new Error(`WebSocket is not open for user ${this.userId}. Cannot send message.`));
      }
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.userId = null;
      this.onMessageCallback = null;
      this.reconnectAttempts = 0;
      console.log('WebSocket disconnected');
    }
  }
}

const webSocketService = new WebSocketService();
export default webSocketService;