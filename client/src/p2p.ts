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
  private maxReconnectAttempts: number = 5;
  private messageQueue: Message[] = [];
  private dummyStream: MediaStream | null = null;

  private encryptMessageFn: ((text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair) => string) | null = null;
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
    encryptFn: (text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair) => string,
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
    await this.setupPeerConnection(true);

    try {
      this.setIceConnectionTimeout();
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true, // Додаємо аудіо для сумісності з Safari
        offerToReceiveVideo: false,
        iceRestart: true,
      });
      await this.peerConnection!.setLocalDescription(offer);
      this.socket.emit('p2p-offer', { target: contactId, source: this.userId, offer });
      console.log('P2P offer sent:', offer.sdp);
    } catch (error) {
      console.error('Failed to initiate P2P offer:', error);
      this.tryReconnect();
    }
  }

  async handleP2PRequest(message: Message, accept: boolean) {
    if (!accept || !message.userId || !message.text) return;
    this.contactId = message.userId;
    this.reconnectAttempts = 0;

    let offerData;
    try {
      offerData = JSON.parse(message.text);
      if (offerData.type !== 'offer') return;
    } catch (error) {
      console.error('Failed to parse P2P request:', error);
      return;
    }

    await this.setupPeerConnection(false);
    this.setIceConnectionTimeout();

    try {
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offerData));
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);
      this.socket.emit('p2p-answer', { target: this.contactId, source: this.userId, answer });
      await this.addPendingIceCandidates();
    } catch (error) {
      console.error('Failed to handle P2P request:', error);
      this.tryReconnect();
    }
  }

  async handleP2PAnswer(message: Message) {
    if (!message.text || !this.peerConnection) return;

    let answerData;
    try {
      answerData = JSON.parse(message.text);
      if (!answerData || answerData.type !== 'answer') return;
    } catch (error) {
      console.error('Failed to parse P2P answer:', error);
      return;
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData));
      await this.addPendingIceCandidates();
      console.log('P2P answer set successfully, signaling state:', this.peerConnection.signalingState);
    } catch (error) {
      console.error('Failed to set P2P answer:', error);
      this.tryReconnect();
    }
  }

  async handleP2PCandidate(message: Message) {
    if (!message.text || !this.peerConnection) return;

    let candidateData;
    try {
      candidateData = JSON.parse(message.text);
      if (!candidateData.candidate) return;
    } catch (error) {
      console.error('Failed to parse ICE candidate:', error);
      return;
    }

    const candidate = new RTCIceCandidate(candidateData);

    try {
      if (this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('ICE candidate added:', candidate.candidate);
      } else {
        this.pendingCandidates.push(candidate);
        console.log('ICE candidate queued:', candidate.candidate);
      }
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }

  private async addPendingIceCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;

    console.log(`Adding ${this.pendingCandidates.length} pending ICE candidates`);
    for (const candidate of this.pendingCandidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added pending ICE candidate:', candidate.candidate);
      } catch (error) {
        console.error('Error adding pending ICE candidate:', error);
      }
    }
    this.pendingCandidates = [];
  }

  async sendP2PMessage(message: Message) {
    if (!this.dataChannel || !this.tweetNaclKeyPair || !this.contactPublicKey || !this.encryptMessageFn) {
      console.error('P2P setup incomplete:', {
        dataChannel: !!this.dataChannel,
        tweetNaclKeyPair: !!this.tweetNaclKeyPair,
        contactPublicKey: !!this.contactPublicKey,
        encryptMessageFn: !!this.encryptMessageFn,
      });
      this.messageQueue.push(message);
      return;
    }

    if (this.dataChannel.readyState !== 'open') {
      console.warn('DataChannel not open, queuing message. Current state:', this.dataChannel.readyState);
      this.messageQueue.push(message);
      this.requestIceRestart();
      return;
    }

    try {
      const contactPublicKeyBase64 = Buffer.from(this.contactPublicKey).toString('base64');
      const encryptedText = this.encryptMessageFn(message.text, contactPublicKeyBase64, this.tweetNaclKeyPair);
      const p2pMessage: Message = {
        ...message,
        text: encryptedText,
        isP2P: true,
      };

      const chunkSize = 16384;
      const messageStr = JSON.stringify(p2pMessage);
      if (messageStr.length <= chunkSize) {
        this.dataChannel.send(messageStr);
        console.log('P2P message sent via DataChannel:', p2pMessage);
      } else {
        const chunks = Math.ceil(messageStr.length / chunkSize);
        for (let i = 0; i < chunks; i++) {
          const chunk = messageStr.substring(i * chunkSize, (i + 1) * chunkSize);
          this.dataChannel.send(JSON.stringify({ chunk, totalChunks: chunks, chunkIndex: i }));
          console.log(`P2P message chunk ${i + 1}/${chunks} sent`);
        }
      }
      this.onP2PMessage({ ...p2pMessage, text: message.text });
    } catch (error) {
      console.error('Failed to send P2P message:', error);
      this.messageQueue.push(message);
      this.requestIceRestart();
    }
  }

  disconnectP2P() {
    if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
    if (this.dataChannel) this.dataChannel.close();
    if (this.peerConnection) this.peerConnection.close();
    if (this.dummyStream) this.dummyStream.getTracks().forEach(track => track.stop());
    this.peerConnection = null;
    this.dataChannel = null;
    this.contactId = null;
    this.contactPublicKey = null;
    this.dummyStream = null;
    this.pendingCandidates = [];
    this.messageQueue = [];
    this.onP2PStatusChange(false);
    console.log('P2P connection disconnected');
  }

  private async setupPeerConnection(isInitiator: boolean) {
    if (this.peerConnection) this.peerConnection.close();
    if (this.dummyStream) this.dummyStream.getTracks().forEach(track => track.stop());

    try {
      // Запитуємо медіапотік для сумісності з Safari
      this.dummyStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { 
            urls: [
              'turn:openrelay.metered.ca:80',
              'turn:openrelay.metered.ca:443',
              'turn:openrelay.metered.ca:443?transport=tcp',
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
      });

      // Додаємо dummy аудіопотік до peerConnection
      this.dummyStream.getTracks().forEach(track => this.peerConnection!.addTrack(track, this.dummyStream!));

      if (isInitiator) {
        this.dataChannel = this.peerConnection.createDataChannel('chat', {
          ordered: true,
          maxPacketLifeTime: 3000,
        });
        this.setupDataChannel();
      } else {
        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };
      }

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.contactId) {
          this.socket.emit('p2p-ice-candidate', {
            target: this.contactId,
            source: this.userId,
            candidate: event.candidate,
          });
          console.log('ICE candidate generated:', {
            candidate: event.candidate.candidate,
            type: event.candidate.type,
            address: event.candidate.address,
            port: event.candidate.port,
          });
        } else if (!event.candidate) {
          console.log('ICE candidate gathering completed');
        }
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        if (!this.peerConnection) return;
        const state = this.peerConnection.iceConnectionState;
        console.log('ICE Connection State:', state);
        switch (state) {
          case 'connected':
          case 'completed':
            if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
            this.reconnectAttempts = 0;
            this.onP2PStatusChange(true);
            this.processMessageQueue();
            console.log('P2P connection established');
            break;
          case 'failed':
          case 'disconnected':
            console.log('ICE connection failed or disconnected');
            this.tryReconnect();
            break;
          case 'closed':
            this.onP2PStatusChange(false);
            console.log('P2P connection closed');
            break;
        }
      };

      this.peerConnection.onicegatheringstatechange = () => {
        console.log('ICE Gathering State:', this.peerConnection?.iceGatheringState);
      };

      this.peerConnection.onconnectionstatechange = () => {
        console.log('Connection State:', this.peerConnection?.connectionState);
        if (this.peerConnection?.connectionState === 'failed') {
          this.tryReconnect();
        }
      };
    } catch (error) {
      console.error('Failed to setup peer connection with media stream:', error);
      throw error;
    }
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    let messageBuffer = '';
    const chunkedMessages = new Map<string, { chunks: string[]; totalChunks: number }>();

    this.dataChannel.onopen = () => {
      console.log('P2P DataChannel opened, readyState:', this.dataChannel?.readyState);
      this.onP2PStatusChange(true);
      this.processMessageQueue();
    };

    this.dataChannel.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.chunk && data.totalChunks && data.chunkIndex !== undefined) {
          const messageId = `${this.contactId}-${Date.now()}`;
          let chunkData = chunkedMessages.get(messageId) || { chunks: [], totalChunks: data.totalChunks };
          chunkData.chunks[data.chunkIndex] = data.chunk;
          chunkedMessages.set(messageId, chunkData);

          if (chunkData.chunks.filter(Boolean).length === data.totalChunks) {
            messageBuffer = chunkData.chunks.join('');
            chunkedMessages.delete(messageId);
          } else {
            return;
          }
        } else {
          messageBuffer = event.data;
        }

        const receivedMessage = JSON.parse(messageBuffer) as Message;
        if (this.decryptMessageFn) {
          const decryptedText = await this.decryptMessageFn(receivedMessage.text, receivedMessage.userId);
          this.onP2PMessage({ ...receivedMessage, text: decryptedText, isP2P: true });
          console.log('Received P2P message via DataChannel:', { ...receivedMessage, text: decryptedText });
        }
      } catch (error) {
        console.error('Failed to process P2P message:', error);
      }
    };

    this.dataChannel.onclose = () => {
      console.log('P2P DataChannel closed');
      this.onP2PStatusChange(false);
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
      this.tryReconnect();
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
  }

  private setIceConnectionTimeout() {
    if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
    this.iceConnectionTimeout = setTimeout(() => {
      if (this.peerConnection && ['checking', 'new'].includes(this.peerConnection.iceConnectionState)) {
        console.log('ICE connection timeout');
        this.tryReconnect();
      }
    }, 30000);
  }

  private async tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.contactId) {
      console.log('Max reconnect attempts reached or no contact ID');
      this.disconnectP2P();
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    await this.initiateP2P(this.contactId);
  }

  private processMessageQueue() {
    if (!this.isP2PActive() || !this.messageQueue.length) return;
    const queue = [...this.messageQueue];
    this.messageQueue = [];
    queue.forEach(msg => this.sendP2PMessage(msg));
  }

  public requestIceRestart() {
    if (this.contactId && this.peerConnection) {
      console.log('Requesting ICE restart');
      this.restartIce();
    }
  }

  private async restartIce() {
    if (!this.peerConnection || !this.contactId) return;
    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('p2p-offer', { target: this.contactId, source: this.userId, offer });
      this.setIceConnectionTimeout();
    } catch (error) {
      console.error('Failed to restart ICE:', error);
      this.tryReconnect();
    }
  }

  isP2PActive(): boolean {
    return this.dataChannel?.readyState === 'open';
  }
}

export default P2PService;