import React, { useState, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import * as signal from '@privacyresearch/libsignal-protocol-typescript';
import * as CryptoJS from 'crypto-js';
import { FaSearch, FaSun, FaMoon, FaSignOutAlt, FaSync, FaArrowLeft } from 'react-icons/fa';

interface IdentityKeyPair {
  pubKey: ArrayBuffer;
  privKey: ArrayBuffer;
}

interface Message {
  id: string;
  userId: string;
  contactId: string;
  text: string;
  timestamp: number;
  isMine?: boolean;
}

interface Contact {
  id: string;
  email: string;
  publicKey: string;
  lastMessage?: Message;
}

const App: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem('userId'));
  const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem('userEmail'));
  const [identityKeyPair, setIdentityKeyPair] = useState<IdentityKeyPair | null>(null);
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
  const [isLoading, setIsLoading] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isInitialMount = useRef(true);
  const prevMessageCount = useRef(0);

  useEffect(() => {
    const init = async () => {
      const storedKeyPair = localStorage.getItem('signalKeyPair');
      if (storedKeyPair) {
        const { publicKey, privateKey } = JSON.parse(storedKeyPair);
        setIdentityKeyPair({
          pubKey: Buffer.from(publicKey, 'base64'),
          privKey: Buffer.from(privateKey, 'base64'),
        });
      }
      setIsLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (!userId || !selectedChatId || !chatRef.current) return;

    const scrollToPosition = () => {
      if (messages.length === 0 && anchorRef.current) {
        anchorRef.current.scrollIntoView({ behavior: 'auto' });
      } else if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: isInitialMount.current ? 'auto' : 'smooth' });
      }
    };

    scrollToPosition();
    if (isInitialMount.current) {
      isInitialMount.current = false;
    }
    prevMessageCount.current = messages.length;
  }, [messages, selectedChatId, userId]);

  useEffect(() => {
    if (!userId) return;

    wsRef.current = new WebSocket(`ws://192.168.31.185:4000?userId=${userId}`);
    wsRef.current.onopen = () => console.log('WebSocket connected');
    wsRef.current.onmessage = (event) => {
      const msg: Message = JSON.parse(event.data);
      if ((msg.userId === userId && msg.contactId === selectedChatId) || 
          (msg.contactId === userId && msg.userId === selectedChatId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          const newMsg = { ...msg, isMine: msg.userId === userId };
          return [...prev, newMsg].sort((a, b) => a.timestamp - b.timestamp);
        });
      }
      updateContactsWithLastMessage(msg);
    };
    wsRef.current.onerror = (err) => console.error('WebSocket error:', err);
    wsRef.current.onclose = () => console.log('WebSocket closed');

    return () => { wsRef.current?.close(); };
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (!userId) return;

    const fetchData = async () => {
      try {
        const [contactsRes, messagesRes, allMessagesRes] = await Promise.all([
          axios.get<Contact[]>('http://192.168.31.185:4000/users'),
          selectedChatId 
            ? axios.get<Message[]>(`http://192.168.31.185:4000/messages?userId=${userId}&contactId=${selectedChatId}`)
            : Promise.resolve({ data: [] as Message[] }),
          axios.get<Message[]>(`http://192.168.31.185:4000/messages?userId=${userId}`)
        ]);
        
        const allContacts = contactsRes.data.filter(c => c.id !== userId);
        const contactsWithLastMessage = allContacts.map(contact => {
          const lastMsg = allMessagesRes.data
            .filter(m => (m.userId === userId && m.contactId === contact.id) || (m.userId === contact.id && m.contactId === userId))
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          return { ...contact, lastMessage: lastMsg };
        }).sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));

        setContacts(contactsWithLastMessage);
        setMessages(messagesRes.data.map(msg => ({
          ...msg,
          isMine: msg.userId === userId
        })).sort((a, b) => a.timestamp - b.timestamp));
      } catch (err) {
        console.error('Fetch data error:', err);
      }
    };

    fetchData();
    const interval = setInterval(() => fetchData(), 5000);
    return () => clearInterval(interval);
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (!searchQuery || !userId) {
      setSearchResults([]);
      return;
    }
    
    const search = async () => {
      const res = await axios.get<Contact[]>(`http://192.168.31.185:4000/search?query=${searchQuery}`);
      setSearchResults(res.data.filter(c => c.id !== userId));
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

  const generateKeyPair = async (): Promise<IdentityKeyPair> => {
    const keyPair = await signal.KeyHelper.generateIdentityKeyPair();
    localStorage.setItem('signalKeyPair', JSON.stringify({
      publicKey: Buffer.from(keyPair.pubKey).toString('base64'),
      privateKey: Buffer.from(keyPair.privKey).toString('base64')
    }));
    return keyPair;
  };

  const handleAuth = async (isLogin: boolean) => {
    if (!email || !password) return alert('Fill in all fields');
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
    
    try {
      const endpoint = isLogin ? '/login' : '/register';
      const keys = isLogin ? identityKeyPair || await generateKeyPair() : await generateKeyPair();
      const publicKey = Buffer.from(keys.pubKey).toString('base64');
      
      const res = await axios.post<{ id: string; publicKey?: string }>(
        `http://192.168.31.185:4000${endpoint}`, 
        { email, password: hashedPassword, ...(isLogin ? {} : { publicKey }) }
      );

      if (isLogin && !identityKeyPair) {
        await axios.put('http://192.168.31.185:4000/update-keys', { userId: res.data.id, publicKey });
      }

      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userEmail', email);
      setUserId(res.data.id);
      setUserEmail(email);
      setIdentityKeyPair(keys);
      alert(isLogin ? 'Login successful!' : 'Registration successful!');
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !userId || !selectedChatId || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not open');
      alert('Connection lost. Please refresh the page.');
      return;
    }
    
    const newMessage: Message = {
      id: Date.now().toString(),
      userId,
      contactId: selectedChatId,
      text: input.trim(),
      timestamp: Date.now(),
      isMine: true,
    };

    setMessages(prev => {
      if (prev.some(m => m.id === newMessage.id)) return prev;
      return [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
    });
    setInput('');
    
    wsRef.current.send(JSON.stringify(newMessage));
  };

  const handleContactSelect = (contact: Contact) => {
    setSelectedChatId(contact.id);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleLogout = () => {
    localStorage.clear();
    setUserId(null);
    setUserEmail(null);
    setIdentityKeyPair(null);
    setSelectedChatId(null);
    setMessages([]);
    setContacts([]);
  };

  const handleUpdate = () => {
    window.location.reload();
  };

  const updateContactsWithLastMessage = (newMessage: Message) => {
    setContacts(prev => prev.map(contact => {
      if (contact.id === newMessage.contactId || contact.id === newMessage.userId) {
        return { ...contact, lastMessage: newMessage };
      }
      return contact;
    }).sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)));
  };

  const themeClass = isDarkTheme ? 'bg-black text-light' : 'bg-light text-dark';
  const selectedContact = contacts.find(c => c.id === selectedChatId) || null;

  if (isLoading) return null;

  if (!userId || !identityKeyPair) {
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
        overflow: 'hidden'
      }}
    >
      <style>
        {`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .message-enter {
            animation: slideIn 0.3s ease-out forwards;
          }
          .input-placeholder-dark::placeholder {
            color: #b0b0b0;
          }
          .chat-item {
            display: flex;
            align-items: center;
            padding: 10px;
            border-bottom: 1px solid ${isDarkTheme ? '#444' : '#eee'};
            cursor: pointer;
            width: 100%;
          }
          .chat-item:hover {
            background: ${isDarkTheme ? '#444' : '#f8f9fa'};
          }
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
          .scroll-container::-webkit-scrollbar {
            width: 8px;
          }
          .scroll-container::-webkit-scrollbar-track {
            background: ${isDarkTheme ? '#212529' : '#fff'};
          }
          .scroll-container::-webkit-scrollbar-thumb {
            background: ${isDarkTheme ? '#6c757d' : '#dee2e6'};
            border-radius: 4px;
          }
          .scroll-container::-webkit-scrollbar-thumb:hover {
            background: ${isDarkTheme ? '#868e96' : '#adb5bd'};
          }
        `}
      </style>

      {/* Header */}
      <div 
        className="p-2" 
        style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: isDarkTheme ? 'rgba(33, 37, 41, 0.95)' : 'rgba(255, 255, 255, 0.95)', 
          zIndex: 20,
          height: selectedChatId ? "90px" : "50px"
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
                color: isDarkTheme ? '#fff' : '#212529'
              }}
            >
              {selectedContact?.email.charAt(0).toUpperCase() || '?'}
            </div>
            <h6 className="m-0">{selectedContact?.email || 'Loading...'}</h6>
          </div>
        )}
      </div>

      {/* Search */}
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
              className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
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

      {/* Main content */}
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
                    className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2 ${
                      index >= prevMessageCount.current && !isInitialMount.current ? 'message-enter' : ''
                    }`}
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
                        wordBreak: 'break-word'
                      }}
                    >
                      <div>{msg.text}</div>
                      <div className="text-end mt-1" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
            <div ref={anchorRef} style={{ height: '1px' }} />
          </div>
        ) : (
          <div 
            className="scroll-container" 
            style={{ 
              height: '100%',
              overflowY: 'auto' 
            }}
          >
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="chat-item"
                onClick={() => handleContactSelect(contact)}
                style={{ width: '100%' }}
              >
                <div className="avatar">
                  {contact.email.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="fw-bold">{contact.email}</div>
                  {contact.lastMessage && (
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                      {contact.lastMessage.text.length > 20 ? `${contact.lastMessage.text.substring(0, 20)}...` : contact.lastMessage.text}
                      <span style={{ marginLeft: '10px', fontSize: '0.7rem' }}>
                        {new Date(contact.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input panel - Fixed positioning at the bottom */}
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
            borderTop: isDarkTheme ? '1px solid #444' : '1px solid #eee'
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
              disabled={!input.trim()}
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