import React, { useState, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import * as signal from '@privacyresearch/libsignal-protocol-typescript';
import * as CryptoJS from 'crypto-js';
import { FaSearch, FaSun, FaMoon } from 'react-icons/fa';

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
  isMine: boolean;
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
  const [userEmail, setUserEmail] = useState<string | null>(localStorage.getItem('userEmail'));
  const [identityKeyPair, setIdentityKeyPair] = useState<IdentityKeyPair | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Додано для анімації завантаження
  const chatRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const contactsRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isScrolledUp = useRef<boolean>(false);

  useEffect(() => {
    // Анімація завантаження сайту
    const timer = setTimeout(() => setIsLoading(false), 500); // Імітація завантаження
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const initSignal = async () => {
      const storedKeyPair = localStorage.getItem('signalKeyPair');
      if (storedKeyPair) {
        const parsed = JSON.parse(storedKeyPair);
        setIdentityKeyPair({
          pubKey: Buffer.from(parsed.publicKey, 'base64'),
          privKey: Buffer.from(parsed.privateKey, 'base64'),
        });
      }
    };
    initSignal();

    if (userId) {
      wsRef.current = new WebSocket('ws://192.168.31.185:4000');
      wsRef.current.onmessage = (event) => {
        const newMessage: Message = JSON.parse(event.data);
        if (
          (newMessage.userId === selectedChatId && newMessage.contactId === userId) ||
          (newMessage.contactId === selectedChatId && newMessage.userId === userId)
        ) {
          setMessages((prev) => {
            if (!prev.some((msg) => msg.id === newMessage.id)) {
              const updatedMessages = [...prev, newMessage].sort((b, a) => b.timestamp - a.timestamp); // Сортування знизу вгору
              if (chatRef.current && !isScrolledUp.current) {
                chatRef.current.scrollTop = chatRef.current.scrollHeight;
              }
              return updatedMessages;
            }
            return prev;
          });
        }
      };
      wsRef.current.onclose = () => {
        console.log('WebSocket closed');
        setTimeout(() => {
          if (!wsRef.current) {
            wsRef.current = new WebSocket('ws://192.168.31.185:4000');
          }
        }, 2000);
      };
      wsRef.current.onerror = (err) => console.error('WebSocket error:', err);
    }

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (userId) {
      const fetchContacts = async () => {
        const res = await axios.get<Contact[]>('http://192.168.31.185:4000/users');
        setContacts(res.data.filter((c) => c.id !== userId));
      };
      fetchContacts();

      const pollMessages = setInterval(async () => {
        if (selectedChatId) {
          const res = await axios.get<Message[]>(
            `http://192.168.31.185:4000/messages?userId=${userId}&contactId=${selectedChatId}`
          );
          const sortedMessages = res.data.sort((b, a) => b.timestamp - a.timestamp); // Сортування знизу вгору
          setMessages(sortedMessages);
        }
      }, 5000);

      return () => clearInterval(pollMessages);
    }
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (userId && selectedChatId) {
      const fetchMessages = async () => {
        const res = await axios.get<Message[]>(
          `http://192.168.31.185:4000/messages?userId=${userId}&contactId=${selectedChatId}`
        );
        const sortedMessages = res.data.sort((b, a) => b.timestamp - a.timestamp); // Сортування знизу вгору
        setMessages(sortedMessages);
        if (chatRef.current) {
          chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
      };
      fetchMessages();
    }
  }, [userId, selectedChatId]);

  useEffect(() => {
    if (searchQuery && userId) {
      const searchUsers = async () => {
        const res = await axios.get<Contact[]>(`http://192.168.31.185:4000/search?query=${searchQuery}`);
        setSearchResults(res.data.filter((c) => c.id !== userId));
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
    localStorage.setItem('signalKeyPair', JSON.stringify({ publicKey: publicKeySerialized, privateKey: privateKeySerialized }));
    return keyPair;
  };

  const handleRegister = async () => {
    if (!email || !password) return alert('Заповніть усі поля');
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
    const keys = await generateKeyPair();
    const publicKeySerialized = Buffer.from(keys.pubKey).toString('base64');
    const res = await axios.post<{ id: string }>('http://192.168.31.185:4000/register', {
      email,
      password: hashedPassword,
      publicKey: publicKeySerialized,
    });
    localStorage.setItem('userId', res.data.id);
    localStorage.setItem('userEmail', email);
    setUserId(res.data.id);
    setUserEmail(email);
    setIdentityKeyPair(keys);
    alert('Реєстрація успішна!');
  };

  const handleLogin = async () => {
    if (!email || !password) return alert('Заповніть усі поля');
    try {
      const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
      const res = await axios.post<{ id: string; publicKey: string }>('http://192.168.31.185:4000/login', {
        email,
        password: hashedPassword,
      });
      let keys: IdentityKeyPair;
      const storedKeyPair = localStorage.getItem('signalKeyPair');
      if (!storedKeyPair) {
        keys = await generateKeyPair();
        await axios.put(`http://192.168.31.185:4000/update-keys`, {
          userId: res.data.id,
          publicKey: Buffer.from(keys.pubKey).toString('base64'),
        });
      } else {
        const parsed = JSON.parse(storedKeyPair);
        keys = { pubKey: Buffer.from(parsed.publicKey, 'base64'), privKey: Buffer.from(parsed.privateKey, 'base64') };
      }
      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userEmail', email);
      setUserId(res.data.id);
      setUserEmail(email);
      setIdentityKeyPair(keys);
      alert('Вхід успішний!');
    } catch (err) {
      const error = err as AxiosError<{ error?: string }>;
      alert('Помилка входу: ' + (error.response?.data?.error || error.message));
    }
  };

  const sendMessage = async () => {
    if (!input || !userId || !selectedChatId) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      userId,
      contactId: selectedChatId,
      text: input,
      timestamp: Date.now(),
      isMine: true,
    };

    setInput('');
    try {
      await axios.post<{ id: string }>('http://192.168.31.185:4000/messages', newMessage);
      if (chatRef.current && !isScrolledUp.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
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
    setIsSearchOpen(false); // Явно закриваємо пошук при виборі чату
  };

  const toggleSearch = () => {
    setIsSearchOpen((prev) => !prev);
    if (!isSearchOpen) setSearchQuery('');
  };

  const handleScroll = () => {
    if (chatRef.current) {
      const isAtBottom = chatRef.current.scrollHeight - chatRef.current.scrollTop <= chatRef.current.clientHeight + 60;
      isScrolledUp.current = !isAtBottom;
    }
  };

  const themeClass = isDarkTheme ? 'bg-dark text-light' : 'bg-light text-dark';
  const selectedContact = contacts.find((c) => c.id === selectedChatId);

  if (!userId || !identityKeyPair) {
    return (
      <div className={`container vh-100 d-flex flex-column justify-content-center ${themeClass} p-3 ${isLoading ? 'loading' : ''}`}>
        <h3 className="text-center mb-4">Мій месенджер</h3>
        <div className="mb-3">
          <input
            type="email"
            className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Електронна пошта"
            autoComplete="email"
          />
          <input
            type="password"
            className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
    <div className={`d-flex flex-column ${themeClass} ${isLoading ? 'loading' : 'loaded'}`} style={{ height: '100vh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Фіксована верхня панель з анімацією */}
      <div ref={headerRef} className="d-flex justify-content-between align-items-center p-2 border-bottom" style={{ position: 'sticky', top: 0, zIndex: 1000, background: isDarkTheme ? '#212529' : '#fff', animation: 'slideDown 0.5s ease-in-out' }}>
        <h4 className="m-0" style={{ fontSize: '0.9rem' }}>Мої чати ({userEmail})</h4>
        <div className="d-flex align-items-center">
          <button className={`btn btn-sm btn-outline-${isDarkTheme ? 'light' : 'dark'} me-2`} onClick={toggleSearch} style={{ animation: 'fadeIn 0.5s ease-in-out' }}>
            <FaSearch />
          </button>
          <button className={`btn btn-sm btn-outline-${isDarkTheme ? 'light' : 'dark'}`} onClick={() => setIsDarkTheme(!isDarkTheme)} style={{ animation: 'fadeIn 0.5s ease-in-out 0.2s' }}>
            {isDarkTheme ? <FaMoon /> : <FaSun />}
          </button>
        </div>
      </div>

      {/* Пошук з анімацією (тільки вгорі, не в чаті) */}
      {isSearchOpen && (
        <div className="search-panel p-2 border-bottom" style={{ maxHeight: '20vh', overflowY: 'auto', transition: 'max-height 0.5s ease-in-out', animation: 'slideDown 0.5s ease-in-out' }}>
          <input
            type="text"
            className={`form-control ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Пошук користувачів..."
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="mt-2" style={{ maxHeight: '15vh', overflowY: 'auto', border: `1px solid ${isDarkTheme ? '#555' : '#ccc'}`, borderRadius: '5px' }}>
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className={`p-2 ${isDarkTheme ? 'bg-secondary' : 'bg-light'} border-bottom`}
                  onClick={() => handleContactSelect(result)}
                  style={{ cursor: 'pointer', fontSize: '0.9rem', transition: 'background-color 0.2s ease' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDarkTheme ? '#333' : '#e9ecef')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDarkTheme ? '#212529' : '#f8f9fa')}
                >
                  {result.email}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Фіксований заголовок чату */}
      {selectedChatId && !isSearchOpen && (
        <div className="p-2 border-bottom" style={{ position: 'sticky', top: headerRef.current?.offsetHeight || 50, zIndex: 900, background: isDarkTheme ? '#212529' : '#fff', padding: '0.5rem', animation: 'slideDown 0.5s ease-in-out' }}>
          <h6 className="m-0 text-center" style={{ fontSize: '0.9rem' }}>Чат з {selectedContact?.email || 'невідомим'}</h6>
        </div>
      )}

      {/* Список контактів */}
      <div ref={contactsRef} className="p-2" style={{ maxHeight: '20vh', overflowY: 'auto', borderBottom: `1px solid ${isDarkTheme ? '#555' : '#ccc'}` }}>
        {contacts
          .filter((contact) => messages.some((msg) => msg.contactId === contact.id || msg.userId === contact.id))
          .map((contact) => (
            <div
              key={contact.id}
              className={`p-2 ${isDarkTheme ? 'bg-secondary' : 'bg-light'} border-bottom ${selectedChatId === contact.id ? 'bg-primary text-white' : ''}`}
              onClick={() => setSelectedChatId(contact.id)}
              style={{ cursor: 'pointer', fontSize: '0.9rem', transition: 'background-color 0.2s ease' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = selectedChatId === contact.id ? '#007bff' : isDarkTheme ? '#333' : '#e9ecef')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = selectedChatId === contact.id ? '#007bff' : isDarkTheme ? '#212529' : '#f8f9fa')}
            >
              {contact.email}
            </div>
          ))}
      </div>

      {/* Чат відображається знизу вгору з анімацією для нових повідомлень */}
      <div
        ref={chatRef}
        className={`flex-grow-1 overflow-auto p-2 ${isDarkTheme ? 'bg-secondary text-light' : 'bg-light text-dark'}`}
        style={{ minHeight: 0, padding: '0.5rem', flexDirection: 'column-reverse' }} // Знизу вгору
        onScroll={handleScroll}
      >
        {selectedChatId ? (
          messages.length > 0 ? (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`d-flex mb-2 ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} message-animation`}
                style={{ animation: 'fadeInSlide 0.5s ease-in-out' }}
              >
                <div
                  className={`p-2 rounded ${msg.isMine ? 'bg-primary text-white' : isDarkTheme ? 'bg-dark text-light' : 'bg-secondary text-white'}`}
                  style={{ maxWidth: '70%', wordBreak: 'break-word', borderRadius: '10px' }}
                >
                  {msg.text}
                  <small className={`d-block mt-1 ${isDarkTheme ? 'text-muted' : 'text-muted'}`} style={{ fontSize: '0.7rem' }}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center" style={{ fontSize: '0.9rem', padding: '0.5rem' }}>Немає повідомлень</p>
          )
        ) : (
          <p className="text-center" style={{ fontSize: '0.9rem', padding: '0.5rem' }}>Виберіть чат</p>
        )}
      </div>

      {/* Панель вводу */}
      {selectedChatId && (
        <div className="p-2 border-top" style={{ position: 'sticky', bottom: 0, background: isDarkTheme ? '#212529' : '#fff', zIndex: 800 }}>
          <div className="d-flex align-items-center">
            <input
              type="text"
              className={`form-control me-2 ${isDarkTheme ? 'bg-dark text-light border-light' : 'bg-white text-dark'}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Повідомлення..."
              style={{ flex: 1, borderRadius: '20px', padding: '0.5rem 1rem', transition: 'all 0.3s ease' }}
            />
            <button
              className="btn btn-primary"
              onClick={sendMessage}
              style={{ minWidth: '100px', borderRadius: '20px', padding: '0.5rem 1rem', transition: 'all 0.3s ease', animation: 'pulse 0.5s ease-in-out' }}
            >
              Надіслати
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// CSS-анімації (додаємо в окремий файл або в <style> у компоненті)
const styles = `
  .loading {
    opacity: 0;
    transition: opacity 0.5s ease-in-out;
  }
  .loaded {
    animation: fadeIn 0.5s ease-in-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideDown {
    from { transform: translateY(-20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes fadeInSlide {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }
  .search-panel {
    max-height: 0;
    overflow: hidden;
  }
  .search-panel[style*="max-height: 20vh"] {
    max-height: 20vh;
  }
  .message-animation {
    animation: fadeInSlide 0.5s ease-in-out;
  }
  button:hover {
    transform: scale(1.05);
    transition: transform 0.2s ease;
  }
`;

export default App;