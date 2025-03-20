import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FaRedo, FaAngleDown } from 'react-icons/fa';
import { Message } from '../types';

interface ChatWindowProps {
  messages: Message[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  unreadMessagesCount: number;
  showScrollDown: boolean;
  onRetryDecryption: (message: Message) => void;
  onScrollToBottom: (force?: boolean) => void;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  inputPanelHeight?: number; // Новий пропс для висоти панелі вводу
}

const UnreadMessagesIndicator: React.FC<{
  unreadCount: number;
  onClick: () => void;
  isDarkTheme: boolean;
}> = ({ unreadCount, onClick, isDarkTheme }) => {
  if (unreadCount === 0) return null;

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        bottom: '80px', // Залишаємо як у старому коді
        left: '20px',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: 'linear-gradient(90deg, #00C7D4, #00C79D)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: 'bold',
        cursor: 'pointer',
        zIndex: 15,
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      }}
    >
      {unreadCount}
    </div>
  );
};

const ScrollDownButton: React.FC<{
  onClick: () => void;
  isDarkTheme: boolean;
}> = ({ onClick, isDarkTheme }) => {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        bottom: '80px',
        right: '20px',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        backgroundColor: isDarkTheme ? '#333' : '#fff',
        color: isDarkTheme ? '#fff' : '#333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 15,
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      }}
    >
      <FaAngleDown style={{ width: '95px', height: '95px', transform: 'scale(0.4)' }} />
    </div>
  );
};

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  selectedChatId,
  isDarkTheme,
  unreadMessagesCount,
  showScrollDown,
  onRetryDecryption,
  onScrollToBottom,
  chatContainerRef,
  inputPanelHeight = 60, // Значення за замовчуванням, якщо висота панелі не передана
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const prevMessagesLengthRef = useRef(0);
  const userHasScrolledRef = useRef(false);
  const chatScrollPositions = useRef<Record<string, number>>({});

  // Анімація завантаження
  useEffect(() => {
    console.log('Starting loading timer...');
    const timeout = setTimeout(() => {
      console.log('Setting isLoading to false');
      setIsLoading(false);
    }, 1000);

    return () => {
      console.log('Clearing loading timer');
      clearTimeout(timeout);
    };
  }, []);

  // Обробка скролінгу при зміні чату
  useLayoutEffect(() => {
    if (!selectedChatId || !chatContainerRef.current) return;

    const container = chatContainerRef.current;

    if (prevMessagesLengthRef.current === 0) {
      console.log('Initial scroll to bottom');
      container.scrollTop = container.scrollHeight - container.clientHeight;
    } else if (chatScrollPositions.current[selectedChatId] !== undefined) {
      console.log('Restoring scroll position:', chatScrollPositions.current[selectedChatId]);
      container.scrollTop = chatScrollPositions.current[selectedChatId];
    }
  }, [selectedChatId]);

  // Обробка скролінгу при нових повідомленнях
  useEffect(() => {
    if (!selectedChatId || !chatContainerRef.current) return;

    const isNewMessage = messages.length > prevMessagesLengthRef.current;
    const container = chatContainerRef.current;

    if (isNewMessage && prevMessagesLengthRef.current > 0) {
      const latestMessage = messages[messages.length - 1];

      if (latestMessage.isMine || !userHasScrolledRef.current) {
        console.log('Scrolling to bottom for new message');
        container.scrollTop = container.scrollHeight - container.clientHeight;
      }
    }

    prevMessagesLengthRef.current = messages.length;
  }, [messages, selectedChatId]);

  // Обробка скролінгу користувача
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      const handleScrollEvent = () => {
        if (!chatContainerRef.current || !selectedChatId) return;

        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        chatScrollPositions.current[selectedChatId] = scrollTop;

        userHasScrolledRef.current = scrollTop + clientHeight < scrollHeight - 30;
      };

      container.addEventListener('scroll', handleScrollEvent);
      return () => container.removeEventListener('scroll', handleScrollEvent);
    }
  }, [selectedChatId]);

  const scrollToBottom = (force = false) => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      container.scrollTop = container.scrollHeight - container.clientHeight;
      if (force) {
        onScrollToBottom(true);
      }
    }
  };

  if (!selectedChatId) return null;

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>
        {`
          .scroll-container {
            scroll-behavior: auto;
          }

          .messages-container {
            display: flex;
            flex-direction: column;
          }

          .message {
            opacity: 1;
          }

          .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: ${isDarkTheme ? '#212529' : '#f8f9fa'};
            display: flex;
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000;
          }

          .loader {
            width: 40px;
            height: 40px;
            border: 4px solid ${isDarkTheme ? '#fff' : '#333'};
            border-top: 4px solid #00C7D4;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>

      {isLoading && (
        <div className="loading-overlay">
          <div className="loader" />
        </div>
      )}

      {!isLoading && (
        <div
          ref={chatContainerRef}
          className="p-3 scroll-container"
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: `${inputPanelHeight}px`, // Додаємо відступ знизу, щоб врахувати висоту панелі вводу
          }}
        >
          <div className="messages-container">
            <div style={{ flexGrow: 1 }} /> {/* Повертаємо flexGrow для природного штовхання вгору */}
            {messages.map((msg, index) => (
              <div
                key={`${msg.id}-${msg.timestamp}`}
                className={`d-flex ${
                  msg.isMine ? 'justify-content-end' : 'justify-content-start'
                } mb-2 message`}
              >
                <div
                  className={`p-2 rounded-3 ${msg.isMine ? 'message-mine' : 'message-theirs'}`}
                  style={{
                    maxWidth: '75%',
                    borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    wordBreak: 'break-word',
                    background: msg.isMine
                      ? 'linear-gradient(90deg, #00C7D4, #00C79D)'
                      : 'linear-gradient(90deg, rgba(0, 199, 212, 0.5), rgba(0, 199, 157, 0.5))', // Повертаємо стиль зі старого коду
                    color: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span>{msg.text}</span>
                    {msg.text.startsWith('base64:') && (
                      <FaRedo
                        className="retry-button"
                        onClick={() => onRetryDecryption(msg)}
                        style={{ fontSize: '0.8rem', color: '#fff', cursor: 'pointer', marginLeft: '5px' }}
                      />
                    )}
                  </div>
                  <div
                    className="text-end mt-1"
                    style={{ fontSize: '0.7rem', opacity: 0.8 }}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    {msg.isMine && (msg.isRead === 1 ? '✓✓' : '✓')}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ height: '1px' }} /> {/* Повертаємо запасний простір знизу */}
          </div>
        </div>
      )}

      {!isLoading && unreadMessagesCount > 0 && (
        <UnreadMessagesIndicator
          unreadCount={unreadMessagesCount}
          onClick={() => scrollToBottom(true)}
          isDarkTheme={isDarkTheme}
        />
      )}
      {!isLoading && showScrollDown && (
        <ScrollDownButton
          onClick={() => scrollToBottom(true)}
          isDarkTheme={isDarkTheme}
        />
      )}
    </div>
  );
};

export default ChatWindow;