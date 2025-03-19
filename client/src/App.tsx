import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Contact, Message, TweetNaClKeyPair, IdentityKeyPair, EncryptionError } from './types';
import ChatList from './components/ChatList';
import ChatWindow from './components/ChatWindow';
import VideoCallWindow from './components/CallWindow';
import AuthForm from './components/AuthForm';
import { fetchChats, fetchMessages, markAsRead } from './services/api';
import { useAuth } from './hooks/useAuth';
import axios, { AxiosError } from 'axios';
import * as nacl from 'tweetnacl';
import { FaSun, FaMoon, FaSignOutAlt, FaSync, FaLock, FaPhone, FaVideo, FaCheck, FaTimes, FaChevronLeft } from 'react-icons/fa';
import P2PService from './services/p2p';
import VideoCallService, { CallState } from './services/VideoCallService';
import io, { Socket } from 'socket.io-client';
import { FiCamera, FiMoon, FiPhone, FiPhoneCall, FiVideo } from 'react-icons/fi';
import { BiPhone, BiVideo } from 'react-icons/bi';
import { CiPhone, CiVideoOn } from "react-icons/ci";
import { RiP2PFill, RiP2PLine } from "react-icons/ri";

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
  stored[messageId] = text;
  localStorage.setItem(`sentMessages_${chatId}`, JSON.stringify(stored));
};

const getSentMessage = (messageId: string, chatId: string): string | null => {
  return JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}')[messageId] || null;
};

const publicKeysCache = new Map<string, string>();

