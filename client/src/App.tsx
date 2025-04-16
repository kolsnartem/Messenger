import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSwipeable } from 'react-swipeable';
import { Contact, Message, TweetNaClKeyPair } from './types';
import ChatList from './components/ChatList';
import ChatWindow from './components/ChatWindow';
import VideoCallWindow from './components/CallWindow';
import AuthForm from './components/AuthForm';
import { fetchChats, fetchMessages, markAsRead } from './services/api';
import { useAuth } from './hooks/useAuth';
import axios from 'axios';
import * as nacl from 'tweetnacl';
import { FaSun, FaMoon, FaSignOutAlt, FaSync, FaLock, FaPhone, FaVideo, FaCheck, FaTimes } from 'react-icons/fa';
import P2PService from './services/p2p';
import VideoCallService, { CallState } from './services/VideoCallService';
import io, { Socket } from 'socket.io-client';
import { FiCamera, FiMoon, FiPhone, FiVideo } from 'react-icons/fi';
import { RiP2PFill, RiSearchLine } from "react-icons/ri";
import { MdOutlineArrowBackIos } from "react-icons/md";
import { TbMenuDeep } from "react-icons/tb";
import toast, { Toaster } from 'react-hot-toast';
import CryptoJS from 'crypto-js';

interface ApiErrorResponse {
  error?: string;
}

const cleanBase64 = (base64Str: string): string => base64Str.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
const fixPublicKey = (key: Uint8Array): Uint8Array => {
  if (key.length === 33 && (key[0] === 0x00 || key[0] === 0x01)) return key.slice(1);
  if (key.length !== 32) throw new Error(`Invalid public key length: ${key.length}`);
  return key;
};

const initializeTweetNaclKeys = async (userId: string | null, password: string): Promise<TweetNaClKeyPair> => {
  const stored = localStorage.getItem('tweetnaclKeyPair');
  if (stored && userId) {
    try {
      const { publicKey, secretKey } = JSON.parse(stored);
      const keyPair = { publicKey: new Uint8Array(publicKey), secretKey: new Uint8Array(secretKey) };
      return keyPair;
    } catch (error) {
      console.error('Error validating stored key pairr:', error);
    }
  }

  const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Hex);
  const seed = new Uint8Array(Buffer.from(hashedPassword, 'hex').slice(0, 32));
  const newKeyPair = nacl.box.keyPair.fromSecretKey(seed);

  localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
    publicKey: Array.from(newKeyPair.publicKey),
    secretKey: Array.from(newKeyPair.secretKey),
  }));
  if (userId) {
    await updatePublicKeyForUser(newKeyPair, userId);
  }
  return newKeyPair;
};

