import { Socket } from 'socket.io-client';

export interface CallState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCalling: boolean;
  isVideoEnabled: boolean;
  isMicrophoneEnabled: boolean;
  callDuration?: number;
  reactions?: { emoji: string; timestamp: number }[];
}

export default class VideoCallService {
  private socket: Socket;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private userId: string;
  private targetUserId: string | null = null;
  private onStateChange: (state: CallState) => void;

  private iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  constructor(
    socket: Socket,
    userId: string,
    onStateChange: (state: CallState) => void
  ) {
    this.socket = socket;
    this.userId = userId;
    this.onStateChange = onStateChange;
    this.setupSocketListeners();
  }

  private updateState() {
    this.onStateChange({
      localStream: this.localStream,
      remoteStream: this.remoteStream,
      isCalling: !!this.peerConnection,
      // Перевірка на null для localStream
      isVideoEnabled: this.localStream ? this.localStream.getVideoTracks().length > 0 : false,
      isMicrophoneEnabled: this.localStream ? this.localStream.getAudioTracks().length > 0 : false,
    });
  }

  private setupSocketListeners() {
    this.socket.on('call-offer', async (data: { offer: RTCSessionDescriptionInit; source: string }) => {
      if (this.peerConnection) return;
      this.targetUserId = data.source;
      await this.handleIncomingCall(data.offer);
    });

    this.socket.on('call-answer', async (data: { answer: RTCSessionDescriptionInit }) => {
      if (!this.peerConnection) return;
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      this.updateState();
    });

    this.socket.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
      if (!this.peerConnection) return;
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    });

    this.socket.on('call-ended', () => {
      this.endCall(false);
    });
  }

  private async createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.iceServers);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => this.peerConnection!.addTrack(track, this.localStream!));
    }

    this.peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.updateState();
      }
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.targetUserId) {
        this.socket.emit('ice-candidate', {
          target: this.targetUserId,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection?.iceConnectionState === 'disconnected' ||
          this.peerConnection?.iceConnectionState === 'failed') {
        this.endCall(false);
      }
    };
  }

  public async initiateCall(targetUserId: string, videoEnabled: boolean) {
    this.targetUserId = targetUserId;
    await this.initializeMedia({ audio: true, video: videoEnabled });
    await this.createPeerConnection();

    const offer = await this.peerConnection!.createOffer();
    await this.peerConnection!.setLocalDescription(offer);
    this.socket.emit('call-offer', { target: targetUserId, source: this.userId, offer });
    this.updateState();
  }

  private async handleIncomingCall(offer: RTCSessionDescriptionInit) {
    await this.initializeMedia({ audio: true, video: false });
    await this.createPeerConnection();
    await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);
    this.socket.emit('call-answer', { target: this.targetUserId!, answer });
    this.updateState();
  }

  public async toggleVideo(enable: boolean) {
    if (!this.localStream || !this.peerConnection) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (enable && !videoTrack) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const newVideoTrack = videoStream.getVideoTracks()[0];
      this.localStream.addTrack(newVideoTrack);
      const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      } else {
        this.peerConnection.addTrack(newVideoTrack, this.localStream);
      }
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('call-offer', { target: this.targetUserId!, source: this.userId, offer });
    } else if (!enable && videoTrack) {
      this.localStream.removeTrack(videoTrack);
      videoTrack.stop();
      const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) this.peerConnection.removeTrack(sender);
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('call-offer', { target: this.targetUserId!, source: this.userId, offer });
    }
    this.updateState();
  }

  public async toggleMicrophone(enable: boolean) {
    if (!this.localStream || !this.peerConnection) return;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (enable && !audioTrack) {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const newAudioTrack = audioStream.getAudioTracks()[0];
      this.localStream.addTrack(newAudioTrack);
      const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) {
        await sender.replaceTrack(newAudioTrack);
      } else {
        this.peerConnection.addTrack(newAudioTrack, this.localStream);
      }
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('call-offer', { target: this.targetUserId!, source: this.userId, offer });
    } else if (!enable && audioTrack) {
      this.localStream.removeTrack(audioTrack);
      audioTrack.stop();
      const sender = this.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) this.peerConnection.removeTrack(sender);
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('call-offer', { target: this.targetUserId!, source: this.userId, offer });
    }
    this.updateState();
  }

  private async initializeMedia(constraints: MediaStreamConstraints) {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.updateState();
  }

  public endCall(sendSignal: boolean) {
    if (sendSignal && this.targetUserId) {
      this.socket.emit('call-ended', { target: this.targetUserId, source: this.userId });
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
    this.targetUserId = null;
    this.updateState();
  }

  public getState(): CallState {
    return {
      localStream: this.localStream,
      remoteStream: this.remoteStream,
      isCalling: !!this.peerConnection,
      // Перевірка на null для localStream
      isVideoEnabled: this.localStream ? this.localStream.getVideoTracks().length > 0 : false,
      isMicrophoneEnabled: this.localStream ? this.localStream.getAudioTracks().length > 0 : false,
    };
  }
}