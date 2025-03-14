import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Contact, Message, TweetNaClKeyPair } from './types';
import ChatList from './components/ChatList';
import { fetchChats, fetchMessages, markAsRead } from './services/api';
import { useAuth } from './hooks/useAuth';
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';
import * as nacl from 'tweetnacl';
import { FaSearch, FaSun, FaMoon, FaSignOutAlt, FaSync, FaArrowLeft, FaLock, FaPhone, FaVideo, FaCheck, FaTimes, FaRedo } from 'react-icons/fa';
import P2PService from './services/p2p';
import VideoCallService, { CallState } from './services/VideoCallService';
import io, { Socket } from 'socket.io-client';

interface ApiErrorResponse {
  error?: string;
}

const logEncryptionEvent = (event: string, details?: any) => console.log(`[Encryption] ${event}`, details || '');
const cleanBase64 = (base64Str: string): string => base64Str.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
const fixPublicKey = (key: Uint8Array): Uint8Array => {
  if (key.length === 33 && (key[0] === 0x00 || key[0] === 0x01)) return key.slice(1);
  if (key.length !== 32) throw new Error(`Invalid public key length: ${key.length}`);
  return key;
};

const initializeTweetNaclKeys = (): TweetNaClKeyPair => {
  const stored = localStorage.getItem('tweetnaclKeyPair');
  if (stored) {
    try {
      const { publicKey, secretKey } = JSON.parse(stored);
      return { publicKey: new Uint8Array(publicKey), secretKey: new Uint8Array(secretKey) };
    } catch {
      logEncryptionEvent('Failed to load stored keys, generating new');
    }
  }
  const newKeyPair = nacl.box.keyPair();
  localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
    publicKey: Array.from(newKeyPair.publicKey),
    secretKey: Array.from(newKeyPair.secretKey),
  }));
  return newKeyPair;
};

const encryptMessage = (text: string, contactPublicKey: string, keyPair: TweetNaClKeyPair): string => {
  const theirPublicKey = fixPublicKey(new Uint8Array(Buffer.from(cleanBase64(contactPublicKey), 'base64')));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(new TextEncoder().encode(text), nonce, theirPublicKey, keyPair.secretKey);
  if (!encrypted) throw new Error('Encryption failed');
  return `base64:${Buffer.from([...nonce, ...encrypted]).toString('base64')}`;
};

const storeSentMessage = (messageId: string, text: string, chatId: string) => {
  const stored = JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}');
  localStorage.setItem(`sentMessages_${chatId}`, JSON.stringify({ ...stored, [messageId]: text }));
};

const getSentMessage = (messageId: string, chatId: string): string | null => {
  return JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}')[messageId] || null;
};

const AudioSpectrogram: React.FC<{ audioStream: MediaStream | null; style?: React.CSSProperties }> = ({ audioStream, style }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!audioStream || !canvasRef.current) return;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
    return () => { source.disconnect(); audioContext.close(); };
  }, [audioStream]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', ...style }} width={300} height={150} />;
};