const updatePublicKeyForUser = async (keyPair: TweetNaClKeyPair, userId: string) => {
  const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString('base64');
  try {
    await axios.put('https://100.64.221.88:4000/update-keys', { userId, publicKey: publicKeyBase64 });
    localStorage.setItem(`publicKey_${userId}`, publicKeyBase64);
    publicKeysCache.set(userId, publicKeyBase64);
    console.log(`Updated public key for user ${userId} on server`);
  } catch (error) {
    console.error('Failed to update public key:', error);
  }
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
  const [contacts, setContacts] = useState<Contact[]>(JSON.parse(localStorage.getItem('contacts') || '[]'));
  const [selectedChatId, setSelectedChatId] = useState<string | null>(localStorage.getItem('selectedChatId'));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) return storedTheme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const themeToSave = isDarkTheme ? 'dark' : 'light';
    localStorage.setItem('theme', themeToSave);
    document.documentElement.style.backgroundColor = isDarkTheme ? '#101010' : '#FFFFFF';
    document.documentElement.setAttribute('data-theme', themeToSave);
  }, [isDarkTheme]);

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
  const [unreadMessages, setUnreadMessages] = useState<Map<string, number>>(new Map());
  const [showScrollDown, setShowScrollDown] = useState<boolean>(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const p2pServiceRef = useRef<P2PService | null>(null);
  const videoCallServiceRef = useRef<VideoCallService | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sentMessageIds = useRef<Set<string>>(new Set());

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
      toast.success('Connected to server');
      fetchData();
      if (selectedChatId) reDecryptMessages(selectedChatId);
    });
    socketRef.current.on('message-read', ({ messageId, contactId }) => {
      if (selectedChatId === contactId) {
        setMessages(prev => {
          const updatedMessages = prev.map(m => m.id === messageId ? { ...m, isRead: 1 } : m);
          localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(updatedMessages));
          return updatedMessages;
        });
      }
      setUnreadMessages(prev => {
        const newMap = new Map(prev);
        const count = newMap.get(contactId) || 0;
        if (count > 0) newMap.set(contactId, count - 1);
        if (count <= 1) newMap.delete(contactId);
        return newMap;
      });
    });
    socketRef.current.on('disconnect', () => {
      console.log('Socket disconnected');
      toast.error('Disconnected from server');
    });
    socketRef.current.on('message', handleIncomingMessage);
    videoCallServiceRef.current = new VideoCallService(socketRef.current, userId, (state: CallState) => {
      setCallState(prev => ({ ...prev, ...state, callDuration: prev.callDuration || 0, reactions: prev.reactions || [] }));
    });

    const handleVisibilityChange = () => {
      if (document.hidden) socketRef.current?.disconnect();
      else if (!socketRef.current?.connected) socketRef.current?.connect();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      socketRef.current?.disconnect();
      videoCallServiceRef.current?.endCall(false);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]);

  useEffect(() => {
    if (userId && !p2pServiceRef.current && socketRef.current) {
      p2pServiceRef.current = new P2PService(userId, socketRef.current, handleP2PMessage, setIsP2PActive);
    }
    return () => p2pServiceRef.current?.disconnectP2P();
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
    const style: HTMLStyleElement = document.createElement('style');
    style.textContent = `
      @keyframes float-up {
        0% { transform: translateY(0); opacity: 1; }
        80% { opacity: 0.8; }
        100% { transform: translateY(-120px); opacity: 0; }
      }
      .reaction-emoji { animation: float-up 2s ease-out forwards; }
    `;
    document.head.appendChild(style);
    return () => {
      if (style.parentNode) {
        document.head.removeChild(style);
      }
    };
  }, []);

  const fetchSenderPublicKey = async (senderId: string): Promise<string> => {
    let key = publicKeysCache.get(senderId) || localStorage.getItem(`publicKey_${senderId}`) || '';
    if (!key) {
      try {
        const res = await axios.get<Contact>(`https://100.64.221.88:4000/users?id=${senderId}`);
        key = cleanBase64(res.data.publicKey || '');
        publicKeysCache.set(senderId, key);
        localStorage.setItem(`publicKey_${senderId}`, key);
        setContacts(prev => 
          prev.some(c => c.id === senderId) 
            ? prev.map(c => c.id === senderId ? { ...c, publicKey: key, email: res.data.email } : c)
            : [...prev, { id: senderId, email: res.data.email || '', publicKey: key, lastMessage: null }]
        );
      } catch (error) {
        console.error('Failed to fetch sender public key:', error);
      }
    }
    return key;
  };

  const decryptMessage = async (encryptedText: string, senderId: string, receiverId?: string): Promise<string> => {
    if (!encryptedText.startsWith('base64:') || !tweetNaclKeyPair) return encryptedText;
    const data = Buffer.from(encryptedText.slice(7), 'base64');
    const nonce = data.subarray(0, nacl.box.nonceLength);
    const cipher = data.subarray(nacl.box.nonceLength);

    let theirPublicKey: Uint8Array;
    if (senderId === userId && receiverId) {
      const contactPublicKey = await fetchSenderPublicKey(receiverId);
      if (!contactPublicKey) return "[Unable to decrypt: missing receiver public key]";
      theirPublicKey = fixPublicKey(new Uint8Array(Buffer.from(contactPublicKey, 'base64')));
    } else {
      const senderPublicKey = await fetchSenderPublicKey(senderId);
      if (!senderPublicKey) return "[Unable to decrypt: missing sender public key]";
      theirPublicKey = fixPublicKey(new Uint8Array(Buffer.from(senderPublicKey, 'base64')));
    }

    const decrypted = nacl.box.open(
      new Uint8Array(cipher),
      new Uint8Array(nonce),
      theirPublicKey,
      tweetNaclKeyPair.secretKey
    );
    return decrypted ? new TextDecoder().decode(decrypted) : "[Unable to decrypt]";
  };

  const decryptMessageText = async (message: Message): Promise<string> => {
    if (message.userId === userId) {
      const storedText = getSentMessage(message.id, message.contactId || selectedChatId || '');
      if (storedText) return storedText;
    }

    if (message.text.startsWith('base64:') && tweetNaclKeyPair) {
      return await decryptMessage(message.text, message.userId, message.contactId);
    }

    return message.text;
  };

  const reDecryptMessages = async (chatId: string) => {
    const cachedMessages = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
    const decryptedMessages = await Promise.all(cachedMessages.map(async (msg: Message) => ({
      ...msg,
      text: await decryptMessageText(msg),
      isMine: msg.userId === userId
    })));
    setMessages(decryptedMessages);
    localStorage.setItem(`chat_${chatId}`, JSON.stringify(decryptedMessages));
  };

  const retryDecryption = async (message: Message) => {
    const decryptedText = await decryptMessageText(message);
    setMessages(prev => {
      const updatedMessages = prev.map(m => m.id === message.id ? { ...m, text: decryptedText } : m);
      if (selectedChatId) localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(updatedMessages));
      return updatedMessages;
    });
  };

  const updateContactsWithLastMessage = useCallback(async (newMessage: Message) => {
    const decryptedText = await decryptMessageText(newMessage);
    const contactId = newMessage.userId === userId ? newMessage.contactId : newMessage.userId;
    let contactEmail = contacts.find(c => c.id === contactId)?.email || localStorage.getItem(`contactEmail_${contactId}`) || '';
    if (!contactEmail) {
      try {
        const res = await axios.get<Contact>(`https://100.64.221.88:4000/users?id=${contactId}`);
        contactEmail = res.data.email || '';
        localStorage.setItem(`contactEmail_${contactId}`, contactEmail);
      } catch {}
    }
    setContacts(prev => {
      const updatedMessage = { ...newMessage, text: decryptedText, isMine: newMessage.userId === userId };
      const updatedContacts = prev.some(c => c.id === contactId)
        ? prev.map(c => c.id === contactId ? { ...c, lastMessage: updatedMessage, email: contactEmail || c.email } : c)
        : [...prev, { id: contactId, email: contactEmail, publicKey: '', lastMessage: updatedMessage }];
      localStorage.setItem('contacts', JSON.stringify(updatedContacts));
      return updatedContacts;
    });
    const chatId = newMessage.userId === userId ? newMessage.contactId : newMessage.userId;
    const cachedMessages = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
    const updatedMessages = [...cachedMessages, { ...newMessage, text: decryptedText, isMine: newMessage.userId === userId }]
      .filter((m, i, self) => self.findIndex(t => t.id === m.id) === i)
      .sort((a, b) => a.timestamp - b.timestamp);
    localStorage.setItem(`chat_${chatId}`, JSON.stringify(updatedMessages));
    if (selectedChatId === chatId) setMessages(updatedMessages);
  }, [userId, selectedChatId]);

  const isAtBottom = useCallback(() => {
    const chatContainer = chatContainerRef.current;
    if (!chatContainer) return true;
    return chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 20;
  }, []);

  const scrollToBottom = useCallback((force: boolean = false) => {
    const chatContainer = chatContainerRef.current;
    if (!chatContainer) return;
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    if (force && selectedChatId) {
      setUnreadMessages(prev => {
        const newMap = new Map(prev);
        newMap.set(selectedChatId, 0);
        return newMap;
      });
      setShowScrollDown(false);
    }
  }, [selectedChatId]);

  const handleIncomingMessage = async (message: Message) => {
    if (sentMessageIds.current.has(message.id)) return;
    if (!message.isP2P) {
      const decryptedText = await decryptMessageText(message);
      const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
      const chatId = message.userId === userId ? message.contactId : message.userId;
      const cachedMessages = JSON.parse(localStorage.getItem(`chat_${chatId}`) || '[]');
      const updatedMessages = [...cachedMessages, updatedMessage]
        .filter((m, i, self) => self.findIndex(t => t.id === m.id) === i)
        .sort((a, b) => a.timestamp - b.timestamp);
      localStorage.setItem(`chat_${chatId}`, JSON.stringify(updatedMessages));
      if (selectedChatId === chatId) {
        setMessages(updatedMessages);
        if (isAtBottom()) await markAsRead(userId!, chatId);
      } else {
        setUnreadMessages(prev => {
          const newMap = new Map(prev);
          const count = (newMap.get(chatId) || 0) + 1;
          newMap.set(chatId, count);
          return newMap;
        });
      }
      await updateContactsWithLastMessage(updatedMessage);
    }

    try {
      const signalData = JSON.parse(message.text);
      if (signalData.type === 'offer' && message.contactId === userId && !isP2PActive) setP2PRequest(message);
      else if (signalData.type === 'answer') await p2pServiceRef.current?.handleP2PAnswer({ ...message, lastMessage: undefined });
      else if (signalData.candidate) await p2pServiceRef.current?.handleP2PCandidate({ ...message, lastMessage: undefined });
    } catch {}
  };

  const handleP2PMessage = async (message: Message) => {
    if (sentMessageIds.current.has(message.id)) return;
    const decryptedText = await decryptMessageText(message);
    const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev;
      const updatedMessages = [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp);
      if (!isAtBottom() && selectedChatId === message.userId) {
        setUnreadMessages(prev => {
          const newMap = new Map(prev);
          const count = (newMap.get(message.userId) || 0) + 1;
          newMap.set(message.userId, count);
          return newMap;
        });
      }
      if (selectedChatId === message.userId) localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(updatedMessages));
      return updatedMessages;
    });
    await updateContactsWithLastMessage(updatedMessage);
  };

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !userId || !selectedChatId || !tweetNaclKeyPair || !socketRef.current) {
      console.error('Cannot send message:', { 
        textEmpty: !text.trim(), 
        userId, 
        selectedChatId, 
        keysLoaded: !!tweetNaclKeyPair, 
        socketExists: !!socketRef.current, 
        socketConnected: socketRef.current?.connected 
      });
      return;
    }

    if (!socketRef.current.connected) {
      console.log('Socket not connected, attempting to reconnect...');
      socketRef.current.connect();
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!socketRef.current.connected) {
        console.error('Socket reconnection failed');
        return;
      }
    }

    const contactPublicKey = publicKeysCache.get(selectedChatId) || await fetchSenderPublicKey(selectedChatId);
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const message: Message = { 
      id: messageId, 
      userId: userId!, 
      contactId: selectedChatId, 
      text: text.trim(), 
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
        setMessages(prev => {
          const updatedMessages = [...prev, { ...message, text: text.trim() }].sort((a, b) => a.timestamp - b.timestamp);
          localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(updatedMessages));
          return updatedMessages;
        });
        await updateContactsWithLastMessage(message);
      } else {
        const encryptedText = encryptMessage(message.text, contactPublicKey || '', tweetNaclKeyPair);
        storeSentMessage(message.id, text.trim(), selectedChatId);
        socketRef.current.emit('message', { ...message, text: encryptedText });
        setMessages(prev => {
          const updatedMessages = [...prev, { ...message, text: text.trim() }].sort((a, b) => a.timestamp - b.timestamp);
          localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(updatedMessages));
          return updatedMessages;
        });
        await updateContactsWithLastMessage(message);
        await axios.post('https://100.64.221.88:4000/add-chat', { userId, contactId: selectedChatId });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      sentMessageIds.current.delete(messageId);
      if (isP2PActive) p2pServiceRef.current?.requestIceRestart();
    }
  }, [userId, selectedChatId, tweetNaclKeyPair, isP2PActive]);

  const sendFile = useCallback(async (file: File) => {
    if (!userId || !selectedChatId || !socketRef.current) {
      console.error('Cannot send file:', { userId, selectedChatId, socketExists: !!socketRef.current });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);
    formData.append('contactId', selectedChatId);

    try {
      const response = await axios.post<{ success: boolean; message: Message }>('https://100.64.221.88:4000/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const { message } = response.data;
      sentMessageIds.current.add(message.id);

      
      setMessages(prev => {
        const updatedMessages = [...prev, { ...message, isMine: true }].sort((a, b) => a.timestamp - b.timestamp);
        localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(updatedMessages));
        return updatedMessages;
      });
      await updateContactsWithLastMessage({ ...message, isMine: true });

      toast.success('File sent successfully!');
    } catch (error) {
      console.error('Failed to send file:', error);
      toast.error('Failed to send file');
    }
  }, [userId, selectedChatId]);

  const initiateCall = (videoEnabled: boolean) => videoCallServiceRef.current?.initiateCall(selectedChatId!, videoEnabled);
  const endCall = () => videoCallServiceRef.current?.endCall(true);
  const toggleVideo = () => videoCallServiceRef.current?.toggleVideo(!callState.isVideoEnabled);
  const toggleMicrophone = () => videoCallServiceRef.current?.toggleMicrophone(!callState.isMicrophoneEnabled);

  const initializeKeys = async (password: string) => {
    const keyPair = await initializeTweetNaclKeys(userId, password);
    setTweetNaclKeyPair(keyPair);
    setIsKeysLoaded(true);
  };

  const fetchData = async () => {
    const localContacts = JSON.parse(localStorage.getItem('contacts') || '[]');
    setContacts(localContacts);

    if (selectedChatId) {
      const cachedMessages = JSON.parse(localStorage.getItem(`chat_${selectedChatId}`) || '[]');
      setMessages(cachedMessages);
    }

    if (!userId || !socketRef.current?.connected || !tweetNaclKeyPair) {
      console.log('Server unavailable or keys not loaded, using local data only');
      return;
    }

    try {
      const fetchedChats = (await fetchChats(userId)).data;
      const decryptedChats = await Promise.all(fetchedChats.map(async (contact: Contact) => ({
        ...contact,
        lastMessage: contact.lastMessage ? { ...contact.lastMessage, text: await decryptMessageText(contact.lastMessage) } : null
      })));

      setContacts(prev => {
        const updatedContacts = [...prev];
        decryptedChats.forEach(serverContact => {
          const existingIndex = updatedContacts.findIndex(c => c.id === serverContact.id);
          if (existingIndex >= 0) updatedContacts[existingIndex] = { ...updatedContacts[existingIndex], ...serverContact };
          else updatedContacts.push(serverContact);
        });
        localStorage.setItem('contacts', JSON.stringify(updatedContacts));
        return updatedContacts;
      });

      if (selectedChatId) {
        const cachedMessages = JSON.parse(localStorage.getItem(`chat_${selectedChatId}`) || '[]');
        const fetchedMessages = (await fetchMessages(userId, selectedChatId)).data;
        const decryptedMessages = await Promise.all(fetchedMessages.map(async msg => ({
          ...msg,
          isMine: msg.userId === userId,
          text: await decryptMessageText(msg)
        })));
        const combinedMessages = [...cachedMessages, ...decryptedMessages]
          .filter((m, i, self) => self.findIndex(t => t.id === m.id) === i)
          .sort((a, b) => a.timestamp - b.timestamp);
        setMessages(combinedMessages);
        localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(combinedMessages));
        if (isAtBottom() && fetchedMessages.length > 0) await markAsRead(userId, selectedChatId);
      }
    } catch (error) {
      console.error('Failed to fetch data from server:', error);
      console.log('Falling back to local storage data');
    }
  };

  useEffect(() => {
    if (!userId || !tweetNaclKeyPair || !socketRef.current) return;

    socketRef.current.on('message', handleIncomingMessage);
    socketRef.current.on('p2p-offer-notify', (data: { message: Message }) => 
      data.message.contactId === userId && !isP2PActive && setP2PRequest(data.message)
    );
    socketRef.current.on('key-updated', async ({ userId: updatedUserId, publicKey }: { userId: string, publicKey: string }) => {
      const cleanedKey = cleanBase64(publicKey);
      publicKeysCache.set(updatedUserId, cleanedKey);
      localStorage.setItem(`publicKey_${updatedUserId}`, cleanedKey);
      
      setContacts(prev => 
        prev.map(c => 
          c.id === updatedUserId ? { 
            ...c, 
            publicKey: cleanedKey, 
            lastMessage: c.lastMessage ? { ...c.lastMessage, text: c.lastMessage.text.startsWith('base64:') ? '[Encrypted with old key]' : c.lastMessage.text } : null 
          } : c
        )
      );

      if (selectedChatId === updatedUserId) await reDecryptMessages(selectedChatId);
    });

    return () => {
      socketRef.current?.off('message');
      socketRef.current?.off('p2p-offer-notify');
      socketRef.current?.off('key-updated');
    };
  }, [userId, selectedChatId, tweetNaclKeyPair, isP2PActive]);

  useEffect(() => {
    if (!searchQuery || !userId) setSearchResults([]);
    else if (socketRef.current?.connected) {
      axios.get<Contact[]>(`https://100.64.221.88:4000/search?query=${searchQuery}`).then(res => 
        setSearchResults(res.data.filter(c => c.id !== userId))
      );
    }
  }, [searchQuery, userId]);

  const handleAuthSuccess = async (id: string, email: string, password: string) => {
    setUserId(id);
    setUserEmail(email);
    localStorage.setItem('userEmail', email);
    toast.success('Login successful!');
    await initializeKeys(password);
    fetchData();
  };

  const fetchContact = async (contactId: string): Promise<Contact> => {
    const res = await axios.get<Contact>(`https://100.64.221.88:4000/users?id=${contactId}`);
    localStorage.setItem(`contactEmail_${contactId}`, res.data.email || '');
    return res.data;
  };

  const handleContactSelect = async (contact: Contact) => {
    setUnreadMessages(prev => {
      const newMap = new Map(prev);
      newMap.set(contact.id, 0);
      return newMap;
    });
    setMessages([]);
    setSelectedChatId(contact.id);
    localStorage.setItem('selectedChatId', contact.id);
    setSearchQuery('');
    setSearchResults([]);
    let updatedContact = contact;
    if (!contact.email) {
      try {
        updatedContact = await fetchContact(contact.id);
      } catch (error) {
        console.error('Failed to fetch contact:', error);
      }
    }
    setContacts(prev => {
      const updatedContacts = prev.some(c => c.id === contact.id)
        ? prev.map(c => c.id === contact.id ? { ...c, email: updatedContact.email } : c)
        : [...prev, { ...updatedContact, lastMessage: null }];
      localStorage.setItem('contacts', JSON.stringify(updatedContacts));
      return updatedContacts;
    });
    if (!tweetNaclKeyPair) await initializeKeys(localStorage.getItem('password') || '');

    const cachedMessages = JSON.parse(localStorage.getItem(`chat_${contact.id}`) || '[]');
    try {
      const fetchedMessages = (await fetchMessages(userId!, contact.id)).data;
      const decryptedMessages = await Promise.all(fetchedMessages.map(async msg => ({
        ...msg,
        isMine: msg.userId === userId,
        text: await decryptMessageText(msg)
      })));
      const combinedMessages = [...cachedMessages, ...decryptedMessages]
        .filter((m, i, self) => self.findIndex(t => t.id === m.id) === i)
        .sort((a, b) => a.timestamp - b.timestamp);
      setMessages(combinedMessages);
      localStorage.setItem(`chat_${contact.id}`, JSON.stringify(combinedMessages));
      if (isAtBottom() && fetchedMessages.length > 0) {
        await markAsRead(userId!, contact.id);
      }
    } catch (error) {
      console.error('Failed to fetch messages from server:', error);
      setMessages(cachedMessages);
    }
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
    if (!selectedChatId || !p2pServiceRef.current || !contact?.publicKey) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      p2pServiceRef.current.setContactPublicKey(contact.publicKey);
      await p2pServiceRef.current.initiateP2P(selectedChatId);
      setIsP2PActive(true);
    } catch {
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
      } catch {
        setIsP2PActive(false);
        alert('Не вдалося отримати доступ до медіа для P2P з\'єднання');
      }
    } else {
      socketRef.current?.emit('p2p-reject', { target: p2pRequest.userId, source: userId });
    }
    setP2PRequest(null);
  };

  const swipeHandlers = useSwipeable({
    onSwipedRight: (eventData) => {
      if (selectedChatId && eventData.initial[0] < 50) {
        setSelectedChatId(null);
      }
    },
    trackMouse: true,
    delta: 50,
  });

  const themeClass = isDarkTheme ? 'bg-black text-light' : 'bg-light text-dark';
  const headerBackground = isDarkTheme ? '#101010' : '#FFFFFF';

  if (!userId) return <AuthForm isDarkTheme={isDarkTheme} onAuthSuccess={handleAuthSuccess} />;

  return (
    <div {...swipeHandlers} className={`d-flex flex-column ${themeClass}`} style={{ height: '100vh', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      <style>
        {`
          .chat-item { display: flex; align-items: center; padding: 10px; border-bottom: 1px solid ${isDarkTheme ? '#1E1E1E' : '#F3F4F6'}; cursor: pointer; }
          .chat-item:hover { background: ${isDarkTheme ? '#444' : '#f8f9fa'}; }
          .avatar { width: 40px; height: 40px; border-radius: 50%; background: ${isDarkTheme ? '#6c757d' : '#e9ecef'}; color: ${isDarkTheme ? '#fff' : '#212529'}; display: flex; align-items: center; justify-content: center; margin-right: 10px; }
          .search-container { margin: 0; padding: 0; width: 100%; }
          .search-container .form-control { border-radius: 20px; margin: 0; padding-left: 40px; padding-right: 15px; width: 100%; box-shadow: none; background-color: ${isDarkTheme ? '#1E1E1E' : '#F3F4F6'}; border: 1px solid ${isDarkTheme ? '#1E1E1E' : '#F3F4F6'}; color: ${isDarkTheme ? '#fff' : '#000'}}
          .form-control:focus { outline: none; box-shadow: none; }
          .input-placeholder-dark::placeholder { color: #b0b0b0; }
          .icon-hover:hover { color: ${isDarkTheme ? '#00C7D4' : '#00C79D'}; }
          .call-icon { cursor: pointer; transition: color 0.2s ease-in-out; }
          .call-icon:disabled { cursor: not-allowed; opacity: 0.5; }
        `}
      </style>
     {/* 
<Toaster
  position="bottom-center"
  reverseOrder={false}
  toastOptions={{
    style: {
      background: isDarkTheme ? '#333' : '#fff',
      color: isDarkTheme ? '#fff' : '#000',
      border: isDarkTheme ? '1px solid #333' : '1px solid #fff',
      padding: '10px 20px',
      borderRadius: '8px',
    },
    success: {
      style: {
        background: isDarkTheme ? '#2d6b2d' : '#d4edda',
        color: isDarkTheme ? '#fff' : '#155724',
      },
    },
    error: {
      style: {
        background: isDarkTheme ? '#6b2d2d' : '#f8d7da',
        color: isDarkTheme ? '#fff' : '#721c24',
      },
    },
  }}
/> 
*/}

      <div className="p-0" style={{ position: 'fixed', top: 0, left: 0, right: 0, background: headerBackground, zIndex: 20, height: '96px', borderBottom: isDarkTheme ? '1px solid #1E1E1E' : '1px solid #F3F4F6' }}>
        <div className="d-flex justify-content-between align-items-center p-2" style={{ height: '42px' }}>
          <div className="d-flex align-items-center" style={{ gap: '15px' }}>
            <h5 className="m-0" style={{ cursor: 'pointer' }}>
              MSNGR ({userEmail})
              {isP2PActive && <span className="ms-2" style={{ fontSize: '0.8rem', color: '#00C7D9', fontWeight: 'bold' }}>P2P mode</span>}
            </h5>
            {isMenuOpen && (
              <div style={{ position: 'fixed', top: '55px', right: '15px', background: headerBackground, border: '1px solid #ccc', borderRadius: '4px', zIndex: 1000, padding: '5px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button className="btn btn-sm btn-success mb-2" onClick={() => window.location.reload()} style={{ width: '150px', fontSize: '0.875rem' }}><FaSync /> Update</button>
                <button className="btn btn-sm btn-outline-danger" onClick={handleLogout} style={{ width: '150px', fontSize: '0.875rem' }}><FaSignOutAlt /> Logout</button>
              </div>
            )}
          </div>
          <button className="btn btn-sm" onClick={() => setIsMenuOpen(prev => !prev)} style={{ border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', right: '15px' }}>
            <TbMenuDeep size={24} color={isDarkTheme ? '#fff' : '#212529'} className="icon-hover" />
          </button>
        </div>

        {!selectedChatId && (
          <div className="search-container mx-0 px-3 w-100 d-flex align-items-center" style={{ height: '48px', boxSizing: 'border-box' }}>
            <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
              <RiSearchLine style={{
                  position: 'absolute',
                  left: '15px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: isDarkTheme ? '#8a9aa3' : '#6c757d',
                  pointerEvents: 'none',
                  zIndex: 2
              }} />
              <input
                type="text"
                className={`form-control ${isDarkTheme ? 'input-placeholder-dark' : 'input-placeholder-light'}`}
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                aria-label="Search users"
              />
            </div>
          </div>
        )}

        {selectedChatId && (
          <div className="px-3 d-flex align-items-center justify-content-between" style={{ background: headerBackground, height: '42px' }}>
            <div className="d-flex align-items-center">
              <button className="btn btn-sm" onClick={() => setSelectedChatId(null)} style={{ border: 'none', background: 'transparent', width: '25px', height: '25px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, margin: 0, position: 'relative', left: '-7px' }}>
                <MdOutlineArrowBackIos size={24} style={{ color: isDarkTheme ? '#fff' : '#212529' }} />
              </button>
              <div className="rounded-circle me-2 d-flex align-items-center justify-content-center" style={{ width: '32px', height: '32px', background: isDarkTheme ? '#6c757d' : '#e9ecef', color: isDarkTheme ? '#fff' : '#212529' }}>
                {(contacts.find(c => c.id === selectedChatId)?.email || localStorage.getItem(`contactEmail_${selectedChatId}`) || '')[0]?.toUpperCase() || '?'}
              </div>
              <h6 className="m-0 me-2" style={{ fontSize: '18px', fontWeight: 'bold' }}>
                {contacts.find(c => c.id === selectedChatId)?.email || localStorage.getItem(`contactEmail_${selectedChatId}`) || 'Loading...'}
              </h6>
            </div>
            {!p2pRequest && (
              <div className="d-flex align-items-center" style={{ gap: '20px' }}>
                {isP2PActive ? (
                  <RiP2PFill size={24} color="#00C7D9" className="icon-hover call-icon" onClick={() => p2pServiceRef.current?.disconnectP2P()} style={{ cursor: 'pointer' }} title="P2P активний (натисніть, щоб відключити)" />
                ) : (
                  <RiP2PFill size={24} color={isDarkTheme ? '#fff' : '#212529'} className="icon-hover call-icon" onClick={initiateP2P} style={{ cursor: tweetNaclKeyPair && selectedChatId ? 'pointer' : 'not-allowed' }} title="Увімкнути P2P" />
                )}
                <FiVideo size={26} color={isDarkTheme ? '#fff' : '#212529'} className="icon-hover call-icon" onClick={() => initiateCall(true)} style={{ cursor: callState.isCalling ? 'not-allowed' : 'pointer' }} />
                <FiPhone size={23} color={isDarkTheme ? '#fff' : '#212529'} className="icon-hover call-icon" onClick={() => initiateCall(false)} style={{ cursor: callState.isCalling ? 'not-allowed' : 'pointer' }} />
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
              <div key={result.id} className="p-2 border-bottom container" onClick={() => handleContactSelect(result)} style={{ cursor: 'pointer' }}>
                {result.email}
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={chatRef} className="flex-grow-1" style={{ position: 'absolute', top: '90px', bottom: selectedChatId ? '60px' : '0', left: 0, right: 0, overflow: 'hidden' }}>
        <VideoCallWindow callState={callState} onToggleVideo={toggleVideo} onToggleMicrophone={toggleMicrophone} onEndCall={endCall} />
        {selectedChatId && !callState.isCalling && (
          <ChatWindow
            messages={messages}
            selectedChatId={selectedChatId}
            isDarkTheme={isDarkTheme}
            unreadMessagesCount={unreadMessages.get(selectedChatId) || 0}
            showScrollDown={showScrollDown}
            onRetryDecryption={retryDecryption}
            onScrollToBottom={scrollToBottom}
            chatContainerRef={chatContainerRef}
            onSendMessage={sendMessage}
            onSendFile={sendFile} 
          />
        )}
        {!selectedChatId && <ChatList contacts={contacts} selectedChatId={selectedChatId} isDarkTheme={isDarkTheme} onSelectChat={handleContactSelect} unreadMessages={unreadMessages} />}
      </div>
    </div>
  );
};

export default App;