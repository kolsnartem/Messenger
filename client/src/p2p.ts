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
    this.setupPeerConnection(true);

    try {
      const offer = await this.peerConnection!.createOffer();
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
    try {
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offerData));
      console.log('Set remote description (offer), signaling state:', this.peerConnection!.signalingState);
      const answer = await this.peerConnection!.createAnswer();
      console.log('Created answer:', answer.sdp);
      await this.peerConnection!.setLocalDescription(answer);
      console.log('Set local description (answer), signaling state:', this.peerConnection!.signalingState);

      this.socket.emit('p2p-answer', { target: this.contactId, source: this.userId, answer });
      console.log('P2P answer sent:', answer.sdp);

      for (const candidate of this.pendingCandidates) {
        await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added pending ICE candidate:', candidate);
      }
      this.pendingCandidates = [];
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

      for (const candidate of this.pendingCandidates) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added pending ICE candidate:', candidate);
      }
      this.pendingCandidates = [];
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

      console.log('Sending P2P message via DataChannel:', p2pMessage);
      this.dataChannel.send(JSON.stringify(p2pMessage));
      console.log('P2P message sent successfully');
      this.onP2PMessage({ ...p2pMessage, text: message.text });
    } catch (error) {
      console.error('Failed to send P2P message:', (error as Error).message);
      throw error;
    }
  }

  disconnectP2P() {
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

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    if (isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('chat', {
        ordered: true,
        maxRetransmits: 3,
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
        console.log('ICE candidate sent:', event.candidate);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      console.log('ICE Connection State:', this.peerConnection.iceConnectionState);
      switch (this.peerConnection.iceConnectionState) {
        case 'connected':
        case 'completed':
          this.onP2PStatusChange(true);
          console.log('P2P connection established');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.onP2PStatusChange(false);
          console.log('P2P connection failed or closed');
          this.disconnectP2P();
          break;
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection State:', this.peerConnection?.connectionState);
    };
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('P2P DataChannel opened, readyState:', this.dataChannel?.readyState);
      this.onP2PStatusChange(true);
    };

    this.dataChannel.onmessage = async (event) => {
      if (!event.data) {
        console.error('Received empty P2P message');
        return;
      }

      let receivedMessage: Message;
      try {
        receivedMessage = JSON.parse(event.data) as Message;
        if (!receivedMessage.id || !receivedMessage.userId || !receivedMessage.text) {
          throw new Error('Invalid message format');
        }
        receivedMessage.isP2P = true;
        console.log('Received P2P message:', receivedMessage);
        if (this.decryptMessageFn) {
          const decryptedText = await this.decryptMessageFn(receivedMessage.text, receivedMessage.userId);
          this.onP2PMessage({ ...receivedMessage, text: decryptedText });
        } else {
          this.onP2PMessage(receivedMessage);
        }
      } catch (error) {
        console.error('Failed to parse or decrypt P2P message:', (error as Error).message);
      }
    };

    this.dataChannel.onclose = () => {
      console.log('P2P DataChannel closed');
      this.onP2PStatusChange(false);
      this.disconnectP2P();
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', (error as Error).message);
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

  isP2PActive(): boolean {
    return this.dataChannel?.readyState === 'open';
  }
}

export default P2PService;