const formatCallDuration = (durationInSeconds: number = 0): string => {
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = durationInSeconds % 60;
  return `${hours > 0 ? `${hours.toString().padStart(2, '0')}:` : ''}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const publicKeysCache = new Map<string, string>();

const App: React.FC = () => {
  const { userId, setUserId, setIdentityKeyPair } = useAuth();
  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem('userEmail'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(localStorage.getItem('selectedChatId'));
  const [input, setInput] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [tweetNaclKeyPair, setTweetNaclKeyPair] = useState<TweetNaClKeyPair | null>(null);
  const [isKeysLoaded, setIsKeysLoaded] = useState(false);
  const [isP2PActive, setIsP2PActive] = useState(false);
  const [p2pRequest, setP2PRequest] = useState<Message | null>(null);
  const [callState, setCallState] = useState<CallState & { callDuration?: number; reactions?: { emoji: string; timestamp: number }[] }>({
    localStream: null,
    remoteStream: null,
    isCalling: false,
    isVideoEnabled: false,
    isMicrophoneEnabled: true,
    callDuration: 0,
    reactions: [],
  });
  const chatRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const isInitialMount = useRef(true);
  const p2pServiceRef = useRef<P2PService | null>(null);
  const videoCallServiceRef = useRef<VideoCallService | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (localVideoRef.current && callState.localStream) localVideoRef.current.srcObject = callState.localStream;
    if (remoteVideoRef.current && callState.remoteStream) remoteVideoRef.current.srcObject = callState.remoteStream;
  }, [callState.localStream, callState.remoteStream]);

  useEffect(() => {
    if (!userId) return;
    socketRef.current = io('https://100.64.221.88:4000', { 
      query: { userId }, 
      transports: ['websocket'], 
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    videoCallServiceRef.current = new VideoCallService(socketRef.current, userId, (state: CallState) => {
      setCallState(prev => ({
        ...prev,
        ...state,
        callDuration: prev.callDuration || 0,
        reactions: prev.reactions || [],
      }));
    });
    return () => {
      socketRef.current?.disconnect();
      videoCallServiceRef.current?.endCall(false);
    };
  }, [userId]);

  useEffect(() => {
    if (userId && !p2pServiceRef.current && socketRef.current) {
      p2pServiceRef.current = new P2PService(userId, socketRef.current, handleP2PMessage, setIsP2PActive);
    }
    return () => {
      p2pServiceRef.current?.disconnectP2P();
    };
  }, [userId]);

  useEffect(() => {
    if (p2pServiceRef.current && tweetNaclKeyPair) {
      p2pServiceRef.current.setTweetNaclKeyPair(tweetNaclKeyPair);
      p2pServiceRef.current.setEncryptionFunctions(encryptMessage, decryptMessage);
    }
  }, [tweetNaclKeyPair]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callState.isCalling) {
      interval = setInterval(() => setCallState(prev => ({ ...prev, callDuration: (prev.callDuration || 0) + 1 })), 1000);
    }
    return () => clearInterval(interval);
  }, [callState.isCalling]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes float-up {
        0% { transform: translateY(0); opacity: 1; }
        80% { opacity: 0.8; }
        100% { transform: translateY(-120px); opacity: 0; }
      }
      .reaction-emoji { animation: float-up 2s ease-out forwards; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const fetchSenderPublicKey = async (senderId: string): Promise<string> => {
    if (publicKeysCache.has(senderId)) return publicKeysCache.get(senderId)!;
    let key = cleanBase64(contacts.find(c => c.id === senderId)?.publicKey || localStorage.getItem(`publicKey_${senderId}`) || '');
    if (!key && socketRef.current?.connected) {
      const res = await axios.get<Contact>(`https://100.64.221.88:4000/users?id=${senderId}`);
      key = cleanBase64(res.data.publicKey || '');
      publicKeysCache.set(senderId, key);
      localStorage.setItem(`publicKey_${senderId}`, key);
      setContacts(prev => prev.some(c => c.id === senderId) ? prev : [...prev, { id: senderId, email: res.data.email || '', publicKey: key, lastMessage: null }]);
    }
    return key || '';
  };

  const decryptMessage = async (encryptedText: string, senderId: string): Promise<string> => {
    if (!encryptedText.startsWith('base64:') || !tweetNaclKeyPair) return encryptedText;
    const data = Buffer.from(encryptedText.slice(7), 'base64');
    const nonce = data.subarray(0, nacl.box.nonceLength);
    const cipher = data.subarray(nacl.box.nonceLength);
    const senderPublicKey = await fetchSenderPublicKey(senderId);
    if (!senderPublicKey) return encryptedText; // Змінено для P2P
    const theirPublicKey = fixPublicKey(new Uint8Array(Buffer.from(senderPublicKey, 'base64')));
    const decrypted = nacl.box.open(new Uint8Array(cipher), new Uint8Array(nonce), theirPublicKey, tweetNaclKeyPair.secretKey);
    return decrypted ? new TextDecoder().decode(decrypted) : encryptedText;
  };

  const decryptMessageText = async (message: Message): Promise<string> => {
    if (message.userId === userId) return getSentMessage(message.id, message.contactId || selectedChatId || '') || message.text;
    return message.text.startsWith('base64:') ? await decryptMessage(message.text, message.userId) : message.text;
  };

  const retryDecryption = async (message: Message) => {
    const decryptedText = await decryptMessageText(message);
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, text: decryptedText } : m));
  };

  const updateContactsWithLastMessage = useCallback(async (newMessage: Message) => {
    const decryptedText = await decryptMessageText(newMessage);
    setContacts(prev => {
      const contactId = newMessage.userId === userId ? newMessage.contactId : newMessage.userId;
      const updatedMessage = { ...newMessage, text: decryptedText, isMine: newMessage.userId === userId };
      return prev.some(c => c.id === contactId)
        ? prev.map(c => c.id === contactId ? { ...c, lastMessage: updatedMessage } : c)
        : [...prev, { id: contactId, email: '', publicKey: '', lastMessage: updatedMessage }];
    });
  }, [userId]);

  const handleIncomingMessage = async (message: Message) => {
    if (!message.isP2P) {
      const decryptedText = await decryptMessageText(message);
      const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
      setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp));
      await updateContactsWithLastMessage(updatedMessage);
      return;
    }

    try {
      const signalData = JSON.parse(message.text);
      if (signalData.type === 'offer' && message.contactId === userId && !isP2PActive) {
        setP2PRequest(message);
      } else if (signalData.type === 'answer') {
        await p2pServiceRef.current?.handleP2PAnswer({ ...message, lastMessage: undefined });
      } else if (signalData.candidate) {
        await p2pServiceRef.current?.handleP2PCandidate({ ...message, lastMessage: undefined });
      }
    } catch (error) {
      console.error('Failed to parse P2P signaling message:', error);
      if (message.text.startsWith('base64:')) {
        const decryptedText = await decryptMessageText(message);
        const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
        setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp));
        await updateContactsWithLastMessage(updatedMessage);
      }
    }
  };

  const handleP2PMessage = async (message: Message) => {
    const decryptedText = await decryptMessageText(message);
    const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
    setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp));
    await updateContactsWithLastMessage(updatedMessage);
  };

  const sendMessage = async () => {
    if (!input.trim() || !userId || !selectedChatId || !tweetNaclKeyPair) return;
    const contact = contacts.find(c => c.id === selectedChatId) || (socketRef.current?.connected ? (await axios.get<Contact>(`https://100.64.221.88:4000/users?id=${selectedChatId}`)).data : { id: selectedChatId, publicKey: '' });
    const message: Message = { 
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, 
      userId: userId!, 
      contactId: selectedChatId, 
      text: input.trim(), 
      timestamp: Date.now(), 
      isRead: 0, 
      isMine: true, 
      isP2P: isP2PActive 
    };

    try {
      if (isP2PActive && p2pServiceRef.current?.isP2PActive()) {
        storeSentMessage(message.id, message.text, selectedChatId);
        await p2pServiceRef.current.sendP2PMessage({ ...message, lastMessage: undefined });
        setMessages(prev => [...prev, { ...message, text: input.trim() }].sort((a, b) => a.timestamp - b.timestamp));
        await updateContactsWithLastMessage(message);
      } else {
        message.text = encryptMessage(message.text, contact.publicKey || '', tweetNaclKeyPair);
        storeSentMessage(message.id, input.trim(), selectedChatId);
        socketRef.current?.emit('message', message);
        setMessages(prev => [...prev, { ...message, text: input.trim() }].sort((a, b) => a.timestamp - b.timestamp));
        await updateContactsWithLastMessage(message);
      }
      setInput('');
    } catch (error) {
      console.error('Failed to send message:', error);
      if (isP2PActive) {
        p2pServiceRef.current?.requestIceRestart();
      }
    }
  };

  const initiateCall = (videoEnabled: boolean) => videoCallServiceRef.current?.initiateCall(selectedChatId!, videoEnabled);
  const endCall = () => videoCallServiceRef.current?.endCall(true);
  const toggleVideo = () => videoCallServiceRef.current?.toggleVideo(!callState.isVideoEnabled);
  const toggleMicrophone = () => videoCallServiceRef.current?.toggleMicrophone(!callState.isMicrophoneEnabled);

  const initializeKeys = async () => {
    const keyPair = initializeTweetNaclKeys();
    setTweetNaclKeyPair(keyPair);
    setIsKeysLoaded(true);
  };

  const fetchData = async () => {
    if (!userId || !socketRef.current?.connected) return;
    const chats = (await fetchChats(userId)).data.sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
    setContacts(await Promise.all(chats.map(async chat => ({ ...chat, lastMessage: chat.lastMessage ? { ...chat.lastMessage, text: await decryptMessageText(chat.lastMessage) } : null }))));
    if (selectedChatId) {
      const fetchedMessages = (await fetchMessages(userId, selectedChatId)).data;
      setMessages(await Promise.all(fetchedMessages.map(async msg => ({ ...msg, isMine: msg.userId === userId, text: await decryptMessageText(msg) }))));
      await markAsRead(userId, selectedChatId);
    }
  };

  useEffect(() => {
    if (!userId) return;
    if (!tweetNaclKeyPair) initializeKeys().then(fetchData);
    else if (isKeysLoaded) {
      fetchData();
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [userId, selectedChatId, tweetNaclKeyPair, isKeysLoaded]);

  useEffect(() => {
    if (!userId || !tweetNaclKeyPair || !socketRef.current) return;
    socketRef.current.on('message', handleIncomingMessage);
    socketRef.current.on('p2p-offer-notify', (data: { message: Message }) => data.message.contactId === userId && !isP2PActive && setP2PRequest(data.message));
    return () => { 
      socketRef.current?.off('message'); 
      socketRef.current?.off('p2p-offer-notify'); 
    };
  }, [userId, selectedChatId, tweetNaclKeyPair, isP2PActive]);

  useEffect(() => {
    if (!searchQuery || !userId) setSearchResults([]);
    else if (socketRef.current?.connected) {
      axios.get<Contact[]>(`https://100.64.221.88:4000/search?query=${searchQuery}`).then(res => setSearchResults(res.data.filter(c => c.id !== userId)));
    }
  }, [searchQuery, userId]);

  useEffect(() => {
    selectedChatId ? localStorage.setItem('selectedChatId', selectedChatId) : localStorage.removeItem('selectedChatId');
    messagesEndRef.current?.scrollIntoView({ behavior: isInitialMount.current ? 'auto' : 'smooth' });
    isInitialMount.current = false;
  }, [selectedChatId, messages]);

  const handleAuth = async (isLogin: boolean) => {
    if (!email || !password) return alert('Fill in all fields');
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
    const endpoint = isLogin ? '/login' : '/register';
    try {
      const res = await axios.post<{ id: string; publicKey?: string }>(`https://100.64.221.88:4000${endpoint}`, { email, password: hashedPassword });
      if (!isLogin) {
        const newKeyPair = nacl.box.keyPair();
        await axios.put('https://100.64.221.88:4000/update-keys', { userId: res.data.id, publicKey: Buffer.from(newKeyPair.publicKey).toString('base64') });
        setTweetNaclKeyPair(newKeyPair);
        localStorage.setItem('tweetnaclKeyPair', JSON.stringify({ publicKey: Array.from(newKeyPair.publicKey), secretKey: Array.from(newKeyPair.secretKey) }));
      }
      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userEmail', email);
      setUserId(res.data.id);
      setUserEmail(email);
    } catch (err) {
      alert(`Error: ${(err as AxiosError<ApiErrorResponse>).response?.data?.error || 'Unknown error'}`);
    }
  };

  const handleContactSelect = (contact: Contact) => {
    setSelectedChatId(contact.id);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setContacts(prev => prev.some(c => c.id === contact.id) ? prev : [...prev, { ...contact, lastMessage: null }]);
  };

  const handleLogout = () => {
    localStorage.clear();
    setUserId(null);
    setUserEmail(null);
    setIdentityKeyPair(null);
    setSelectedChatId(null);
    setMessages([]);
    setContacts([]);
    setTweetNaclKeyPair(null);
    setIsKeysLoaded(false);
    p2pServiceRef.current?.disconnectP2P();
    videoCallServiceRef.current?.endCall(false);
    socketRef.current?.disconnect();
  };

  const initiateP2P = async () => {
    const contact = contacts.find(c => c.id === selectedChatId);
    if (!selectedChatId || !p2pServiceRef.current || !contact?.publicKey) {
      console.error('Cannot initiate P2P: missing required data');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      p2pServiceRef.current.setContactPublicKey(contact.publicKey);
      await p2pServiceRef.current.initiateP2P(selectedChatId);
      setIsP2PActive(true);
    } catch (error) {
      console.error('Failed to initiate P2P:', error);
      setIsP2PActive(false);
      alert('Не вдалося отримати доступ до медіа для P2P з\'єднання');
    }
  };

  const handleP2PResponse = async (accept: boolean) => {
    if (!p2pRequest || !p2pServiceRef.current) return;
    const contact = contacts.find(c => c.id === p2pRequest.userId);
    if (accept && contact?.publicKey) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        p2pServiceRef.current.setContactPublicKey(contact.publicKey);
        await p2pServiceRef.current.handleP2PRequest({ ...p2pRequest, lastMessage: undefined }, true);
        setIsP2PActive(true);
      } catch (error) {
        console.error('Failed to accept P2P request:', error);
        setIsP2PActive(false);
        alert('Не вдалося отримати доступ до медіа для P2P з\'єднання');
      }
    } else {
      socketRef.current?.emit('p2p-reject', { target: p2pRequest.userId, source: userId });
    }
    setP2PRequest(null);
  };

  const themeClass = isDarkTheme ? 'bg-black text-light' : 'bg-light text-dark';
  const headerBackground = isDarkTheme ? '#212529' : '#f8f9fa';

  if (!userId) {
    return (
      <div className={`container vh-100 d-flex flex-column justify-content-center ${themeClass} p-3`}>
        <h3 className="text-center mb-4">My Messenger</h3>
        <input type="email" className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
        <input type="password" className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
        <button className="btn btn-primary w-100 mb-2" onClick={() => handleAuth(true)}>Login</button>
        <button className="btn btn-secondary w-100" onClick={() => handleAuth(false)}>Register</button>
      </div>
    );
  }

  return (
    <div className={`d-flex flex-column ${themeClass}`} style={{ height: '100vh', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <style>
        {`
          @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          .message-enter { animation: slideIn 0.3s ease-out forwards; }
          .input-placeholder-dark::placeholder, .search-placeholder-dark::placeholder { color: #b0b0b0; }
          .chat-item { display: flex; align-items: center; padding: 10px; border-bottom: 1px solid ${isDarkTheme ? '#444' : '#eee'}; cursor: pointer; }
          .chat-item:hover { background: ${isDarkTheme ? '#444' : '#f8f9fa'}; }
          .avatar { width: 40px; height: 40px; border-radius: 50%; background: ${isDarkTheme ? '#6c757d' : '#e9ecef'}; color: ${isDarkTheme ? '#fff' : '#212529'}; display: flex; align-items: center; justify-content: center; margin-right: 10px; }
          .scroll-container { overflow-y: auto; scrollbar-width: thin; scrollbar-color: ${isDarkTheme ? '#6c757d #212529' : '#dee2e6 #fff'}; }
          .scroll-container::-webkit-scrollbar { width: 8px; }
          .scroll-container::-webkit-scrollbar-track { background: ${isDarkTheme ? '#212529' : '#fff'}; }
          .scroll-container::-webkit-scrollbar-thumb { background: ${isDarkTheme ? '#6c757d' : '#dee2e6'}; border-radius: 4px; }
          .scroll-container::-webkit-scrollbar-thumb:hover { background: ${isDarkTheme ? '#868e96' : '#adb5bd'}; }
          .p2p-message-mine { background-color: #ffccb3 !important; color: #333; }
          .p2p-message-theirs { background-color: #ff9966 !important; color: #333; }
          .retry-button { margin-left: 5px; cursor: pointer; }
        `}
      </style>

      <div className="p-2" style={{ position: 'fixed', top: 0, left: 0, right: 0, background: headerBackground, zIndex: 20, height: selectedChatId ? '90px' : '50px' }}>
        <div className="d-flex justify-content-between align-items-center">
          <div style={{ position: 'relative' }}>
            <h5 className="m-0" style={{ cursor: 'pointer' }} onClick={() => setIsMenuOpen(!isMenuOpen)}>MSNGR ({userEmail})</h5>
            {isMenuOpen && (
              <div style={{ position: 'fixed', top: '55px', left: '10px', background: headerBackground, border: '1px solid #ccc', borderRadius: '4px', zIndex: 1000, padding: '5px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button className="btn btn-sm btn-success mb-2" onClick={() => window.location.reload()} style={{ width: '150px', fontSize: '0.875rem' }}><FaSync /> Update</button>
                <button className="btn btn-sm btn-outline-danger" onClick={handleLogout} style={{ width: '150px', fontSize: '0.875rem' }}><FaSignOutAlt /> Logout</button>
              </div>
            )}
          </div>
          <div>
            <button className="btn btn-sm btn-outline-secondary me-2" onClick={() => setIsSearchOpen(!isSearchOpen)}><FaSearch /></button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setIsDarkTheme(!isDarkTheme)}>{isDarkTheme ? <FaMoon /> : <FaSun />}</button>
          </div>
        </div>
        {selectedChatId && (
          <div className="p-2 d-flex align-items-center mt-1 justify-content-between">
            <div className="d-flex align-items-center">
              <button className="btn btn-sm btn-outline-secondary me-2" onClick={() => setSelectedChatId(null)} style={{ border: 'none', background: 'transparent' }}><FaArrowLeft /></button>
              <div className="rounded-circle me-2 d-flex align-items-center justify-content-center" style={{ width: '25px', height: '25px', background: isDarkTheme ? '#6c757d' : '#e9ecef', color: isDarkTheme ? '#fff' : '#212529' }}>
                {(contacts.find(c => c.id === selectedChatId)?.email || '')[0]?.toUpperCase() || '?'}
              </div>
              <h6 className="m-0 me-2">{contacts.find(c => c.id === selectedChatId)?.email || 'Loading...'}</h6>
            </div>
            {!p2pRequest && (
              <div>
                <button className="btn btn-sm btn-outline-success me-2" onClick={() => initiateCall(false)} disabled={callState.isCalling}><FaPhone /></button>
                <button className="btn btn-sm btn-outline-success me-2" onClick={() => initiateCall(true)} disabled={callState.isCalling}><FaVideo /></button>
                <button className={`btn btn-sm ${isP2PActive ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => isP2PActive ? p2pServiceRef.current?.disconnectP2P() : initiateP2P()} disabled={!tweetNaclKeyPair || !selectedChatId}><FaLock /> {isP2PActive ? 'P2P' : 'P2P'}</button>
              </div>
            )}
            {p2pRequest && (
              <div className="d-flex align-items-center">
                <span className="me-2" style={{ fontSize: '0.9rem' }}>P2P request from {contacts.find(c => c.id === p2pRequest.userId)?.email || 'User'}</span>
                <button className="btn btn-sm btn-success me-2" onClick={() => handleP2PResponse(true)}><FaCheck /></button>
                <button className="btn btn-sm btn-danger" onClick={() => handleP2PResponse(false)}><FaTimes /></button>
              </div>
            )}
          </div>
        )}
      </div>

      {isSearchOpen && (
        <div style={{ position: 'fixed', top: selectedChatId ? '90px' : '50px', left: 0, right: 0, background: headerBackground, zIndex: 30, padding: '0' }}>
          <div className="container p-2">
            <input type="text" className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light search-placeholder-dark' : ''}`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search users..." />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: selectedChatId ? 'calc(100vh - 150px)' : 'calc(100vh - 90px)' }}>
            {searchResults.map(result => <div key={result.id} className="p-2 border-bottom container" onClick={() => handleContactSelect(result)} style={{ cursor: 'pointer' }}>{result.email}</div>)}
          </div>
        </div>
      )}

      <div ref={chatRef} className="flex-grow-1" style={{ position: 'absolute', top: selectedChatId ? '90px' : '50px', bottom: selectedChatId ? '60px' : '0', left: 0, right: 0, overflow: 'hidden' }}>
        {callState.isCalling && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(180deg, rgba(18, 18, 38, 0.98) 0%, rgba(9, 9, 19, 0.98) 100%)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '16px', boxSizing: 'border-box' }}>
            <div style={{ fontSize: '18px', fontWeight: '500', color: 'white', padding: '12px 0', width: '100%', textAlign: 'center', zIndex: 2 }}>{formatCallDuration(callState.callDuration)}</div>
            <div style={{ width: '100%', flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              {callState.isVideoEnabled && callState.remoteStream ? (
                <video ref={remoteVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px' }} autoPlay playsInline />
              ) : (
                <div className="audio-spectrogram" style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '12px', background: 'rgba(30, 30, 60, 0.5)', overflow: 'hidden' }}>
                  <AudioSpectrogram audioStream={callState.remoteStream} style={{ width: '100%', height: '70%' }} />
                </div>
              )}
              {callState.isVideoEnabled && callState.localStream && (
                <div style={{ position: 'absolute', bottom: '16px', right: '16px', width: '100px', height: '150px', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)', zIndex: 3, border: '2px solid rgba(255, 255, 255, 0.2)' }}>
                  <video ref={localVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay playsInline muted />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px', padding: '16px 0', width: '100%', zIndex: 2 }}>
              <button onClick={toggleMicrophone} style={{ width: '56px', height: '56px', borderRadius: '50%', background: callState.isMicrophoneEnabled ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 80, 80, 0.7)', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: '24px', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                <i className={`fas fa-${callState.isMicrophoneEnabled ? 'microphone' : 'microphone-slash'}`}></i>
              </button>
              <button onClick={endCall} style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255, 50, 50, 0.9)', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: '24px', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                <i className="fas fa-phone-slash"></i>
              </button>
              <button onClick={toggleVideo} style={{ width: '56px', height: '56px', borderRadius: '50%', background: callState.isVideoEnabled ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: '24px', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                <i className={`fas fa-${callState.isVideoEnabled ? 'video' : 'video-slash'}`}></i>
              </button>
            </div>
          </div>
        )}
        {selectedChatId && !callState.isCalling && (
          <div className="p-3 scroll-container" style={{ height: 'calc(100% - 60px)', overflowY: 'auto', filter: isSearchOpen ? 'blur(5px)' : 'none', transition: 'filter 0.3s', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexGrow: 1 }} />
            {messages.map(msg => (
              <div key={`${msg.id}-${msg.timestamp}`} className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2 message-enter`}>
                <div 
                  className={`p-2 rounded-3 ${msg.isMine ? 
                    (msg.isP2P ? 'p2p-message-mine' : 'bg-primary text-white') : 
                    (msg.isP2P ? 'p2p-message-theirs' : isDarkTheme ? 'bg-secondary text-white' : 'bg-light border')}`} 
                  style={{ maxWidth: '75%', borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px', wordBreak: 'break-word' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span>{msg.text}</span>
                    {msg.text.startsWith('base64:') && (
                      <FaRedo className="retry-button" onClick={() => retryDecryption(msg)} style={{ fontSize: '0.8rem', color: isDarkTheme ? '#fff' : '#000' }} />
                    )}
                  </div>
                  <div className="text-end mt-1" style={{ fontSize: '0.7rem', opacity: 0.8 }}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {msg.isMine && (msg.isRead === 1 ? '✓✓' : '✓')}</div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} style={{ height: '1px' }} />
          </div>
        )}
        {!selectedChatId && <ChatList contacts={contacts} selectedChatId={selectedChatId} isDarkTheme={isDarkTheme} onSelectChat={handleContactSelect} />}
      </div>

      {selectedChatId && !callState.isCalling && (
        <div className="p-2" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: headerBackground, zIndex: 10, height: '49px', display: 'flex', alignItems: 'center', borderTop: isDarkTheme ? '1px solid #444' : '1px solid #eee' }}>
          <div className="d-flex align-items-center w-100 px-2">
            <input type="text" className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light input-placeholder-dark' : ''}`} value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} placeholder="Message..." style={{ borderRadius: '20px', color: isDarkTheme ? '#fff' : '#000' }} />
            <button className="btn btn-primary ms-2 d-flex align-items-center justify-content-center" onClick={sendMessage} style={{ borderRadius: '20px', minWidth: '60px', height: '38px' }} disabled={!input.trim() || !tweetNaclKeyPair || !isKeysLoaded}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;