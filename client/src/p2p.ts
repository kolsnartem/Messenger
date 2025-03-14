import { Message, TweetNaClKeyPair } from './types';
import { Socket } from 'socket.io-client';

declare global {
  interface Navigator {
    connection?: {
      type?: string;
      effectiveType?: string;
      downlink?: number;
      onchange?: ((this: NetworkInformation, ev: Event) => any) | null;
    };
  }
}

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
  private maxReconnectAttempts: number;
  private chunkSize: number;

  private encryptMessageFn: ((text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair) => string) | null = null;
  private decryptMessageFn: ((encryptedText: string, senderId: string) => Promise<string>) | null = null;

  constructor(
    userId: string,
    socket: Socket,
    onP2PMessage: (message: Message) => void,
    onP2PStatusChange: (isActive: boolean) => void,
    config: {
      iceServers?: RTCIceServer[];
      maxReconnectAttempts?: number;
      chunkSize?: number;
    } = {}
  ) {
    this.userId = userId;
    this.socket = socket;
    this.onP2PMessage = onP2PMessage;
    this.onP2PStatusChange = onP2PStatusChange;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 3;
    this.chunkSize = config.chunkSize || 16000;
    this.setupSocketListeners();
    this.monitorNetwork();
    this.monitorConnectionStats();
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
      const keyBytes = new Uint8Array(Buffer.from(cleanedKey, 'base64'));
      
      if (keyBytes.length !== 32) {
        throw new Error(`Invalid key length: ${keyBytes.length} bytes`);
      }
      if (keyBytes.every(byte => byte === 0)) {
        throw new Error('Invalid all-zero key');
      }
      
      this.contactPublicKey = keyBytes;
      console.log('Contact public key set:', publicKey);
    } catch (error) {
      console.error('Public key validation failed:', error);
      this.contactPublicKey = null;
      throw error;
    }
  }

  async initiateP2P(contactId: string) {
    this.contactId = contactId;
    this.reconnectAttempts = 0;
    this.setupPeerConnection(true);
    
    try {
      this.setIceConnectionTimeout();
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
        iceRestart: true
      });
      await this.peerConnection!.setLocalDescription(offer);
      this.socket.emit('p2p-offer', { target: contactId, source: this.userId, offer });
      console.log('P2P offer sent:', offer.sdp);
    } catch (error) {
      console.error('Failed to initiate P2P:', error);
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
    } catch (error) {
      console.error('Failed to parse P2P request:', error);
      return;
    }

    if (offerData.type !== 'offer') return;

    this.setupPeerConnection(false);
    this.setIceConnectionTimeout();
    
    try {
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offerData));
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);
      this.socket.emit('p2p-answer', { target: this.contactId, source: this.userId, answer });
      await this.addPendingIceCandidates();
    } catch (error) {
      console.error('Failed to handle P2P request:', error);
      throw error;
    }
  }

  async handleP2PAnswer(message: Message) {
    if (!message.text || !this.peerConnection) return;

    let answerData;
    try {
      answerData = JSON.parse(message.text);
    } catch (error) {
      console.error('Failed to parse P2P answer:', error);
      return;
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData));
      await this.addPendingIceCandidates();
    } catch (error) {
      console.error('Failed to set P2P answer:', error);
      throw error;
    }
  }

  async handleP2PCandidate(message: Message) {
    if (!message.text || !this.peerConnection) return;

    let candidateData;
    try {
      candidateData = JSON.parse(message.text);
    } catch (error) {
      console.error('Failed to parse ICE candidate:', error);
      return;
    }

    const candidate = new RTCIceCandidate(candidateData);
    try {
      if (this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(candidate);
      } else {
        this.pendingCandidates.push(candidate);
      }
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
    }
  }

  private async addPendingIceCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    
    for (const candidate of this.pendingCandidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding pending ICE candidate:', error);
      }
    }
    this.pendingCandidates = [];
  }

  async sendP2PMessage(message: Message) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('P2P connection not ready');
    }

    if (!this.tweetNaclKeyPair || !this.contactPublicKey || !this.encryptMessageFn) {
      throw new Error('Encryption setup not ready');
    }

    try {
      const contactPublicKeyBase64 = Buffer.from(this.contactPublicKey).toString('base64');
      const encryptedText = this.encryptMessageFn(message.text, contactPublicKeyBase64, this.tweetNaclKeyPair);
      const p2pMessage: Message = {
        ...message,
        userId: this.userId,
        contactId: this.contactId!,
        text: encryptedText,
        isP2P: true,
        isMine: true
      };

      const maxPacketSize = 16384;
      const estimatedOverhead = 50;
      const chunkSize = Math.min(
        maxPacketSize - estimatedOverhead,
        this.dataChannel.bufferedAmountLowThreshold || this.chunkSize
      );
      const messageStr = JSON.stringify(p2pMessage);

      if (messageStr.length <= chunkSize) {
        this.dataChannel.send(messageStr);
      } else {
        const totalChunks = Math.ceil(messageStr.length / chunkSize);
        for (let i = 0; i < totalChunks; i++) {
          const chunk = messageStr.slice(i * chunkSize, (i + 1) * chunkSize);
          this.dataChannel.send(JSON.stringify({
            id: message.id,
            chunkIndex: i,
            totalChunks,
            chunkData: chunk
          }));
        }
      }
      this.onP2PMessage({ ...p2pMessage, text: message.text });
    } catch (error) {
      console.error('Failed to send P2P message:', error);
      throw error;
    }
  }

  disconnectP2P() {
    if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
    if (this.dataChannel) this.dataChannel.close();
    if (this.peerConnection) this.peerConnection.close();
    
    this.peerConnection = null;
    this.dataChannel = null;
    this.contactId = null;
    this.contactPublicKey = null;
    this.pendingCandidates = [];
    this.onP2PStatusChange(false);
  }

  private setupPeerConnection(isInitiator: boolean) {
    if (this.peerConnection) this.peerConnection.close();

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:stun.nextcloud.com:443' },
        {
          urls: [
            'turn:numb.viagenie.ca:3478?transport=udp',
            'turn:numb.viagenie.ca:3478?transport=tcp'
          ],
          username: 'webrtc@live.com',
          credential: 'muazkh'
        }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    if (isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('chat', {
        ordered: true,
        maxPacketLifeTime: 3000
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
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log('ICE Connection State:', state);
      
      switch (state) {
        case 'connected':
        case 'completed':
          if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
          this.reconnectAttempts = 0;
          this.onP2PStatusChange(true);
          break;
        case 'failed':
          this.tryReconnect();
          break;
        case 'closed':
          this.onP2PStatusChange(false);
          this.disconnectP2P();
          break;
      }
    };

    this.peerConnection.onsignalingstatechange = () => {
      console.log('Signaling state:', this.peerConnection?.signalingState);
    };

    this.peerConnection.onnegotiationneeded = () => {
      if (isInitiator && this.contactId) this.initiateP2P(this.contactId);
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (this.peerConnection?.connectionState === 'failed') {
        this.tryReconnect();
      }
    };
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.bufferedAmountLowThreshold = 32768;
    this.dataChannel.onopen = () => {
      if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
      this.onP2PStatusChange(true);
    };

    let messageBuffer = '';
    const chunkedMessages = new Map<string, { chunks: string[]; total: number }>();

    this.dataChannel.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.chunkIndex !== undefined) {
          const msgId = data.id;
          if (!chunkedMessages.has(msgId)) {
            chunkedMessages.set(msgId, { chunks: [], total: data.totalChunks });
          }
          
          const msg = chunkedMessages.get(msgId)!;
          msg.chunks[data.chunkIndex] = data.chunkData;
          
          if (msg.chunks.filter(Boolean).length === msg.total) {
            messageBuffer = msg.chunks.join('');
            chunkedMessages.delete(msgId);
          } else {
            return;
          }
        } else {
          messageBuffer = event.data;
        }

        const receivedMessage = JSON.parse(messageBuffer) as Message;
        messageBuffer = '';
        
        let decryptedText;
        try {
          decryptedText = this.decryptMessageFn 
            ? await this.decryptMessageFn(receivedMessage.text, receivedMessage.userId)
            : receivedMessage.text;
        } catch (decryptError) {
          console.error('Decryption failed:', decryptError);
          this.onP2PMessage({
            ...receivedMessage,
            text: '[Decryption Failed]'
          });
          return;
        }
        
        this.onP2PMessage({ ...receivedMessage, text: decryptedText, isP2P: true });
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          console.error('Message processing failed:', error);
          messageBuffer = '';
        }
      }
    };

    this.dataChannel.onbufferedamountlow = () => {
      console.log('Buffer cleared');
    };

    this.dataChannel.onclose = () => this.onP2PStatusChange(false);
    this.dataChannel.onerror = (error) => console.error('DataChannel error:', error);
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
        isP2P: true
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
        isP2P: true
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
        isP2P: true
      };
      this.handleP2PCandidate(message);
    });

    this.socket.on('p2p-reject', (data: { source: string }) => {
      if (data.source === this.contactId) this.disconnectP2P();
    });

    this.socket.on('p2p-restart-ice', (data: { source: string }) => {
      if (data.source === this.contactId && this.peerConnection) this.restartIce();
    });
  }

  private setIceConnectionTimeout() {
    if (this.iceConnectionTimeout) clearTimeout(this.iceConnectionTimeout);
    
    const networkType = 'connection' in navigator && navigator.connection?.type || 'unknown';
    const timeoutMs = networkType === 'cellular' ? 20000 : 15000;
    
    this.iceConnectionTimeout = setTimeout(() => {
      if (this.peerConnection && ['checking', 'new'].includes(this.peerConnection.iceConnectionState)) {
        console.log(`ICE timeout after ${timeoutMs/1000}s`);
        this.tryReconnect();
      }
    }, timeoutMs);
  }

  private async tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.contactId) {
      this.disconnectP2P();
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));
    this.reconnectAttempts++;

    try {
      if (this.peerConnection) {
        await this.restartIce();
      } else {
        await this.initiateP2P(this.contactId);
      }
    } catch (error) {
      console.error('Reconnect failed:', error);
      this.tryReconnect();
    }
  }

  private async restartIce() {
    if (!this.peerConnection || !this.contactId) return;
    
    try {
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
      console.error('Failed to restart ICE:', error);
    }
  }

  private monitorNetwork() {
    if ('connection' in navigator && navigator.connection) {
      const connection = navigator.connection;
      connection.onchange = () => {
        console.log('Network changed:', {
          type: connection.type,
          effectiveType: connection.effectiveType,
          downlink: connection.downlink
        });
        if (connection.effectiveType === '2g' || (connection.downlink && connection.downlink < 1)) {
          this.requestIceRestart();
        }
      };
    }
  }

  private async monitorConnectionStats() {
    setInterval(async () => {
      if (!this.peerConnection) return;
      
      try {
        const stats = await this.peerConnection.getStats();
        stats.forEach(report => {
          if (report.type === 'transport') {
            console.log('Transport stats:', {
              bytesSent: report.bytesSent,
              bytesReceived: report.bytesReceived,
              packetsLost: report.packetsLost
            });
            if (report.packetsLost > 10) this.requestIceRestart();
          }
        });
      } catch (error) {
        console.error('Failed to get stats:', error);
      }
    }, 5000);
  }

  async testIceServers() {
    const servers = this.peerConnection?.getConfiguration().iceServers;
    if (!servers) return;

    for (const server of servers) {
      try {
        const pc = new RTCPeerConnection({ iceServers: [server] });
        const result = await new Promise((resolve) => {
          pc.onicecandidate = (e) => e.candidate && resolve(true);
          setTimeout(() => resolve(false), 2000);
          pc.createOffer().then(offer => pc.setLocalDescription(offer));
        });
        console.log(`ICE server ${server.urls} is ${result ? 'reachable' : 'unreachable'}`);
        pc.close();
      } catch (e) {
        console.error(`ICE server ${server.urls} test failed:`, e);
      }
    }
  }

  isP2PActive(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  requestIceRestart() {
    if (this.contactId && this.peerConnection) {
      this.restartIce();
      this.socket.emit('p2p-restart-ice', { target: this.contactId, source: this.userId });
    }
  }

  forceTurnRelay() {
    if (this.peerConnection) this.disconnectP2P();
    
    if (this.contactId) {
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          {
            urls: [
              'turn:numb.viagenie.ca:3478?transport=udp',
              'turn:numb.viagenie.ca:3478?transport=tcp'
            ],
            username: 'webrtc@live.com',
            credential: 'muazkh'
          }
        ],
        iceTransportPolicy: 'relay'
      });
      this.initiateP2P(this.contactId);
    }
  }

  getDiagnostics() {
    return {
      iceState: this.peerConnection?.iceConnectionState,
      signalingState: this.peerConnection?.signalingState,
      dataChannelState: this.dataChannel?.readyState,
      bufferedAmount: this.dataChannel?.bufferedAmount,
      reconnectAttempts: this.reconnectAttempts,
      pendingCandidates: this.pendingCandidates.length
    };
  }
}

export default P2PService;