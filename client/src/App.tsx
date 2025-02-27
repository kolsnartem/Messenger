import React, { useState, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import * as signal from '@privacyresearch/libsignal-protocol-typescript';
import * as CryptoJS from 'crypto-js';

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
}

interface Contact {
  id: string;
  email: string;
  publicKey: string;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('userId'));
  const [identityKeyPair, setIdentityKeyPair] = useState<IdentityKeyPair | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initSignal = async () => {
      try {
        console.log('Initializing Signal...');
        const storedKeyPair = localStorage.getItem('signalKeyPair');
        if (storedKeyPair) {
          const parsed = JSON.parse(storedKeyPair);
          setIdentityKeyPair({
            pubKey: Buffer.from(parsed.publicKey, 'base64'),
            privKey: Buffer.from(parsed.privateKey, 'base64'),
          });
        }
      } catch (err) {
        const error = err as Error;
        console.error('Error in initSignal:', error.message);
      }
    };
    initSignal();
  }, []);

  useEffect(() => {
    if (userId) {
      const fetchContacts = async () => {
        try {
          const res = await axios.get<Contact[]>('http://192.168.31.185:4000/users');
          setContacts(res.data.filter(c => c.id !== userId));
        } catch (err) {
          const error = err as AxiosError<{ error?: string }>;
          console.error('Failed to fetch contacts:', error.response?.data?.error || error.message);
        }
      };
      fetchContacts();
    }
  }, [userId]);

  useEffect(() => {
    if (userId && selectedChatId) {
      const fetchMessages = async () => {
        try {
          const res = await axios.get<Message[]>(
            `http://192.168.31.185:4000/messages?userId=${userId}&contactId=${selectedChatId}`
          );
          setMessages(res.data);
          if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight; // Автоскрол донизу
          }
        } catch (err) {
          const error = err as AxiosError<{ error?: string }>;
          console.error('Failed to fetch messages:', error.response?.data?.error || error.message);
        }
      };
      fetchMessages();
    }
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (searchQuery) {
      const searchUsers = async () => {
        try {
          const res = await axios.get<Contact[]>(`http://192.168.31.185:4000/search?query=${searchQuery}`);
          setSearchResults(res.data.filter(c => c.id !== userId));
        } catch (err) {
          const error = err as AxiosError<{ error?: string }>;
          console.error('Failed to search users:', error.response?.data?.error || error.message);
        }
      };
      searchUsers();
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, userId]);

  const generateKeyPair = async (): Promise<IdentityKeyPair> => {
    const keyPair = await signal.KeyHelper.generateIdentityKeyPair();
    const publicKeySerialized = Buffer.from(keyPair.pubKey).toString('base64');
    const privateKeySerialized = Buffer.from(keyPair.privKey).toString('base64');
    const keyPairSerialized = {
      publicKey: publicKeySerialized,
      privateKey: privateKeySerialized,
    };
    localStorage.setItem('signalKeyPair', JSON.stringify(keyPairSerialized));
    return keyPair;
  };

  const handleRegister = async () => {
    if (!email || !password) return alert('Заповніть усі поля');
    try {
      console.log('Starting registration with email:', email);
      const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
      const keys = await generateKeyPair();
      const publicKeySerialized = Buffer.from(keys.pubKey).toString('base64');
      console.log('Sending register request:', { email, password: hashedPassword, publicKey: publicKeySerialized });
      const res = await axios.post<{ id: string }>('http://192.168.31.185:4000/register', {
        email,
        password: hashedPassword,
        publicKey: publicKeySerialized,
      });
      console.log('Register response:', res.data);
      localStorage.setItem('userId', res.data.id);
      setUserId(res.data.id);
      setIdentityKeyPair(keys);
      console.log('Registered userId:', res.data.id);
      alert('Реєстрація успішна!');
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      console.error('Registration failed:', error.response?.data?.error || error.message);
      alert('Помилка реєстрації: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleLogin = async () => {
    if (!email || !password) return alert('Заповніть усі поля');
    try {
      console.log('Starting login with email:', email);
      console.log('Sending login request:', { email, password });
      const res = await axios.post<{ id: string; publicKey: string }>('http://192.168.31.185:4000/login', {
        email,
        password,
      });
      console.log('Login response:', res.data);
      const storedKeyPair = localStorage.getItem('signalKeyPair');
      if (!storedKeyPair) return alert('Приватний ключ втрачено. Потрібна повторна реєстрація.');
      const parsed = JSON.parse(storedKeyPair);
      setIdentityKeyPair({
        pubKey: Buffer.from(parsed.publicKey, 'base64'),
        privKey: Buffer.from(parsed.privateKey, 'base64'),
      });
      localStorage.setItem('userId', res.data.id);
      setUserId(res.data.id);
      console.log('Logged in userId:', res.data.id);
      alert('Вхід успішний!');
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      console.error('Login failed:', error.response?.data?.error || error.message);
      alert('Помилка входу: ' + (error.response?.data?.error || error.message));
    }
  };

  const sendMessage = async () => {
    if (!input || !userId || !selectedChatId) return;
    try {
      const res = await axios.post<{ id: string }>('http://192.168.31.185:4000/messages', {
        userId,
        contactId: selectedChatId,
        text: input,
        timestamp: Date.now(),
      });
      setMessages(prev => [
        ...prev,
        { id: res.data.id, userId, contactId: selectedChatId, text: input, timestamp: Date.now() },
      ]);
      setInput('');
      if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight; // Автоскрол донизу
      }
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      console.error('Failed to send message:', error.response?.data?.error || error.message);
      alert('Помилка відправки: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') sendMessage();
  };

  const handleContactSelect = (contact: Contact) => {
    setSelectedChatId(contact.id);
    setSearchQuery('');
    setSearchResults([]);
    if (!contacts.some(c => c.id === contact.id)) {
      setContacts(prev => [...prev, contact]);
    }
  };

  const themeClass = isDarkTheme ? 'bg-dark text-light' : 'bg-light text-dark';
  const hasConversations = contacts.some(contact => messages.some(msg => msg.contactId === contact.id || msg.userId === contact.id));

  if (!userId || !identityKeyPair) {
    return (
      <div className={`container vh-100 d-flex flex-column justify-content-center ${themeClass} p-3`}>
        <h3 className="text-center mb-4">Мій месенджер</h3>
        <div className="mb-3">
          <input
            type="email"
            className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Електронна пошта"
            autoComplete="email"
          />
          <input
            type="password"
            className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Пароль"
            autoComplete="current-password"
          />
          <button className="btn btn-primary w-100 mb-2" onClick={handleLogin}>
            Увійти
          </button>
          <button className="btn btn-secondary w-100" onClick={handleRegister}>
            Зареєструватися
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`container vh-100 d-flex flex-column py-2 ${themeClass} p-3`}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h4 className="m-0">Мої чати</h4>
        <button
          className={`btn btn-sm btn-outline-${isDarkTheme ? 'light' : 'dark'}`}
          onClick={() => setIsDarkTheme(!isDarkTheme)}
        >
          {isDarkTheme ? 'Світла' : 'Темна'}
        </button>
      </div>
      <div className="mb-2">
        <input
          type="text"
          className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Пошук користувачів..."
        />
        {searchResults.length > 0 && (
          <div className="mt-1" style={{ maxHeight: '20vh', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '5px' }}>
            {searchResults.map(result => (
              <div
                key={result.id}
                className={`p-2 ${isDarkTheme ? 'bg-secondary' : 'bg-light'} border-bottom`}
                onClick={() => handleContactSelect(result)}
                style={{ cursor: 'pointer' }}
              >
                {result.email}
              </div>
            ))}
          </div>
        )}
      </div>
      {hasConversations ? (
        <>
          <div className="mb-2" style={{ maxHeight: '30vh', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '5px' }}>
            {contacts
              .filter(contact => messages.some(msg => msg.contactId === contact.id || msg.userId === contact.id))
              .map(contact => (
                <div
                  key={contact.id}
                  className={`p-2 ${isDarkTheme ? 'bg-secondary' : 'bg-light'} border-bottom ${
                    selectedChatId === contact.id ? 'bg-primary text-white' : ''
                  }`}
                  onClick={() => setSelectedChatId(contact.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {contact.email}
                </div>
              ))}
          </div>
          <div
            ref={chatRef}
            className={`chat flex-grow-1 overflow-auto mb-2 p-3 rounded border ${
              isDarkTheme ? 'bg-secondary text-light' : 'bg-light text-dark'
            }`}
          >
            {selectedChatId ? (
              messages.length > 0 ? (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`d-flex mb-2 ${msg.userId === userId ? 'justify-content-end' : 'justify-content-start'}`}
                  >
                    <div
                      className={`p-2 rounded ${
                        msg.userId === userId
                          ? 'bg-primary text-white'
                          : isDarkTheme
                          ? 'bg-dark text-light'
                          : 'bg-secondary text-white'
                      }`}
                      style={{ maxWidth: '70%', wordBreak: 'break-word' }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center">Немає повідомлень</p>
              )
            ) : (
              <p className="text-center">Виберіть чат</p>
            )}
          </div>
          {selectedChatId && (
            <div className="input-group">
              <input
                type="text"
                className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Повідомлення..."
              />
              <button className="btn btn-primary" onClick={sendMessage}>
                Надіслати
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex-grow-1 d-flex justify-content-center align-items-center">
          <button className="btn btn-primary" onClick={() => setSearchQuery('')}>
            Пошук
          </button>
        </div>
      )}
    </div>
  );
};

export default App;