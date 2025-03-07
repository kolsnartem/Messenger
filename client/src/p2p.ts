import { Message, TweetNaClKeyPair } from './types';
import webSocketService from './services/websocket';

export class P2PService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private userId: string;
  private contactId: string | null = null;
  private contactPublicKey: string | null = null;
  private onP2PMessage: (message: Message) => void;
  private onP2PStatusChange: (isActive: boolean) => void;
  private tweetNaclKeyPair: TweetNaClKeyPair | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private encryptMessageFn: ((text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair) => string) | null = null;
  private decryptMessageFn: ((encryptedText: string, senderId: string) => Promise<string>) | null = null;

  constructor(
    userId: string,
    onP2PMessage: (message: Message) => void,
    onP2PStatusChange: (isActive: boolean) => void
  ) {
    this.userId = userId;
    this.onP2PMessage = onP2PMessage;
    this.onP2PStatusChange = onP2PStatusChange;
  }

  setTweetNaclKeyPair(keyPair: TweetNaClKeyPair | null) {
    this.tweetNaclKeyPair = keyPair;
  }

  setEncryptionFunctions(
    encryptFn: (text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair) => string,
    decryptFn: (encryptedText: string, senderId: string) => Promise<string>
  ) {
    this.encryptMessageFn = encryptFn;
    this.decryptMessageFn = decryptFn;
  }

  setContactPublicKey(publicKey: string) {
    this.contactPublicKey = publicKey;
    console.log('Contact public key set for P2P encryption:', publicKey);
  }

  async initiateP2P(contactId: string) {
    this.contactId = contactId;
    await this.setupPeerConnection(true);
    
    const offer = await this.peerConnection!.createOffer();
    await this.peerConnection!.setLocalDescription(offer);
    
    await webSocketService.send({
      id: `p2p-request-${Date.now()}`,
      userId: this.userId,
      contactId,
      text: JSON.stringify({ type: 'offer', sdp: offer }),
      timestamp: Date.now(),
      isRead: 0,
      isP2P: true,
    });
  }

  async handleP2PRequest(message: Message, accept: boolean) {
    if (!accept || !message.userId || !message.text) return;
    this.contactId = message.userId;

    let offerData;
    try {
      offerData = JSON.parse(message.text);
    } catch (error) {
      console.error('Failed to parse P2P request:', error);
      return;
    }

    if (offerData.type !== 'offer') return;

    await this.setupPeerConnection(false);
    await this.peerConnection!.setRemoteDescription(offerData.sdp);
    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);

    await webSocketService.send({
      id: `p2p-answer-${Date.now()}`,
      userId: this.userId,
      contactId: this.contactId,
      text: JSON.stringify({ type: 'answer', sdp: answer }),
      timestamp: Date.now(),
      isRead: 0,
      isP2P: true,
    });

    this.pendingCandidates.forEach(candidate => {
      this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
    });
    this.pendingCandidates = [];
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

    if (answerData.type !== 'answer') return;

    await this.peerConnection.setRemoteDescription(answerData.sdp);

    this.pendingCandidates.forEach(candidate => {
      this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
    });
    this.pendingCandidates = [];
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

    if (!candidateData.candidate) return;

    const candidate = new RTCIceCandidate(candidateData);
    if (this.peerConnection.remoteDescription) {
      await this.peerConnection.addIceCandidate(candidate);
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  async sendP2PMessage(message: Message) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open' || !this.tweetNaclKeyPair || !this.contactId || !this.contactPublicKey || !this.encryptMessageFn) {
      throw new Error('P2P connection or encryption setup not ready');
    }

    const encryptedText = this.encryptMessageFn(message.text, this.contactPublicKey, this.tweetNaclKeyPair);
    const encryptedMessage: Message = {
      ...message,
      text: encryptedText,
      isP2P: true,
    };
    
    this.dataChannel.send(JSON.stringify(encryptedMessage));
    this.onP2PMessage({ ...encryptedMessage, text: message.text }); // Локально показуємо оригінальний текст
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
  }

  private async setupPeerConnection(isInitiator: boolean) {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle'
    });

    if (isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel('chat', {
        negotiated: false,
        ordered: true
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
        webSocketService.send({
          id: `p2p-candidate-${Date.now()}`,
          userId: this.userId,
          contactId: this.contactId!,
          text: JSON.stringify(event.candidate),
          timestamp: Date.now(),
          isRead: 0,
          isP2P: true,
        });
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      console.log('ICE Connection State:', this.peerConnection.iceConnectionState);
      switch (this.peerConnection.iceConnectionState) {
        case 'connected':
        case 'completed':
          this.onP2PStatusChange(true);
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
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
      console.log('P2P DataChannel opened');
      this.onP2PStatusChange(true);
    };

    this.dataChannel.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data) as Message;
        message.isP2P = true;
        if (this.decryptMessageFn) {
          const decryptedText = await this.decryptMessageFn(message.text, message.userId);
          this.onP2PMessage({ ...message, text: decryptedText });
        } else {
          this.onP2PMessage(message);
        }
      } catch (error) {
        console.error('Failed to parse or decrypt P2P message:', error);
        this.onP2PMessage({ ...message, text: '[Decryption Failed]', encryptedText: message.text });
      }
    };

    this.dataChannel.onclose = () => {
      console.log('P2P DataChannel closed');
      this.disconnectP2P();
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };
  }

  isP2PActive(): boolean {
    return this.dataChannel?.readyState === 'open';
  }
}

export default P2PService;