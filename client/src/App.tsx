import React, { useState, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import * as signal from '@privacyresearch/libsignal-protocol-typescript';
import * as CryptoJS from 'crypto-js';
import { FaSearch, FaSun, FaMoon, FaSignOutAlt } from 'react-icons/fa';

interface IdentityKeyPair { pubKey: ArrayBuffer; privKey: ArrayBuffer }
interface Message { id: string; userId: string; contactId: string; text: string; timestamp: number; isMine: boolean }
interface Contact { id: string; email: string; publicKey: string }

const App: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('userId'));
  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem('userEmail'));
  const [identityKeyPair, setIdentityKeyPair] = useState<IdentityKeyPair | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isScrolledUp = useRef(false);

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
    };
    init();
  }, []);

  useEffect(() => {
    if (!userId) return;

    wsRef.current = new WebSocket('ws://192.168.31.185:4000');
    wsRef.current.onmessage = (event) => {
      const msg: Message = JSON.parse(event.data);
      if ((msg.userId === selectedChatId && msg.contactId === userId) || 
          (msg.contactId === selectedChatId && msg.userId === userId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          const updated = [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
          if (chatRef.current && !isScrolledUp.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
          }
          return updated;
        });
      }
    };

    return () => { wsRef.current?.close(); };
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (!userId) return;

    const fetchData = async () => {
      const [contactsRes, messagesRes] = await Promise.all([
        axios.get<Contact[]>('http://192.168.31.185:4000/users'),
        selectedChatId 
          ? axios.get<Message[]>(`http://192.168.31.185:4000/messages?userId=${userId}&contactId=${selectedChatId}`)
          : Promise.resolve({ data: [] as Message[] })
      ]);
      
      setContacts(contactsRes.data.filter(c => c.id !== userId));
      setMessages(messagesRes.data.sort((a, b) => a.timestamp - b.timestamp));
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    };

    fetchData();
    const interval = setInterval(() => selectedChatId && fetchData(), 5000);
    return () => clearInterval(interval);
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (!searchQuery || !userId) return setSearchResults([]);
    
    const search = async () => {
      const res = await axios.get<Contact[]>(`http://192.168.31.185:4000/search?query=${searchQuery}`);
      setSearchResults(res.data.filter(c => c.id !== userId));
    };
    search();
  }, [searchQuery, userId]);

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

  const sendMessage = async () => {
    if (!input.trim() || !userId || !selectedChatId) return;
    
    const newMessage: Message = {
      id: Date.now().toString(),
      userId,
      contactId: selectedChatId,
      text: input.trim(),
      timestamp: Date.now(),
      isMine: true,
    };

    setInput('');
    try {
      await axios.post('http://192.168.31.185:4000/messages', newMessage);
      if (chatRef.current && !isScrolledUp.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    } catch (err) {
      alert('Sending error');
    }
  };

  const handleContactSelect = (contact: Contact) => {
    setSelectedChatId(contact.id);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('userEmail');
    setUserId(null);
    setUserEmail(null);
    setIdentityKeyPair(null);
    setSelectedChatId(null);
    setMessages([]);
    setContacts([]);
  };

  const themeClass = isDarkTheme ? 'bg-black text-light' : 'bg-light text-dark';
  const selectedContact = contacts.find(c => c.id === selectedChatId);

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
    <div className={`d-flex flex-column ${themeClass}`} style={{ height: '100vh' }}>
      <div className="p-2 border-bottom" style={{ position: 'sticky', top: 0, background: isDarkTheme ? '#212529' : '#fff' }}>
        <div className="d-flex justify-content-between align-items-center">
          <div style={{ position: 'relative' }}>
            <h4 className="m-0" style={{ cursor: 'pointer' }} onClick={() => setIsMenuOpen(!isMenuOpen)}>
              MSNGR ({userEmail})
            </h4>
            {isMenuOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, background: isDarkTheme ? '#212529' : '#fff', border: '1px solid #ccc', borderRadius: '4px', zIndex: 10 }}>
                <button className="btn btn-sm btn-outline-danger w-100" onClick={handleLogout}>
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
          <h6 className="m-0 text-center mt-2 border-top pt-2">Chat with {selectedContact?.email || 'unknown'}</h6>
        )}
      </div>

      {isSearchOpen && (
        <div className="p-2 border-bottom" style={{ position: 'sticky', top: selectedChatId ? 100 : 60, background: isDarkTheme ? '#212529' : '#fff' }}>
          <input
            type="text"
            className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search users..."
          />
          {searchResults.map(result => (
            <div
              key={result.id}
              className="p-2 border-bottom"
              onClick={() => handleContactSelect(result)}
              style={{ cursor: 'pointer' }}
            >
              {result.email}
            </div>
          ))}
        </div>
      )}

      <div ref={chatRef} className="flex-grow-1 overflow-auto p-2" onScroll={() => {
        if (chatRef.current) isScrolledUp.current = chatRef.current.scrollHeight - chatRef.current.scrollTop > chatRef.current.clientHeight + 60;
      }}>
        {selectedChatId ? (
          messages.length ? messages.map(msg => (
            <div key={msg.id} className={`d-flex mb-2 ${msg.isMine ? 'justify-content-end' : ''}`}>
              <div className={`p-2 rounded ${msg.isMine ? 'bg-primary text-white' : 'bg-gray-300'}`}>
                {msg.text}
                <small className="d-block mt-1 text-muted">{new Date(msg.timestamp).toLocaleTimeString()}</small>
              </div>
            </div>
          )) : <p className="text-center">No messages</p>
        ) : <p className="text-center">Select a chat</p>}
      </div>

      {selectedChatId && (
        <div className="p-2 border-top" style={{ position: 'sticky', bottom: 0, background: isDarkTheme ? '#212529' : '#fff' }}>
          <style>
            {`
              .message-input::placeholder {
                color: ${isDarkTheme ? '#aaa' : '#888'};
              }
            `}
          </style>
          <div className="d-flex">
            <input
              type="text"
              className={`form-control me-2 message-input ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
              style={{ color: isDarkTheme ? '#fff' : '#000' }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && sendMessage()}
              placeholder="Message..."
            />
            <button className="btn btn-primary" onClick={sendMessage}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;