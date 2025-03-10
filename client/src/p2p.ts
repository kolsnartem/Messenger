import { Message, TweetNaClKeyPair } from './types';
import { Socket } from 'socket.io-client';

export class P2PService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private userId: string;
  private contactId: string | null = null;
  private contactPublicKey: Uint8Array | null = null;
  private socket: Socket;
  private onP2PMessage: (message: Message) => void;
  private onP2PStatusChange: (isActive: boolean) => void;
  private tweetNaclKeyPair: TweetNaClKeyPair | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private iceConnectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;

  private encryptMessageFn: ((text: string, contactPublicKey: string, tweetNaClKeyPair: TweetNaClKeyPair) => string) | null = null;
  private decryptMessageFn: ((encryptedText: string, senderId: string) => Promise<string>) | null = null;

  constructor(
    userId: string,
    socket: Socket,
    onP2PMessage: (message: Message) => void,
    onP2PStatusChange: (isActive: boolean) => void
  ) {
    this.userId = userId;
    this.socket = socket;
    this.onP2PMessage = onP2PMessage;
    this.onP2PStatusChange = onP2PStatusChange;
    this.setupSocketListeners();
  }

  setTweetNaclKeyPair(keyPair: TweetNaClKeyPair | null) {
    this.tweetNaclKeyPair = keyPair;
    console.log('TweetNaCl key pair set:', !!keyPair);
  }

  setEncryptionFunctions(
    encryptFn: (text: string, contactPublicKey: string, tweetNaClKeyPair: TweetNaClKeyPair) => string,
    decryptFn: (encryptedText: string, senderId: string) => Promise<string>
  ) {
    this.encryptMessageFn = encryptFn;
    this.decryptMessageFn = decryptFn;
    console.log('Encryption functions set:', !!this.encryptMessageFn, !!this.decryptMessageFn);
  }

  setContactPublicKey(publicKey: string) {
    try {
      const cleanedKey = publicKey.replace(/[^A-Za-z0-9+/=]/g, '');
      this.contactPublicKey = new Uint8Array(Buffer.from(cleanedKey, 'base64'));
      if (this.contactPublicKey.length !== 32) {
        throw new Error(`Invalid contact public key length: expected 32 bytes, got ${this.contactPublicKey.length}`);
      }
      console.log('Contact public key set for P2P encryption:', publicKey);
    } catch (error) {
      console.error('Failed to set contact public key:', (error as Error).message);
      this.contactPublicKey = null;
    }
  }

  async initiateP2P(contactId: string) {
    this.contactId = contactId;
    this.reconnectAttempts = 0;
    this.setupPeerConnection(true);

    try {
      // Встановлюємо таймаут для ICE підключення
      this.setIceConnectionTimeout();
      
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        iceRestart: true
      });
      console.log('Created offer:', offer.sdp);
      await this.peerConnection!.setLocalDescription(offer);
      console.log('Set local description (offer), signaling state:', this.peerConnection!.signalingState);
      this.socket.emit('p2p-offer', { target: contactId, source: this.userId, offer });
      console.log('P2P offer sent:', offer.sdp);
    } catch (error) {
      console.error('Failed to initiate P2P offer:', (error as Error).message);
      throw error;
    }
  }

  async handleP2PRequest(message: Message, accept: boolean) {
    if (!accept || !message.userId || !message.text) return;
    this.contactId = message.userId;
    this.reconnectAttempts = 0;

    let offerData;
    try {
      offerData = JSON.parse(message.text);
      console.log('Handling P2P request, offer:', offerData);
    } catch (error) {
      console.error('Failed to parse P2P request:', (error as Error).message);
      return;
    }

    if (offerData.type !== 'offer') return;

    this.setupPeerConnection(false);
    this.setIceConnectionTimeout();
    
    try {
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offerData));
      console.log('Set remote description (offer), signaling state:', this.peerConnection!.signalingState);
      
      const answer = await this.peerConnection!.createAnswer();
      console.log('Created answer:', answer.sdp);
      await this.peerConnection!.setLocalDescription(answer);
      console.log('Set local description (answer), signaling state:', this.peerConnection!.signalingState);

      this.socket.emit('p2p-answer', { target: this.contactId, source: this.userId, answer });
      console.log('P2P answer sent:', answer.sdp);

      // Додаємо накопичені ICE кандидати після встановлення відповіді
      await this.addPendingIceCandidates();
    } catch (error) {
      console.error('Failed to handle P2P request:', (error as Error).message);
      throw error;
    }
  }

  async handleP2PAnswer(message: Message) {
    if (!message.text || !this.peerConnection) return;

    let answerData;
    try {
      answerData = JSON.parse(message.text);
      console.log('Received P2P answer:', answerData);
    } catch (error) {
      console.error('Failed to parse P2P answer:', (error as Error).message);
      return;
    }

    if (!answerData || typeof answerData !== 'object') return;

    try {
      console.log('Current signaling state before setting answer:', this.peerConnection.signalingState);
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData));
      console.log('P2P answer set successfully, signaling state:', this.peerConnection.signalingState);

      // Додаємо накопичені ICE кандидати після встановлення відповіді
      await this.addPendingIceCandidates();
    } catch (error) {
      console.error('Failed to set P2P answer:', (error as Error).message, (error as Error).name, (error as Error).stack);
      throw error;
    }
  }

  async handleP2PCandidate(message: Message) {
    if (!message.text || !this.peerConnection) return;

    let candidateData;
    try {
      candidateData = JSON.parse(message.text);
      console.log('Received ICE candidate:', candidateData);
    } catch (error) {
      console.error('Failed to parse ICE candidate:', (error as Error).message);
      return;
    }

    if (!candidateData || typeof candidateData !== 'object' || !candidateData.candidate) return;

    const candidate = new RTCIceCandidate(candidateData);
    
    try {
      // Перевіряємо наявність перевірки кандидата (IPv4 vs IPv6, relayed vs direct)
      console.log('ICE candidate type:', candidate.type);
      console.log('ICE candidate protocol:', candidate.protocol);
      console.log('ICE candidate address:', candidate.address);
      
      if (this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('ICE candidate added:', candidate.candidate);
      } else {
        this.pendingCandidates.push(candidate);
        console.log('ICE candidate queued:', candidate.candidate);
      }
    } catch (error) {
      console.error('Failed to add ICE candidate:', (error as Error).message);
    }
  }

  private async addPendingIceCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    
    console.log(`Adding ${this.pendingCandidates.length} pending ICE candidates`);
    for (const candidate of this.pendingCandidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added pending ICE candidate:', candidate);
      } catch (error) {
        console.error('Error adding pending ICE candidate:', (error as Error).message);
      }
    }
    this.pendingCandidates = [];
  }

  async sendP2PMessage(message: Message) {
    if (!this.dataChannel) {
      console.error('DataChannel is not initialized');
      throw new Error('DataChannel is not initialized');
    }

    if (this.dataChannel.readyState !== 'open') {
      console.error('DataChannel is not open, current state:', this.dataChannel.readyState);
      throw new Error('P2P connection is not ready');
    }

    if (!this.tweetNaclKeyPair || !this.contactPublicKey || !this.encryptMessageFn) {
      console.error('Encryption setup incomplete:', {
        tweetNaclKeyPair: !!this.tweetNaclKeyPair,
        contactPublicKey: !!this.contactPublicKey,
        encryptMessageFn: !!this.encryptMessageFn,
      });
      throw new Error('Encryption setup not ready');
    }

    try {
      const contactPublicKeyBase64 = Buffer.from(this.contactPublicKey).toString('base64');
      const encryptedText = this.encryptMessageFn(message.text, contactPublicKeyBase64, this.tweetNaclKeyPair);
      const p2pMessage: Message = {
        id: message.id,
        userId: this.userId,
        contactId: this.contactId!,
        text: encryptedText,
        timestamp: message.timestamp,
        isRead: 0,
        isMine: true,
        isP2P: true,
      };

      // Розбиваємо великі повідомлення на частини (для обходу обмежень MTU)
      const chunkSize = 16000; // Тюнінгуємо цей розмір при необхідності
      const messageStr = JSON.stringify(p2pMessage);
      
      if (messageStr.length <= chunkSize) {
        console.log('Sending P2P message via DataChannel:', p2pMessage);
        this.dataChannel.send(messageStr);
      } else {
        // Розбиваємо на частини, якщо повідомлення завелике
        const chunks = Math.ceil(messageStr.length / chunkSize);
        for (let i = 0; i < chunks; i++) {
          const chunk = messageStr.substring(i * chunkSize, (i + 1) * chunkSize);
          console.log(`Sending P2P message chunk ${i+1}/${chunks}`);
          this.dataChannel.send(chunk);
        }
      }
      
      console.log('P2P message sent successfully');
      this.onP2PMessage({ ...p2pMessage, text: message.text });
    } catch (error) {
      console.error('Failed to send P2P message:', (error as Error).message);
      throw error;
    }
  }

  disconnectP2P() {
    if (this.iceConnectionTimeout) {
      clearTimeout(this.iceConnectionTimeout);
      this.iceConnectionTimeout = null;
    }
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    this.contactId = null;
    this.contactPublicKey = null;
    this.pendingCandidates = [];
    this.onP2PStatusChange(false);
    console.log('P2P connection disconnected');
  }

  private setupPeerConnection(isInitiator: boolean) {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    // Розширена конфігурація ICE серверів з TURN
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Додайте ваші TURN сервери тут, наприклад:
        {
          urls: 'turn:numb.viagenie.ca',
          username: 'webrtc@live.com',
          credential: 'muazkh'
        },
        {
          urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
          username: 'webrtc',
          credential: 'webrtc'
        }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all', // Спробуйте 'relay' якщо проблеми зберігаються
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      sdpSemantics: 'unified-plan'
    });

    // Налаштовуємо dataChannel з покращеними параметрами для мобільних мереж
    if (isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('chat', {
        ordered: true,
        // Виправлено: Використовуємо лише один з параметрів
        maxPacketLifeTime: 3000 // 3 секунди максимального часу життя пакету
        // maxRetransmits: 5 - видалено цей параметр, щоб уникнути конфлікту
      });
      this.setupDataChannel();
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    // Налаштування ICE кандидатів з тісним зв'язком
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.contactId) {
        console.log('Generated ICE candidate:', {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address,
          port: event.candidate.port,
          candidateType: event.candidate.candidate.split(' ')[7] // Додаткова інформація про тип кандидата
        });
        
        this.socket.emit('p2p-ice-candidate', {
          target: this.contactId,
          source: this.userId,
          candidate: event.candidate,
        });
        console.log('ICE candidate sent:', event.candidate);
      } else if (!event.candidate) {
        console.log('ICE gathering completed');
      }
    };

    // Покращений моніторинг стану ICE з'єднання
    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      
      const state = this.peerConnection.iceConnectionState;
      console.log('ICE Connection State:', state);
      
      switch (state) {
        case 'checking':
          console.log('Checking ICE candidates...');
          break;
        case 'connected':
        case 'completed':
          if (this.iceConnectionTimeout) {
            clearTimeout(this.iceConnectionTimeout);
            this.iceConnectionTimeout = null;
          }
          this.reconnectAttempts = 0;
          this.onP2PStatusChange(true);
          console.log('P2P connection established successfully');
          break;
        case 'disconnected':
          console.log('ICE connection disconnected - may recover automatically');
          // Даємо можливість автоматичного відновлення
          break;
        case 'failed':
          console.log('ICE connection failed');
          this.tryReconnect();
          break;
        case 'closed':
          this.onP2PStatusChange(false);
          console.log('P2P connection closed');
          this.disconnectP2P();
          break;
      }
    };

    // Додаємо моніторинг стану збору ICE кандидатів
    this.peerConnection.onicegatheringstatechange = () => {
      console.log('ICE Gathering State:', this.peerConnection?.iceGatheringState);
    };

    // Моніторинг загального стану з'єднання
    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection State:', this.peerConnection?.connectionState);
      
      if (this.peerConnection?.connectionState === 'failed') {
        console.log('Connection failed, attempting reconnect...');
        this.tryReconnect();
      }
    };

    console.log('PeerConnection setup complete with enhanced configuration');
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('P2P DataChannel opened, readyState:', this.dataChannel?.readyState);
      this.onP2PStatusChange(true);
      
      // Очищаємо таймаут, коли канал відкритий
      if (this.iceConnectionTimeout) {
        clearTimeout(this.iceConnectionTimeout);
        this.iceConnectionTimeout = null;
      }
    };

    // Покращуємо обробку повідомлень з підтримкою розбитих на частини даних
    let messageBuffer = '';
    
    this.dataChannel.onmessage = async (event) => {
      if (!event.data) {
        console.error('Received empty P2P message');
        return;
      }

      try {
        // Спроба обробити повідомлення як одне ціле
        messageBuffer += event.data;
        let receivedMessage: Message;
        
        try {
          receivedMessage = JSON.parse(messageBuffer) as Message;
          // Якщо успішно розпарсили - значить це повне повідомлення
          messageBuffer = ''; // очищуємо буфер
          
          if (!receivedMessage.id || !receivedMessage.userId || !receivedMessage.text) {
            throw new Error('Invalid message format');
          }
          
          receivedMessage.isP2P = true;
          console.log('Received complete P2P message:', receivedMessage);
          
          if (this.decryptMessageFn) {
            const decryptedText = await this.decryptMessageFn(receivedMessage.text, receivedMessage.userId);
            this.onP2PMessage({ ...receivedMessage, text: decryptedText });
          } else {
            this.onP2PMessage(receivedMessage);
          }
        } catch (jsonError) {
          // Якщо не вдалося розпарсити - можливо це частина повідомлення
          // Буфер продовжує зберігати дані до наступного кусочка
          console.log('Accumulated partial message, waiting for more chunks...');
        }
      } catch (error) {
        console.error('Failed to parse or decrypt P2P message:', (error as Error).message);
        messageBuffer = ''; // Очищуємо буфер в разі помилки
      }
    };

    this.dataChannel.onclose = () => {
      console.log('P2P DataChannel closed');
      this.onP2PStatusChange(false);
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };
  }

  private setupSocketListeners() {
    this.socket.on('p2p-offer', async (data: { offer: RTCSessionDescriptionInit; source: string }) => {
      const message: Message = {
        id: `p2p-request-${Date.now()}`,
        userId: data.source,
        contactId: this.userId,
        text: JSON.stringify({ type: 'offer', sdp: data.offer.sdp }),
        timestamp: Date.now(),
        isRead: 0,
        isP2P: true,
      };
      if (this.contactId === data.source) {
        await this.handleP2PRequest(message, true);
      } else {
        this.socket.emit('p2p-offer-notify', { message });
      }
    });

    this.socket.on('p2p-answer', (data: { answer: RTCSessionDescriptionInit; source: string }) => {
      const message: Message = {
        id: `p2p-answer-${Date.now()}`,
        userId: data.source,
        contactId: this.userId,
        text: JSON.stringify(data.answer),
        timestamp: Date.now(),
        isRead: 0,
        isP2P: true,
      };
      this.handleP2PAnswer(message);
    });

    this.socket.on('p2p-ice-candidate', (data: { candidate: RTCIceCandidateInit; source: string }) => {
      const message: Message = {
        id: `p2p-candidate-${Date.now()}`,
        userId: data.source,
        contactId: this.userId,
        text: JSON.stringify(data.candidate),
        timestamp: Date.now(),
        isRead: 0,
        isP2P: true,
      };
      this.handleP2PCandidate(message);
    });

    this.socket.on('p2p-reject', (data: { source: string }) => {
      if (data.source === this.contactId) {
        console.log('P2P request rejected by:', data.source);
        this.disconnectP2P();
      }
    });
    
    // Додаємо обробник для рестарту ICE у разі потреби
    this.socket.on('p2p-restart-ice', (data: { source: string }) => {
      if (data.source === this.contactId && this.peerConnection) {
        console.log('Received ICE restart request from:', data.source);
        this.restartIce();
      }
    });
  }

  private setIceConnectionTimeout() {
    // Встановлюємо таймаут для ICE підключення
    if (this.iceConnectionTimeout) {
      clearTimeout(this.iceConnectionTimeout);
    }
    
    this.iceConnectionTimeout = setTimeout(() => {
      if (this.peerConnection && 
         (this.peerConnection.iceConnectionState === 'checking' || 
          this.peerConnection.iceConnectionState === 'new')) {
        console.log('ICE connection timeout - connection taking too long');
        this.tryReconnect();
      }
    }, 15000); // 15 секунд на встановлення з'єднання
  }

  private async tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.contactId) {
      console.log('Max reconnect attempts reached or no contact ID');
      this.disconnectP2P();
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    try {
      if (this.peerConnection) {
        await this.restartIce();
      } else {
        await this.initiateP2P(this.contactId);
      }
    } catch (error) {
      console.error('Failed to reconnect:', (error as Error).message);
      this.disconnectP2P();
    }
  }

  private async restartIce() {
    if (!this.peerConnection || !this.contactId) return;
    
    try {
      console.log('Restarting ICE connection');
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
      
      this.socket.emit('p2p-offer', { 
        target: this.contactId, 
        source: this.userId, 
        offer,
        isRestart: true
      });
      
      this.setIceConnectionTimeout();
    } catch (error) {
      console.error('Failed to restart ICE:', (error as Error).message);
    }
  }

  isP2PActive(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  // Метод для програмного запуску ICE рестарту (можна викликати при виявленні проблем з LTE)
  public requestIceRestart() {
    if (this.contactId && this.peerConnection) {
      console.log('Manually requesting ICE restart');
      this.restartIce();
      // Також повідомляємо контакт про необхідність рестарту
      this.socket.emit('p2p-restart-ice', { 
        target: this.contactId, 
        source: this.userId
      });
    }
  }
  
  // Додаємо метод для зміни транспортної політики на relay, якщо прямі з'єднання не працюють
  public forceTurnRelay() {
    if (this.peerConnection) {
      this.disconnectP2P();
    }
    
    if (this.contactId) {
      // Створюємо нове з'єднання з TURN-only політикою
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          // Використовуємо тільки TURN сервери
          {
            urls: 'turn:numb.viagenie.ca',
            username: 'webrtc@live.com',
            credential: 'muazkh'
          },
          {
            urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
            username: 'webrtc',
            credential: 'webrtc'
          }
        ],
        iceTransportPolicy: 'relay', // Примусово використовуємо тільки relay кандидати
      });
      
      console.log('Forced TURN relay mode activated');
      this.initiateP2P(this.contactId);
    }
  }
}

export default P2PService;