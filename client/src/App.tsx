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

type ErrorWithMessage = { message: string };

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
  const chatRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  const updateContactsWithLastMessage = useCallback((newMessage: Message) => {
    setContacts(prev => {
      const contactId = newMessage.userId === userId ? newMessage.contactId : newMessage.userId;
      const existingContact = prev.find(c => c.id === contactId);
      if (existingContact) {
        return prev
          .map(c =>
            c.id === contactId
              ? { ...c, lastMessage: { ...newMessage, isMine: newMessage.userId === userId } }
              : c
          )
          .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
      }
      // Якщо контакту немає, додаємо його з публічним ключем
      const newContact = searchResults.find(c => c.id === contactId) || { id: contactId, email: '', publicKey: '' };
      return [...prev, { ...newContact, lastMessage: { ...newMessage, isMine: newMessage.userId === userId } }]
        .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
    });
  }, [userId, searchResults]);

  const cleanBase64 = (base64Str: string): string => {
    return base64Str.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
  };

  const fixPublicKey = (key: Uint8Array): Uint8Array => {
    if (key.length === 33) {
      console.warn('Public key has 33 bytes, trimming to 32 bytes');
      return key.slice(1);
    }
    if (key.length !== 32) {
      console.error(`Invalid public key size: expected 32 bytes, got ${key.length} bytes`);
      return key; // Повертаємо як є, щоб уникнути помилки
    }
    return key;
  };

  const encryptMessage = (text: string, contactPublicKey: string): string => {
    if (!tweetNaclKeyPair) throw new Error('TweetNaCl key pair not initialized');
    const cleanedPublicKey = cleanBase64(contactPublicKey || '');
    if (!cleanedPublicKey) {
      console.error('No public key available for encryption');
      return text; // Повертаємо нешифрований текст, якщо ключ недоступний
    }
    let theirPublicKeyBuffer;
    try {
      theirPublicKeyBuffer = Buffer.from(cleanedPublicKey, 'base64');
    } catch (error) {
      console.error(`Invalid Base64 public key: ${(error as Error).message}`);
      return text; // Повертаємо нешифрований текст у разі помилки
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
      console.error('Encryption failed');
      return text;
    }
    return `base64:${Buffer.from(new Uint8Array([...nonce, ...encrypted])).toString('base64')}`;
  };

  const decryptMessage = (encryptedText: string, senderId: string): string => {
    if (!tweetNaclKeyPair) {
      console.warn('TweetNaCl key pair not initialized yet, returning encrypted text');
      return encryptedText;
    }
    if (!encryptedText.startsWith('base64:')) return encryptedText;
    const base64Data = encryptedText.slice(7);
    const data = Buffer.from(base64Data, 'base64');
    const nonce = data.subarray(0, nacl.box.nonceLength);
    const cipher = data.subarray(nacl.box.nonceLength);

    const senderPublicKey = cleanBase64(contacts.find(c => c.id === senderId)?.publicKey || 
      searchResults.find(c => c.id === senderId)?.publicKey || '');
    if (!senderPublicKey) {
      console.error(`No public key found for sender ${senderId}`);
      return encryptedText;
    }
    let theirPublicKeyBuffer;
    try {
      theirPublicKeyBuffer = Buffer.from(senderPublicKey, 'base64');
    } catch (error) {
      console.error(`Invalid Base64 public key for sender ${senderId}: ${(error as Error).message}`);
      return encryptedText;
    }
    const theirPublicKey = fixPublicKey(new Uint8Array(theirPublicKeyBuffer));
    const decrypted = nacl.box.open(cipher, nonce, theirPublicKey, tweetNaclKeyPair.secretKey);
    if (!decrypted) {
      console.error(`Decryption failed for message from ${senderId}`);
      return encryptedText;
    }
    return new TextDecoder().decode(decrypted);
  };

  const initTweetNacl = (): TweetNaClKeyPair => {
    const storedKeyPair = localStorage.getItem('tweetnaclKeyPair');
    if (storedKeyPair) {
      const parsed = JSON.parse(storedKeyPair);
      const publicKey = new Uint8Array(parsed.publicKey);
      const secretKey = new Uint8Array(parsed.secretKey);
      if (publicKey.length !== 32 || secretKey.length !== 32) {
        console.error('Invalid stored TweetNaCl key pair, generating new one');
        const newKeyPair = nacl.box.keyPair();
        localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
          publicKey: Array.from(newKeyPair.publicKey),
          secretKey: Array.from(newKeyPair.secretKey),
        }));
        return newKeyPair;
      }
      return { publicKey, secretKey };
    } else {
      const newKeyPair = nacl.box.keyPair();
      localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
        publicKey: Array.from(newKeyPair.publicKey),
        secretKey: Array.from(newKeyPair.secretKey),
      }));
      return newKeyPair;
    }
  };

  useEffect(() => {
    if (!userId) return;

    let keyPair: TweetNaClKeyPair;
    try {
      keyPair = initTweetNacl();
      setTweetNaclKeyPair(keyPair);
    } catch (error) {
      console.error('Error initializing TweetNaCl keys:', error);
      alert('Failed to initialize encryption keys: ' + (error as Error).message);
      return;
    }

    const fetchData = async () => {
      try {
        const chatsRes = await fetchChats(userId);
        setContacts(chatsRes.data.sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)));

        if (selectedChatId) {
          const messagesRes = await fetchMessages(userId, selectedChatId);
          const decryptedMessages = messagesRes.data.map(msg => ({
            ...msg,
            isMine: msg.userId === userId,
            text: msg.text.startsWith('base64:') ? decryptMessage(msg.text, msg.userId) : msg.text,
          })).sort((a, b) => a.timestamp - b.timestamp);
          setMessages(decryptedMessages);
          await markAsRead(userId, selectedChatId);
        }
      } catch (err) {
        console.error('Fetch data error:', (err as AxiosError).message);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (!userId || !tweetNaclKeyPair) return;

    webSocketService.connect(userId, (msg: Message | { type: string; userId: string; contactId: string }) => {
      console.log('Received WebSocket message:', msg);
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
      const decryptedText = newMsg.text.startsWith('base64:') ? decryptMessage(newMsg.text, newMsg.userId) : newMsg.text;
      if ((newMsg.userId === userId && newMsg.contactId === selectedChatId) || 
          (newMsg.contactId === userId && newMsg.userId === selectedChatId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, { ...newMsg, isMine: newMsg.userId === userId, text: decryptedText }]
            .sort((a, b) => a.timestamp - b.timestamp);
        });
      }
      updateContactsWithLastMessage({ ...newMsg, text: decryptedText });
    });

    return () => webSocketService.disconnect();
  }, [userId, selectedChatId, tweetNaclKeyPair, updateContactsWithLastMessage]);

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
      alert(`Error: ${(err as AxiosError).response?.data?.error || (err as AxiosError).message || 'Unknown error'}`);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !userId || !selectedChatId || !tweetNaclKeyPair) return;
    
    const contact = contacts.find(c => c.id === selectedChatId) || searchResults.find(c => c.id === selectedChatId);
    if (!contact) {
      console.error(`No contact found for ID: ${selectedChatId}`);
      alert('Cannot send message: Contact not found.');
      return;
    }

    try {
      const encryptedText = encryptMessage(input.trim(), contact.publicKey || '');
      if (!encryptedText.startsWith('base64:')) {
        console.error('Encryption failed, sending unencrypted text');
      }
      const newMessage: Message = {
        id: Date.now().toString(),
        userId,
        contactId: selectedChatId,
        text: encryptedText,
        timestamp: Date.now(),
        isRead: 0,
        isMine: true,
      };

      await webSocketService.send(newMessage);
      const decryptedText = newMessage.text.startsWith('base64:') ? decryptMessage(newMessage.text, userId) : newMessage.text;
      setMessages(prev => {
        if (prev.some(m => m.id === newMessage.id)) return prev;
        return [...prev, { ...newMessage, text: decryptedText }].sort((a, b) => a.timestamp - b.timestamp);
      });
      setInput('');
      updateContactsWithLastMessage({ ...newMessage, text: decryptedText });
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message: ' + (error as Error).message);
    }
  };

  const handleContactSelect = async (contact: Contact) => {
    setSelectedChatId(contact.id);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    
    // Оновлюємо контакти, додаючи нового, якщо його ще немає
    setContacts(prev => {
      const contactExists = prev.some(c => c.id === contact.id);
      if (!contactExists) {
        return [...prev, { ...contact, lastMessage: null }].sort(
          (a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
        );
      }
      return prev;
    });

    if (userId && tweetNaclKeyPair) {
      try {
        const messagesRes = await fetchMessages(userId, contact.id);
        const decryptedMessages = messagesRes.data.map(msg => ({
          ...msg,
          isMine: msg.userId === userId,
          text: msg.text.startsWith('base64:') ? decryptMessage(msg.text, msg.userId) : msg.text,
        })).sort((a, b) => a.timestamp - b.timestamp);
        setMessages(decryptedMessages);
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
                      <div>{msg.text}</div>
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
              disabled={!input.trim() || !tweetNaclKeyPair}
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