import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Contact, Message, TweetNaClKeyPair } from './types';
import ChatList from './components/ChatList';
import { fetchChats, fetchMessages, markAsRead } from './services/api';
import webSocketService from './services/websocket';
import { useAuth } from './hooks/useAuth';
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';
import * as nacl from 'tweetnacl';
import { FaSearch, FaSun, FaMoon, FaSignOutAlt, FaSync, FaArrowLeft } from 'react-icons/fa';

interface ApiErrorResponse {
  error?: string;
}

interface EncryptionError {
  message: string;
  details?: string;
  timestamp: number;
}

const logEncryptionEvent = (event: string, details?: any) => {
  console.log(`[Encryption] ${event}`, details || '');
};

const cleanBase64 = (base64Str: string): string => {
  const cleaned = base64Str.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
  logEncryptionEvent('Cleaned Base64 string', { original: base64Str, cleaned });
  return cleaned;
};

const fixPublicKey = (key: Uint8Array): Uint8Array => {
  logEncryptionEvent('Checking public key', { bytes: Array.from(key), length: key.length });
  if (key.length === 33) {
    if (key[0] === 0x00 || key[0] === 0x01) {
      logEncryptionEvent('Trimming prefix byte from 33-byte key', { prefix: key[0] });
      return key.slice(1);
    }
    throw new Error(`Unexpected prefix in 33-byte public key: ${key[0]}`);
  }
  if (key.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${key.length}`);
  }
  return key;
};

const initializeTweetNaclKeys = (): TweetNaClKeyPair => {
  const storedKeyPair = localStorage.getItem('tweetnaclKeyPair');
  if (storedKeyPair) {
    try {
      const parsed = JSON.parse(storedKeyPair);
      const publicKey = new Uint8Array(parsed.publicKey);
      const secretKey = new Uint8Array(parsed.secretKey);
      if (publicKey.length !== 32 || secretKey.length !== 32) {
        throw new Error('Invalid stored key pair dimensions');
      }
      logEncryptionEvent('Loaded stored TweetNaCl keys', { publicKeyLength: publicKey.length });
      return { publicKey, secretKey };
    } catch (error) {
      logEncryptionEvent('Failed to load stored keys, generating new', error);
    }
  }
  const newKeyPair = nacl.box.keyPair();
  const publicKeyBase64 = Buffer.from(newKeyPair.publicKey).toString('base64');
  localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
    publicKey: Array.from(newKeyPair.publicKey),
    secretKey: Array.from(newKeyPair.secretKey),
  }));
  logEncryptionEvent('Generated new TweetNaCl keys', { publicKey: publicKeyBase64 });
  return newKeyPair;
};

const encryptMessage = (text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair): string => {
  if (!tweetNaclKeyPair) {
    const error: EncryptionError = { message: 'TweetNaCl key pair not initialized', timestamp: Date.now() };
    logEncryptionEvent('Encryption failed', error);
    throw new Error(error.message);
  }

  const cleanedPublicKey = cleanBase64(contactPublicKey || '');
  if (!cleanedPublicKey) {
    const error: EncryptionError = { message: 'No valid public key provided for encryption', timestamp: Date.now() };
    logEncryptionEvent('Encryption failed', error);
    throw new Error(error.message);
  }

  let theirPublicKeyBuffer: Buffer;
  try {
    theirPublicKeyBuffer = Buffer.from(cleanedPublicKey, 'base64');
    logEncryptionEvent('Decoded contact public key', { base64: cleanedPublicKey, length: theirPublicKeyBuffer.length });
  } catch (error) {
    const encryptionError: EncryptionError = {
      message: 'Invalid Base64 public key format',
      details: (error as Error).message,
      timestamp: Date.now()
    };
    logEncryptionEvent('Encryption failed', encryptionError);
    throw new Error(encryptionError.message);
  }

  const theirPublicKey = fixPublicKey(new Uint8Array(theirPublicKeyBuffer));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(
    new TextEncoder().encode(text),
    nonce,
    theirPublicKey,
    tweetNaclKeyPair.secretKey
  );

  if (!encrypted) {
    const error: EncryptionError = { message: 'Encryption process failed', timestamp: Date.now() };
    logEncryptionEvent('Encryption failed', error);
    throw new Error(error.message);
  }

  const result = `base64:${Buffer.from(new Uint8Array([...nonce, ...encrypted])).toString('base64')}`;
  logEncryptionEvent('Message encrypted successfully', { encryptedLength: result.length });
  return result;
};

const storeSentMessage = (messageId: string, text: string, chatId: string) => {
  const storedMessages = JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}');
  storedMessages[messageId] = text;
  localStorage.setItem(`sentMessages_${chatId}`, JSON.stringify(storedMessages));
};

const getSentMessage = (messageId: string, chatId: string): string | null => {
  const storedMessages = JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}');
  return storedMessages[messageId] || null;
};

const publicKeysCache = new Map<string, string>();

const App: React.FC = () => {
  const { userId, setUserId, setIdentityKeyPair } = useAuth();
  const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem('userEmail'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(() => localStorage.getItem('selectedChatId'));
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
  const chatRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  const fetchSenderPublicKey = async (senderId: string): Promise<string> => {
    if (publicKeysCache.has(senderId)) {
      return publicKeysCache.get(senderId)!;
    }

    let senderPublicKey = cleanBase64(
      contacts.find(c => c.id === senderId)?.publicKey ||
      searchResults.find(c => c.id === senderId)?.publicKey ||
      localStorage.getItem(`publicKey_${senderId}`) || ''
    );

    if (!senderPublicKey) {
      logEncryptionEvent(`No public key found locally for sender ${senderId}, fetching from server`);
      try {
        const res = await axios.get<Contact>(`http://192.168.31.185:4000/users?id=${senderId}`);
        const key = cleanBase64(res.data.publicKey || '');
        if (key && key.length === 44) {
          senderPublicKey = key;
          publicKeysCache.set(senderId, senderPublicKey);
          localStorage.setItem(`publicKey_${senderId}`, senderPublicKey);
          setContacts(prev => {
            const exists = prev.some(c => c.id === senderId);
            if (!exists) {
              return [...prev, {
                id: senderId,
                email: res.data.email || '',
                publicKey: key,
                lastMessage: null
              }];
            }
            return prev.map(c => c.id === senderId ? { ...c, publicKey: key } : c);
          });
          setSearchResults(prev => prev.map(c => c.id === senderId ? { ...c, publicKey: key } : c));
          logEncryptionEvent(`Fetched and updated public key for ${senderId}`, { key });
        } else {
          throw new Error('Invalid public key format from server');
        }
      } catch (err) {
        const error: EncryptionError = {
          message: 'Failed to fetch sender public key',
          details: (err as Error).message,
          timestamp: Date.now()
        };
        logEncryptionEvent('Decryption failed', error);
        throw new Error(error.message);
      }
    }
    publicKeysCache.set(senderId, senderPublicKey);
    return senderPublicKey;
  };

  const decryptMessage = async (encryptedText: string, senderId: string): Promise<string> => {
    if (!encryptedText.startsWith('base64:')) {
      logEncryptionEvent('Message not encrypted, returning as is', { text: encryptedText });
      return encryptedText;
    }

    if (!tweetNaclKeyPair) {
      const error: EncryptionError = { message: 'TweetNaCl key pair not initialized for decryption', timestamp: Date.now() };
      logEncryptionEvent('Decryption failed', error);
      throw new Error(error.message);
    }

    const base64Data = encryptedText.slice(7);
    const data = Buffer.from(base64Data, 'base64');
    const nonce = data.subarray(0, nacl.box.nonceLength);
    const cipher = data.subarray(nacl.box.nonceLength);

    const senderPublicKey = await fetchSenderPublicKey(senderId);

    try {
      const theirPublicKeyBuffer = Buffer.from(senderPublicKey, 'base64');
      const theirPublicKey = fixPublicKey(new Uint8Array(theirPublicKeyBuffer));
      const decrypted = nacl.box.open(
        new Uint8Array(cipher),
        new Uint8Array(nonce),
        theirPublicKey,
        tweetNaclKeyPair.secretKey
      );

      if (!decrypted) {
        const error: EncryptionError = { message: `Decryption failed for message from ${senderId}`, timestamp: Date.now() };
        logEncryptionEvent('Decryption failed', error);
        throw new Error(error.message);
      }

      const result = new TextDecoder().decode(decrypted);
      logEncryptionEvent('Message decrypted successfully', { senderId });
      return result;
    } catch (error) {
      const encryptionError: EncryptionError = {
        message: 'Decryption error',
        details: (error as Error).message,
        timestamp: Date.now()
      };
      logEncryptionEvent('Decryption failed', encryptionError);
      throw new Error(encryptionError.message);
    }
  };

  // Централізована функція для розшифрування повідомлень
  const decryptMessageText = async (message: Message): Promise<string> => {
    if (message.userId === userId) {
      const storedText = getSentMessage(message.id, message.contactId || selectedChatId || '');
      if (storedText) {
        logEncryptionEvent('Retrieved stored text for own message', { messageId: message.id, chatId: message.contactId });
        return storedText;
      }
    }

    if (message.text.startsWith('base64:')) {
      return await decryptMessage(message.text, message.userId);
    }

    return message.text;
  };

  const retryDecryption = async (messageId: string) => {
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1 || !messages[messageIndex].encryptedText) return;

    try {
      const decryptedText = await decryptMessage(
        messages[messageIndex].encryptedText!,
        messages[messageIndex].userId
      );
      const updatedMessages = [...messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        text: decryptedText
      };
      setMessages(updatedMessages);
    } catch (error) {
      console.error('Retry decryption failed:', error);
    }
  };

  const updateContactsWithLastMessage = useCallback(async (newMessage: Message) => {
    try {
      let messageToUpdate = { ...newMessage };
      messageToUpdate.text = await decryptMessageText(newMessage);

      setContacts(prev => {
        const contactId = messageToUpdate.userId === userId ? messageToUpdate.contactId : messageToUpdate.userId;
        const existingContact = prev.find(c => c.id === contactId);

        if (existingContact) {
          return prev
            .map(c =>
              c.id === contactId
                ? { ...c, lastMessage: { ...messageToUpdate, isMine: messageToUpdate.userId === userId } }
                : c
            )
            .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
        }

        const newContact = searchResults.find(c => c.id === contactId) || {
          id: contactId,
          email: '',
          publicKey: '',
          lastMessage: null
        };

        return [...prev, { ...newContact, lastMessage: { ...messageToUpdate, isMine: messageToUpdate.userId === userId } }]
          .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
      });
    } catch (error) {
      logEncryptionEvent('Failed to update contacts with last message', {
        error: (error as Error).message,
        messageId: newMessage.id
      });
    }
  }, [userId, searchResults, selectedChatId]);

  const handleIncomingMessage = async (message: Message) => {
    try {
      const decryptedText = await decryptMessageText(message);
      const updatedMessage = { ...message, text: decryptedText, isMine: message.userId === userId };

      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp);
      });

      await updateContactsWithLastMessage(updatedMessage);
      logEncryptionEvent('Incoming message processed successfully', { messageId: message.id });
    } catch (error) {
      const encryptionError: EncryptionError = {
        message: 'Error handling incoming message',
        details: (error as Error).message,
        timestamp: Date.now()
      };
      logEncryptionEvent('Incoming message processing failed', encryptionError);
      setMessages(prev => {
        const updatedMessage = { ...message, text: '[Decryption Failed]', isMine: message.userId === userId, encryptedText: message.text };
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, updatedMessage].sort((a, b) => a.timestamp - b.timestamp);
      });
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !userId || !selectedChatId || !tweetNaclKeyPair) {
      const error: EncryptionError = {
        message: 'Invalid send message parameters',
        details: `input: ${!!input}, userId: ${!!userId}, chatId: ${!!selectedChatId}, keys: ${!!tweetNaclKeyPair}`,
        timestamp: Date.now()
      };
      logEncryptionEvent('Send message failed', error);
      alert('Cannot send message: Missing required parameters');
      return;
    }

    let contact = contacts.find(c => c.id === selectedChatId) || searchResults.find(c => c.id === selectedChatId);
    if (!contact) {
      logEncryptionEvent(`No contact found for ${selectedChatId}, fetching from server`);
      try {
        const res = await axios.get<Contact>(`http://192.168.31.185:4000/users?id=${selectedChatId}`);
        const fetchedContact = res.data;
        if (fetchedContact.publicKey && fetchedContact.publicKey.length === 44) {
          setSearchResults(prev => [...prev, fetchedContact].filter(c => c.id !== userId));
          const updatedContact = { ...fetchedContact, lastMessage: null };
          setContacts(prev => [...prev, updatedContact].sort(
            (a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
          ));
          contact = updatedContact;
          logEncryptionEvent('Contact fetched and updated', { contactId: selectedChatId });
        } else {
          throw new Error('Invalid public key format for fetched contact');
        }
      } catch (err) {
        const error: EncryptionError = {
          message: 'Failed to fetch contact for sending message',
          details: (err as Error).message,
          timestamp: Date.now()
        };
        logEncryptionEvent('Send message failed', error);
        alert('Cannot send message: Contact not found');
        return;
      }
    }

    try {
      const message = input.trim();
      const encryptedText = encryptMessage(message, contact.publicKey || '', tweetNaclKeyPair);

      const newMessage: Message = {
        id: Date.now().toString(),
        userId,
        contactId: selectedChatId,
        text: encryptedText,
        timestamp: Date.now(),
        isRead: 0,
        isMine: true,
      };

      storeSentMessage(newMessage.id, message, selectedChatId);

      const localMessage = { ...newMessage, text: message };

      await webSocketService.send(newMessage);
      setMessages(prev => {
        if (prev.some(m => m.id === newMessage.id)) return prev;
        return [...prev, localMessage].sort((a, b) => a.timestamp - b.timestamp);
      });
      setInput('');
      await updateContactsWithLastMessage(localMessage);
      logEncryptionEvent('Message sent successfully', { messageId: newMessage.id });
    } catch (error) {
      const encryptionError: EncryptionError = {
        message: 'Error sending message',
        details: (error as Error).message,
        timestamp: Date.now()
      };
      logEncryptionEvent('Send message failed', encryptionError);
      alert(`Failed to send message: ${(error as Error).message}`);
    }
  };

  const initializeKeys = async () => {
    try {
      const savedKeyPair = localStorage.getItem('tweetnaclKeyPair');
      if (savedKeyPair) {
        const parsedKeyPair = JSON.parse(savedKeyPair);
        setTweetNaclKeyPair({
          publicKey: new Uint8Array(Object.values(parsedKeyPair.publicKey)),
          secretKey: new Uint8Array(Object.values(parsedKeyPair.secretKey))
        });
        setIsKeysLoaded(true);
        logEncryptionEvent('Keys loaded from storage');
        return;
      }

      const newKeyPair = nacl.box.keyPair();
      setTweetNaclKeyPair(newKeyPair);
      localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
        publicKey: Array.from(newKeyPair.publicKey),
        secretKey: Array.from(newKeyPair.secretKey)
      }));
      setIsKeysLoaded(true);
      logEncryptionEvent('New keys generated and stored');
    } catch (error) {
      console.error('Error initializing keys:', error);
      alert('Failed to initialize encryption keys: ' + (error as Error).message);
    }
  };

  const fetchData = async () => {
    try {
      const chatsRes = await fetchChats(userId!);
      const sortedChats = chatsRes.data.sort((a, b) =>
        (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
      );

      const chatsWithDecryptedLastMessages = await Promise.all(
        sortedChats.map(async (chat) => {
          if (chat.lastMessage) {
            try {
              chat.lastMessage.text = await decryptMessageText(chat.lastMessage);
            } catch (error) {
              chat.lastMessage.text = 'Encrypted message';
              logEncryptionEvent('Failed to decrypt message in chat list', {
                error: (error as Error).message,
                chatId: chat.id,
                messageId: chat.lastMessage.id
              });
            }
          }
          return chat;
        })
      );
      setContacts(chatsWithDecryptedLastMessages);

      if (selectedChatId) {
        const messagesRes = await fetchMessages(userId!, selectedChatId);
        const decryptedMessages = await Promise.all(
          messagesRes.data.map(async (msg) => {
            try {
              const text = await decryptMessageText(msg);
              return { ...msg, isMine: msg.userId === userId, text };
            } catch (error) {
              logEncryptionEvent('Decryption failed for message', { msgId: msg.id, error });
              return { ...msg, isMine: msg.userId === userId, text: '[Decryption Failed]', encryptedText: msg.text };
            }
          })
        );
        setMessages(decryptedMessages.sort((a, b) => a.timestamp - b.timestamp));
        await markAsRead(userId!, selectedChatId);
      }
    } catch (err) {
      console.error('Fetch data error:', (err as AxiosError).message);
    }
  };

  useEffect(() => {
    if (!userId) return;

    if (!tweetNaclKeyPair) {
      initializeKeys().then(() => {
        fetchData();
      });
      return;
    }

    if (isKeysLoaded) {
      fetchData();
      const interval = setInterval(() => fetchData(), 5000);
      return () => clearInterval(interval);
    }
  }, [userId, selectedChatId, tweetNaclKeyPair, isKeysLoaded]);

  useEffect(() => {
    if (!userId || !tweetNaclKeyPair || !isKeysLoaded) return;

    webSocketService.connect(userId, async (msg: Message | { type: string; userId: string; contactId: string }) => {
      if ('type' in msg && msg.type === 'read') {
        setMessages(prev =>
          prev.map(m =>
            m.contactId === msg.userId && m.userId === msg.contactId && m.isRead === 0
              ? { ...m, isRead: 1 }
              : m
          )
        );
        setContacts(prev =>
          prev.map(c => ({
            ...c,
            lastMessage: c.lastMessage && c.lastMessage.contactId === msg.userId && c.lastMessage.isRead === 0
              ? { ...c.lastMessage, isRead: 1 }
              : c.lastMessage,
          }))
        );
        return;
      }

      const newMsg = msg as Message;
      const isMine = newMsg.userId === userId;
      newMsg.isMine = isMine;

      if ((newMsg.userId === selectedChatId && newMsg.contactId === userId) ||
          (newMsg.contactId === selectedChatId && newMsg.userId === userId)) {
        await handleIncomingMessage(newMsg);
      }
    });

    return () => webSocketService.disconnect();
  }, [userId, selectedChatId, tweetNaclKeyPair, isKeysLoaded]);

  useEffect(() => {
    if (!searchQuery || !userId) {
      setSearchResults([]);
      return;
    }

    const search = async () => {
      try {
        const res = await axios.get<Contact[]>(`http://192.168.31.185:4000/search?query=${searchQuery}`);
        setSearchResults(res.data.filter(c => c.id !== userId));
      } catch (err) {
        console.error('Search error:', (err as AxiosError).message);
      }
    };
    search();
  }, [searchQuery, userId]);

  useEffect(() => {
    if (selectedChatId) {
      localStorage.setItem('selectedChatId', selectedChatId);
      isInitialMount.current = true;
    } else {
      localStorage.removeItem('selectedChatId');
    }
  }, [selectedChatId]);

  useEffect(() => {
    if (chatRef.current && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: isInitialMount.current ? 'auto' : 'smooth' });
      isInitialMount.current = false;
    }
  }, [messages]);

  const handleAuth = async (isLogin: boolean) => {
    if (!email || !password) return alert('Fill in all fields');
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);

    try {
      const endpoint = isLogin ? '/login' : '/register';
      const res = await axios.post<{ id: string; publicKey?: string }>(
        `http://192.168.31.185:4000${endpoint}`,
        { email, password: hashedPassword }
      );

      if (!isLogin) {
        const newKeyPair = nacl.box.keyPair();
        const publicKey = Buffer.from(newKeyPair.publicKey).toString('base64');
        await axios.put('http://192.168.31.185:4000/update-keys', { userId: res.data.id, publicKey });
        setTweetNaclKeyPair(newKeyPair);
        setIsKeysLoaded(true);
        localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
          publicKey: Array.from(newKeyPair.publicKey),
          secretKey: Array.from(newKeyPair.secretKey),
        }));
      }

      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userEmail', email);
      setUserId(res.data.id);
      setUserEmail(email);
      alert(isLogin ? 'Login successful!' : 'Registration successful!');
    } catch (err) {
      console.error('Auth error:', err);
      const axiosError = err as AxiosError<ApiErrorResponse>;
      const errorMessage = axiosError.response?.data?.error || axiosError.message || 'Unknown error';
      alert(`Error: ${errorMessage}`);
    }
  };

  const handleContactSelect = async (contact: Contact) => {
    setSelectedChatId(contact.id);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);

    setContacts(prev => {
      const contactExists = prev.some(c => c.id === contact.id);
      if (!contactExists) {
        return [...prev, { ...contact, lastMessage: null }].sort(
          (a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
        );
      }
      return prev;
    });

    if (userId && tweetNaclKeyPair && isKeysLoaded) {
      try {
        const messagesRes = await fetchMessages(userId, contact.id);
        const decryptedMessages = await Promise.all(messagesRes.data.map(async msg => {
          try {
            const text = await decryptMessageText(msg);
            return { ...msg, isMine: msg.userId === userId, text };
          } catch (error) {
            logEncryptionEvent('Decryption failed on contact select', { msgId: msg.id, error });
            return { ...msg, isMine: msg.userId === userId, text: '[Decryption Failed]', encryptedText: msg.text };
          }
        }));
        setMessages(decryptedMessages.sort((a, b) => a.timestamp - b.timestamp));
        await markAsRead(userId, contact.id);
      } catch (err) {
        console.error('Error fetching messages on contact select:', err);
      }
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
    webSocketService.disconnect();
  };

  const handleUpdate = () => {
    window.location.reload();
  };

  const themeClass = isDarkTheme ? 'bg-black text-light' : 'bg-light text-dark';
  const selectedContact = contacts.find(c => c.id === selectedChatId) || searchResults.find(c => c.id === selectedChatId) || null;

  if (!userId) {
    return (
      <div className={`container vh-100 d-flex flex-column justify-content-center ${themeClass} p-3`}>
        <h3 className="text-center mb-4">My Messenger</h3>
        <input
          type="email"
          className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button className="btn btn-primary w-100 mb-2" onClick={() => handleAuth(true)}>Login</button>
        <button className="btn btn-secondary w-100" onClick={() => handleAuth(false)}>Register</button>
      </div>
    );
  }

  return (
    <div
      className={`d-flex flex-column ${themeClass}`}
      style={{
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
      }}
    >
      <style>
        {`
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .message-enter { animation: slideIn 0.3s ease-out forwards; }
          .input-placeholder-dark::placeholder { color: #b0b0b0; }
          .search-placeholder-dark::placeholder { color: #b0b0b0; }
          .chat-item {
            display: flex;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid ${isDarkTheme ? '#444' : '#eee'};
            cursor: pointer;
          }
          .chat-item:hover { background: ${isDarkTheme ? '#444' : '#f8f9fa'}; }
          .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: ${isDarkTheme ? '#6c757d' : '#e9ecef'};
            color: ${isDarkTheme ? '#fff' : '#212529'};
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 10px;
          }
          .scroll-container {
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: ${isDarkTheme ? '#6c757d #212529' : '#dee2e6 #fff'};
          }
          .scroll-container::-webkit-scrollbar { width: 8px; }
          .scroll-container::-webkit-scrollbar-track { background: ${isDarkTheme ? '#212529' : '#fff'}; }
          .scroll-container::-webkit-scrollbar-thumb {
            background: ${isDarkTheme ? '#6c757d' : '#dee2e6'};
            border-radius: 4px;
          }
          .scroll-container::-webkit-scrollbar-thumb:hover {
            background: ${isDarkTheme ? '#868e96' : '#adb5bd'};
          }
          .unread-text { font-weight: bold; }
          .chat-timestamp {
            color: ${isDarkTheme ? '#b0b0b0' : '#6c757d'};
            font-size: 0.7rem;
          }
        `}
      </style>

      <div
        className="p-2"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: isDarkTheme ? 'rgba(33, 37, 41, 0.95)' : 'rgba(255, 255, 255, 0.95)',
          zIndex: 20,
          height: selectedChatId ? "90px" : "50px",
        }}
      >
        <div className="d-flex justify-content-between align-items-center">
          <div style={{ position: 'relative' }}>
            <h5 className="m-0" style={{ cursor: 'pointer' }} onClick={() => setIsMenuOpen(!isMenuOpen)}>
              MSNGR ({userEmail})
            </h5>
            {isMenuOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: 55,
                  left: 10,
                  background: isDarkTheme ? '#212529' : '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  zIndex: 1000,
                  padding: '5px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                <button
                  className="btn btn-sm btn-success mb-2"
                  onClick={handleUpdate}
                  style={{ width: '150px', fontSize: '0.875rem' }}
                >
                  <FaSync /> Update
                </button>
                <button
                  className="btn btn-sm btn-outline-danger"
                  onClick={handleLogout}
                  style={{ width: '150px', fontSize: '0.875rem' }}
                >
                  <FaSignOutAlt /> Logout
                </button>
              </div>
            )}
          </div>
          <div>
            <button className="btn btn-sm btn-outline-secondary me-2" onClick={() => setIsSearchOpen(!isSearchOpen)}>
              <FaSearch />
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setIsDarkTheme(!isDarkTheme)}>
              {isDarkTheme ? <FaMoon /> : <FaSun />}
            </button>
          </div>
        </div>
        {selectedChatId && (
          <div className="p-2 d-flex align-items-center mt-1">
            <button
              className="btn btn-sm btn-outline-secondary me-2"
              onClick={() => setSelectedChatId(null)}
              style={{ border: 'none', background: 'transparent' }}
            >
              <FaArrowLeft />
            </button>
            <div
              className="rounded-circle me-2 d-flex align-items-center justify-content-center"
              style={{
                width: '25px',
                height: '25px',
                background: isDarkTheme ? '#6c757d' : '#e9ecef',
                color: isDarkTheme ? '#fff' : '#212529',
              }}
            >
              {selectedContact?.email.charAt(0).toUpperCase() || '?'}
            </div>
            <h6 className="m-0">{selectedContact?.email || 'Loading...'}</h6>
          </div>
        )}
      </div>

      {isSearchOpen && (
        <div
          style={{
            position: 'fixed',
            top: selectedChatId ? 90 : 50,
            left: 0,
            right: 0,
            background: isDarkTheme ? 'rgba(33, 37, 41, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            zIndex: 30,
            padding: '0',
          }}
        >
          <div className="container p-2">
            <input
              type="text"
              className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light search-placeholder-dark' : ''}`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search users..."
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: selectedChatId ? 'calc(100vh - 150px)' : 'calc(100vh - 90px)' }}>
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

      <div
        ref={chatRef}
        className="flex-grow-1"
        style={{
          position: 'absolute',
          top: selectedChatId ? 90 : 50,
          bottom: selectedChatId ? 60 : 0,
          left: 0,
          right: 0,
          overflow: 'hidden',
        }}
      >
        {selectedChatId ? (
          <div
            className="p-3 scroll-container"
            style={{
              height: 'calc(100% - 60px)',
              overflowY: 'auto',
              filter: isSearchOpen ? 'blur(5px)' : 'none',
              transition: 'filter 0.3s',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ flexGrow: 1 }} />
            {messages.length > 0 ? (
              <>
                {messages.map((msg, index) => (
                  <div
                    key={msg.id}
                    className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2 message-enter`}
                  >
                    <div
                      className={`p-2 rounded-3 ${
                        msg.isMine
                          ? 'bg-primary text-white'
                          : isDarkTheme ? 'bg-secondary text-white' : 'bg-light border'
                      }`}
                      style={{
                        maxWidth: '75%',
                        position: 'relative',
                        borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        wordBreak: 'break-word',
                      }}
                    >
                      <div>
                        {msg.text === '[Decryption Failed]' ? (
                          <>
                            {msg.text}
                            <button
                              className="btn btn-sm btn-link p-0 ms-2"
                              onClick={() => retryDecryption(msg.id)}
                              style={{ color: isDarkTheme ? '#fff' : '#007bff' }}
                            >
                              Retry
                            </button>
                          </>
                        ) : (
                          msg.text
                        )}
                      </div>
                      <div className="text-end mt-1" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {msg.isMine && (
                          <span style={{ marginLeft: '5px' }}>
                            {msg.isRead === 1 ? '✓✓' : '✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} style={{ height: '1px' }} />
              </>
            ) : (
              <div className="text-muted text-center" style={{ marginBottom: '10px' }}>
                No messages yet. Start your conversation!
              </div>
            )}
          </div>
        ) : (
          <ChatList
            contacts={contacts}
            selectedChatId={selectedChatId}
            isDarkTheme={isDarkTheme}
            onSelectChat={handleContactSelect}
          />
        )}
      </div>

      {selectedChatId && (
        <div
          className="p-2"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: isDarkTheme ? 'rgba(33, 37, 41, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            zIndex: 10,
            height: '49px',
            display: 'flex',
            alignItems: 'center',
            borderTop: isDarkTheme ? '1px solid #444' : '1px solid #eee',
          }}
        >
          <div className="d-flex align-items-center w-100 px-2">
            <input
              type="text"
              className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light input-placeholder-dark' : ''}`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && sendMessage()}
              placeholder="Message..."
              style={{ borderRadius: '20px', color: isDarkTheme ? '#fff' : '#000' }}
            />
            <button
              className="btn btn-primary ms-2 d-flex align-items-center justify-content-center"
              onClick={sendMessage}
              style={{ borderRadius: '20px', minWidth: '60px', height: '38px' }}
              disabled={!input.trim() || !tweetNaclKeyPair || !isKeysLoaded}
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