const App: React.FC = () => {
  const { userId, setUserId, setIdentityKeyPair } = useAuth();
  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem('userEmail'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(localStorage.getItem('selectedChatId'));
  const [input, setInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [tweetNaclKeyPair, setTweetNaclKeyPair] = useState<TweetNaClKeyPair | null>(null);
  const [isKeysLoaded, setIsKeysLoaded] = useState<boolean>(false);
  const [isP2PActive, setIsP2PActive] = useState<boolean>(false);
  const [p2pRequest, setP2PRequest] = useState<Message | null>(null);
  const [callState, setCallState] = useState<CallState>({
    localStream: null,
    remoteStream: null,
    isCalling: false,
    isVideoEnabled: false,
    isMicrophoneEnabled: true,
    callDuration: 0,
    reactions: [],
  });
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [showScrollDown, setShowScrollDown] = useState<boolean>(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef<boolean>(true);
  const p2pServiceRef = useRef<P2PService | null>(null);
  const videoCallServiceRef = useRef<VideoCallService | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sentMessageIds = useRef<Set<string>>(new Set());
  const scrollPositionRef = useRef<number>(0);
  const shouldScrollToBottomRef = useRef<boolean>(true);

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
    socketRef.current.on('connect', () => {
      console.log('Socket connected');
      fetchData();
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
    return () => { document.head.removeChild(style); };
  }, []);

  useEffect(() => {
    if (!userId || tweetNaclKeyPair) return;
    initializeKeys();
  }, [userId]);

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
    if (!senderPublicKey) return encryptedText;
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

  const isAtBottom = useCallback(() => {
    const chatContainer = chatContainerRef.current;
    if (!chatContainer) return true;
    return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 20;
  }, []);

  const scrollToBottom = useCallback((force: boolean = false) => {
    const chatContainer = chatContainerRef.current;
    if (!chatContainer) return;
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    if (force) {
      setUnreadMessagesCount(0);
      setShowScrollDown(false);
    }
  }, []);

  const handleIncomingMessage = async (message: Message) => {
    if (sentMessageIds.current.has(message.id)) return;
    if (!message.isP2P) {
      const decryptedText = await decryptMessageText(message);
      const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        const updatedMessages = [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp);
        if (!isAtBottom() && selectedChatId === (message.userId === userId ? message.contactId : message.userId)) {
          setUnreadMessagesCount(prev => prev + 1);
        }
        return updatedMessages;
      });
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
        setMessages(prev => {
          if (prev.some(m => m.id === message.id)) return prev;
          const updatedMessages = [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp);
          if (!isAtBottom() && selectedChatId === (message.userId === userId ? message.contactId : message.userId)) {
            setUnreadMessagesCount(prev => prev + 1);
          }
          return updatedMessages;
        });
        await updateContactsWithLastMessage(updatedMessage);
      }
    }
  };

  const handleP2PMessage = async (message: Message) => {
    if (sentMessageIds.current.has(message.id)) return;
    const decryptedText = await decryptMessageText(message);
    const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev;
      const updatedMessages = [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp);
      if (!isAtBottom() && selectedChatId === message.userId) {
        setUnreadMessagesCount(prev => prev + 1);
      }
      return updatedMessages;
    });
    await updateContactsWithLastMessage(updatedMessage);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (!userId || !selectedChatId || !tweetNaclKeyPair) {
      console.error('Cannot send message: missing prerequisites', { userId, selectedChatId, tweetNaclKeyPair });
      return;
    }
    const contact = contacts.find(c => c.id === selectedChatId) || (socketRef.current?.connected ? (await axios.get<Contact>(`https://100.64.221.88:4000/users?id=${selectedChatId}`)).data : { id: selectedChatId, publicKey: '', email: '', lastMessage: null });
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const message: Message = { 
      id: messageId, 
      userId: userId!, 
      contactId: selectedChatId, 
      text: input.trim(), 
      timestamp: Date.now(), 
      isRead: 0, 
      isMine: true, 
      isP2P: isP2PActive 
    };

    try {
      sentMessageIds.current.add(messageId);
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
      shouldScrollToBottomRef.current = true;
    } catch (error) {
      console.error('Failed to send message:', error);
      sentMessageIds.current.delete(messageId);
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
    const chatContainer = chatContainerRef.current;
    if (!chatContainer || !selectedChatId) return;

    const savedPosition = localStorage.getItem(`scrollPosition_${selectedChatId}`);
    if (savedPosition && isInitialMount.current) {
      chatContainer.scrollTop = parseFloat(savedPosition);
    } else if (isInitialMount.current) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    isInitialMount.current = false;

    const handleScroll = () => {
      scrollPositionRef.current = chatContainer.scrollTop;
      localStorage.setItem(`scrollPosition_${selectedChatId}`, scrollPositionRef.current.toString());
      const atBottom = isAtBottom();
      setShowScrollDown(!atBottom);
      if (atBottom && unreadMessagesCount > 0) {
        setUnreadMessagesCount(0);
      }
      shouldScrollToBottomRef.current = atBottom;
    };

    chatContainer.addEventListener('scroll', handleScroll);
    return () => chatContainer.removeEventListener('scroll', handleScroll);
  }, [selectedChatId, messages, unreadMessagesCount, isAtBottom]);

  useEffect(() => {
    if (!selectedChatId || messages.length === 0) return;
    if (shouldScrollToBottomRef.current || isAtBottom()) {
      scrollToBottom();
    }
  }, [messages, selectedChatId, isAtBottom, scrollToBottom]);

  const handleAuthSuccess = (id: string, email: string, newTweetNaclKeyPair?: TweetNaClKeyPair) => {
    setUserId(id);
    setUserEmail(email);
    if (newTweetNaclKeyPair) {
      setTweetNaclKeyPair(newTweetNaclKeyPair);
    }
  };

  const handleContactSelect = async (contact: Contact) => {
    setSelectedChatId(contact.id);
    setSearchQuery('');
    setSearchResults([]);
    setContacts(prev => prev.some(c => c.id === contact.id) ? prev : [...prev, { ...contact, lastMessage: null }]);
    setUnreadMessagesCount(0);
    if (!tweetNaclKeyPair) {
      await initializeKeys();
    }
    isInitialMount.current = true;
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
  const headerBackground = isDarkTheme ? '#2c3e50' : '#f1f3f5';
  const inputBackground = isDarkTheme ? '#34495e' : '#e9ecef';

  if (!userId) {
    return <AuthForm isDarkTheme={isDarkTheme} onAuthSuccess={handleAuthSuccess} />;
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
          .message-mine { background-color: #ff9966 !important; color: #333; }
          .message-theirs { background-color: #ffccb3 !important; color: #333; }
          .retry-button { margin-left: 5px; cursor: pointer; }
          .send-btn-active { background: linear-gradient(90deg, #00C7D4, #00C79D); border: none; color: #fff; }
          .send-btn-inactive { background: linear-gradient(90deg, #00C7D4, #00C79D); border: none; color: #fff; }
          .send-btn-active:disabled { background: linear-gradient(90deg, #00C7D4, #00C79D); border: none; opacity: 0.5; color: #fff; }
          .btn { transition: background-color 0.2s ease-in-out; }
          .input-field { 
            background: ${inputBackground}; 
            border: none; 
            outline: none; 
          }
          .input-field:focus { 
            background: ${inputBackground}; 
            outline: none; 
            box-shadow: none; 
          }
          .icon-hover:hover { color: ${isDarkTheme ? '#00C7D4' : '#00C79D'}; }
          .call-icon {
            cursor: pointer;
            transition: color 0.2s ease-in-out;
          }
          .call-icon:disabled {
            cursor: not-allowed;
            opacity: 0.5;
          }
          .search-container {
            margin: 0;
            padding: 0;
            width: 100%;
          }
          .search-container .form-control {
            border-radius: 20px;
            margin: 0;
            padding-left: 15px;
            padding-right: 15px;
            width: 100%;
            box-shadow: none;
          }
          .form-control:focus {
            outline: none;
            box-shadow: none;
          }
        `}
      </style>

      <div 
        className="p-0" 
        style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          background: headerBackground, 
          zIndex: 20, 
          height: '96px', // Збільшено до 90px для опускання нижньої грані
          borderBottom: isDarkTheme ? '1px solid #34495e' : '1px solid #e8ecef' 
        }}
      >
        {/* Заголовок та меню */}
        <div className="d-flex justify-content-between align-items-center p-2" style={{ height: '48px' }}>
          <div className="d-flex align-items-center" style={{ gap: '15px' }}>
            <h5 className="m-0" style={{ cursor: 'pointer' }} onClick={() => setIsMenuOpen(!isMenuOpen)}>
              MSNGR ({userEmail})
              {isP2PActive && (
                <span className="ms-2" style={{ fontSize: '0.8rem', color: '#00C7D9', fontWeight: 'bold' }}>
                  P2P mode
                </span>
              )}
            </h5>
            {isMenuOpen && (
              <div style={{ position: 'fixed', top: '55px', left: '10px', background: headerBackground, border: '1px solid #ccc', borderRadius: '4px', zIndex: 1000, padding: '5px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button className="btn btn-sm btn-success mb-2" onClick={() => window.location.reload()} style={{ width: '150px', fontSize: '0.875rem' }}><FaSync /> Update</button>
                <button className="btn btn-sm btn-outline-danger" onClick={handleLogout} style={{ width: '150px', fontSize: '0.875rem' }}><FaSignOutAlt /> Logout</button>
              </div>
            )}
          </div>
        </div>

        {/* Поле пошуку */}
        {!selectedChatId && (
          <div 
            className="search-container mx-0 px-3 w-100 d-flex align-items-center" 
            style={{ 
              boxSizing: 'border-box', 
              height: '42px', // Збільшено до 42px для відповідності новій висоті (90px - 48px)
              padding: '0 15px' // Відступи всередині для звуження поля
            }}
          >
            <input 
              type="text" 
              className={`form-control input-field ${isDarkTheme ? 'text-light search-placeholder-dark' : 'text-dark'}`} 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              placeholder="Search users..." 
              style={{ 
                borderRadius: '20px', 
                color: isDarkTheme ? '#fff' : '#000', 
                width: '100%', 
                boxSizing: 'border-box', 
                margin: 0, 
                padding: '0.375rem 15px', 
                border: 'none', 
                height: '100%'
              }} 
            />
          </div>
        )}

        {selectedChatId && (
          <div className="px-3 d-flex align-items-center justify-content-between" style={{ background: headerBackground, height: '42px' }}>
            <div className="d-flex align-items-center">
              <button 
                className="btn btn-sm btn-outline-secondary me-2" 
                onClick={() => setSelectedChatId(null)} 
                style={{ 
                  border: 'none', 
                  background: 'transparent', 
                  width: '25px', 
                  height: '25px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  padding: 0 
                }}
              >
                <FaChevronLeft style={{ width: '95px', height: '95px', transform: 'scale(0.4)', color: isDarkTheme ? '#fff' : '#212529' }} />
              </button>
              <div className="rounded-circle me-2 d-flex align-items-center justify-content-center" style={{ width: '25px', height: '25px', background: isDarkTheme ? '#6c757d' : '#e9ecef', color: isDarkTheme ? '#fff' : '#212529' }}>
                {(contacts.find(c => c.id === selectedChatId)?.email || '')[0]?.toUpperCase() || '?'}
              </div>
              <h6 className="m-0 me-2">{contacts.find(c => c.id === selectedChatId)?.email || 'Loading...'}</h6>
              {isP2PActive ? (
                <RiP2PFill
                  size={24}
                  color="#00C7D9"
                  className="icon-hover call-icon"
                  onClick={() => p2pServiceRef.current?.disconnectP2P()}
                  style={{ cursor: 'pointer' }}
                  title="P2P активний (натисніть, щоб відключити)"
                />
              ) : (
                <RiP2PLine
                  size={24}
                  color={isDarkTheme ? '#fff' : '#212529'}
                  className="icon-hover call-icon"
                  onClick={initiateP2P}
                  style={{ cursor: tweetNaclKeyPair && selectedChatId ? 'pointer' : 'not-allowed' }}
                  title="Увімкнути P2P"
                />
              )}
            </div>
            {!p2pRequest && (
              <div className="d-flex align-items-center" style={{ gap: '20px' }}>
                <FiPhone 
                  size={23} 
                  color={isDarkTheme ? '#fff' : '#212529'} 
                  className="icon-hover call-icon" 
                  onClick={() => initiateCall(false)} 
                  style={{ cursor: callState.isCalling ? 'not-allowed' : 'pointer' }} 
                />
                <FiVideo 
                  size={28} 
                  color={isDarkTheme ? '#fff' : '#212529'} 
                  className="icon-hover call-icon" 
                  onClick={() => initiateCall(true)} 
                  style={{ cursor: callState.isCalling ? 'not-allowed' : 'pointer' }} 
                />
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

      {searchResults.length > 0 && !selectedChatId && (
        <div style={{ position: 'fixed', top: '90px', left: 0, right: 0, background: headerBackground, zIndex: 30, padding: '0' }}>
          <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 90px)' }}>
            {searchResults.map(result => (
              <div 
                key={result.id} 
                className="p-2 border-bottom container" 
                onClick={() => handleContactSelect(result)} 
                style={{ cursor: 'pointer' }}
              >
                {result.email}
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={chatRef} className="flex-grow-1" style={{ position: 'absolute', top: '90px', bottom: selectedChatId ? '60px' : '0', left: 0, right: 0, overflow: 'hidden' }}>
        <VideoCallWindow
          callState={callState}
          onToggleVideo={toggleVideo}
          onToggleMicrophone={toggleMicrophone}
          onEndCall={endCall}
        />
        {selectedChatId && !callState.isCalling && (
          <ChatWindow
            messages={messages}
            selectedChatId={selectedChatId}
            isDarkTheme={isDarkTheme}
            unreadMessagesCount={unreadMessagesCount}
            showScrollDown={showScrollDown}
            onRetryDecryption={retryDecryption}
            onScrollToBottom={scrollToBottom}
            chatContainerRef={chatContainerRef}
            onSendMessage={sendMessage}
          />
        )}
        {!selectedChatId && <ChatList contacts={contacts} selectedChatId={selectedChatId} isDarkTheme={isDarkTheme} onSelectChat={handleContactSelect} />}
      </div>

      {selectedChatId && !callState.isCalling && (
        <div 
          className="p-0" 
          style={{ 
            position: 'fixed', 
            bottom: 0, 
            left: 0, 
            right: 0, 
            background: headerBackground, 
            zIndex: 10, 
            height: '49px', 
            display: 'flex', 
            alignItems: 'center', 
            borderTop: isDarkTheme ? '1px solid #34495e' : '1px solid #e8ecef', 
            width: '100%', 
            boxSizing: 'border-box' 
          }}
        >
          <div className="d-flex align-items-center w-100 px-3">
            <input 
              type="text" 
              className={`form-control input-field ${isDarkTheme ? 'text-light input-placeholder-dark' : 'text-dark'}`} 
              value={input} 
              onChange={e => setInput(e.target.value)} 
              onKeyPress={e => e.key === 'Enter' && sendMessage()} 
              placeholder="Message..." 
              style={{ borderRadius: '20px', color: isDarkTheme ? '#fff' : '#000', padding: '0.375rem 15px', margin: 0 }} 
            />
            <button 
              className={`btn ms-1 d-flex align-items-center justify-content-center ${input.trim() ? 'send-btn-active' : 'send-btn-inactive'}`}
              onClick={sendMessage} 
              disabled={!input.trim()}
              style={{ borderRadius: '20px', minWidth: '60px', height: '38px', transition: 'background 0.1s ease', padding: '0.375rem 0.75rem', margin: 0 }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;