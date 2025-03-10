import io, { Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;

  connect(userId: string): Socket {
    this.socket = io('http://100.64.221.88:4000', { query: { userId } });
    this.socket.on('connect', () => console.log(`Socket.IO connected for user: ${userId}`));
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      console.log('Socket.IO disconnected');
    }
  }

  emit(event: string, data: any) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event: string) {
    if (this.socket) {
      this.socket.off(event);
    }
  }
}

const socketService = new SocketService();
export default socketService;