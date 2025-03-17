import React, { useRef, useEffect } from 'react';
import { CallState } from '../services/VideoCallService';

interface AudioSpectrogramProps {
  audioStream: MediaStream | null;
  style?: React.CSSProperties;
}

const AudioSpectrogram: React.FC<AudioSpectrogramProps> = ({ audioStream, style }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!audioStream || !canvasRef.current) return;
    const AudioContext = window.AudioContext;
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(audioStream);
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / analyser.frequencyBinCount) * 2.5;
      let x = 0;
      for (let i = 0; i < analyser.frequencyBinCount; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, 'rgba(100, 140, 255, 1)');
        gradient.addColorStop(0.5, 'rgba(120, 70, 255, 0.8)');
        gradient.addColorStop(1, 'rgba(180, 100, 255, 0.6)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
    return () => {
      source.disconnect();
      audioContext.close();
    };
  }, [audioStream]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', ...style }} width={300} height={150} />;
};

const formatCallDuration = (durationInSeconds: number = 0): string => {
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = durationInSeconds % 60;
  return `${hours > 0 ? `${hours.toString().padStart(2, '0')}:` : ''}${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

interface VideoCallWindowProps {
  callState: CallState;
  onToggleVideo: () => void;
  onToggleMicrophone: () => void;
  onEndCall: () => void;
}

const VideoCallWindow: React.FC<VideoCallWindowProps> = ({
  callState,
  onToggleVideo,
  onToggleMicrophone,
  onEndCall,
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && callState.localStream) {
      localVideoRef.current.srcObject = callState.localStream;
    }
    if (remoteVideoRef.current && callState.remoteStream) {
      remoteVideoRef.current.srcObject = callState.remoteStream;
    }
  }, [callState.localStream, callState.remoteStream]);

  if (!callState.isCalling) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(180deg, rgba(18, 18, 38, 0.98) 0%, rgba(9, 9, 19, 0.98) 100%)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          fontSize: '18px',
          fontWeight: '500',
          color: 'white',
          padding: '12px 0',
          width: '100%',
          textAlign: 'center',
          zIndex: 2,
        }}
      >
        {formatCallDuration(callState.callDuration)}
      </div>
      <div
        style={{
          width: '100%',
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '12px',
        }}
      >
        {callState.isVideoEnabled && callState.remoteStream ? (
          <video
            ref={remoteVideoRef}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px' }}
            autoPlay
            playsInline
          />
        ) : (
          <div
            className="audio-spectrogram"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: '12px',
              background: 'rgba(30, 30, 60, 0.5)',
              overflow: 'hidden',
            }}
          >
            <AudioSpectrogram audioStream={callState.remoteStream} style={{ width: '100%', height: '70%' }} />
          </div>
        )}
        {callState.isVideoEnabled && callState.localStream && (
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              right: '16px',
              width: '100px',
              height: '150px',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
              zIndex: 3,
              border: '2px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <video
              ref={localVideoRef}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              autoPlay
              playsInline
              muted
            />
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '24px',
          padding: '16px 0',
          width: '100%',
          zIndex: 2,
        }}
      >
        <button
          onClick={onToggleMicrophone}
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: callState.isMicrophoneEnabled ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 80, 80, 0.7)',
            border: 'none',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: 'white',
            fontSize: '24px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <i className={`fas fa-${callState.isMicrophoneEnabled ? 'microphone' : 'microphone-slash'}`}></i>
        </button>
        <button
          onClick={onEndCall}
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(255, 50, 50, 0.9)',
            border: 'none',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: 'white',
            fontSize: '24px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <i className="fas fa-phone-slash"></i>
        </button>
        <button
          onClick={onToggleVideo}
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: callState.isVideoEnabled ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            color: 'white',
            fontSize: '24px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <i className={`fas fa-${callState.isVideoEnabled ? 'video' : 'video-slash'}`}></i>
        </button>
      </div>
    </div>
  );
};

export default VideoCallWindow;