import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { FaRedo, FaAngleDown } from 'react-icons/fa';

interface ChatWindowProps {
  messages: Message[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  unreadMessagesCount: number;
  showScrollDown: boolean;
  onRetryDecryption: (message: Message) => void;
  onScrollToBottom: (force?: boolean) => void;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onSendMessage: (text: string) => void;
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
        bottom: '80px',
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
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (!selectedChatId) return;

    setIsLoading(true);
    const cachedMessages = localStorage.getItem(`chat_${selectedChatId}`);

    const loadMessages = async () => {
      await new Promise(resolve => setTimeout(resolve, 300)); // Мінімальна затримка для плавності

      if (cachedMessages) {
        const parsedMessages = JSON.parse(cachedMessages);
        chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight });
        setIsLoading(false);
      } else {
        localStorage.setItem(`chat_${selectedChatId}`, JSON.stringify(messages));
        chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight });
        setIsLoading(false);
      }
    };

    loadMessages();

    return () => {
      initialLoadRef.current = false;
    };
  }, [selectedChatId, chatContainerRef]);

  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isLoading, chatContainerRef]);

  if (!selectedChatId) return null;

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  const inputBackground = isDarkTheme ? '#34495e' : '#e9ecef';

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>
        {`
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
          .input-field::placeholder {
            color: ${isDarkTheme ? '#b0b0b0' : '#6c757d'};
          }
          .loading-bar {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: ${isDarkTheme ? '#212529' : '#f8f9fa'};
            display: flex;
            alignItems: 'center',
            justifyContent: 'center',
            z-index: 20;
            opacity: ${isLoading ? 1 : 0};
            transition: opacity 0.3s ease-out;
            pointer-events: ${isLoading ? 'auto' : 'none'};
          }
          .loading-bar::after {
            content: '';
            width: 50%;
            height: 4px;
            background: linear-gradient(90deg, #00C7D4, #00C79D);
            animation: loading 1s infinite;
          }
          @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
        `}
      </style>

      <div className="loading-bar" />

      {!isLoading && (
        <>
          <div
            ref={chatContainerRef}
            className="p-3 scroll-container"
            style={{
              flex: '1 1 auto',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ flexGrow: 1 }} />
            {messages.map((msg) => (
              <div
                key={`${msg.id}-${msg.timestamp}`}
                className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2`}
              >
                <div
                  className={`p-2 rounded-3 ${msg.isMine ? 'message-mine' : 'message-theirs'}`}
                  style={{
                    maxWidth: '75%',
                    borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    wordBreak: 'break-word',
                    background: msg.isMine
                      ? 'linear-gradient(90deg, #00C7D4, #00C79D)'
                      : 'linear-gradient(90deg, rgba(0, 199, 212, 0.5), rgba(0, 199, 157, 0.5))',
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
            <div style={{ height: '1px' }} />
          </div>

          <div
            style={{
              padding: '10px',
              background: isDarkTheme ? '#212529' : '#f8f9fa',
              borderTop: '1px solid rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="form-control input-field"
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '20px',
                color: isDarkTheme ? '#fff' : '#2c3e50',
              }}
            />
            <button
              onClick={handleSend}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(90deg, #00C7D4, #00C79D)',
                border: 'none',
                borderRadius: '20px',
                color: 'white',
                fontSize: '16px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>

          {unreadMessagesCount > 0 && (
            <UnreadMessagesIndicator
              unreadCount={unreadMessagesCount}
              onClick={() => onScrollToBottom(true)}
              isDarkTheme={isDarkTheme}
            />
          )}
          {showScrollDown && (
            <ScrollDownButton
              onClick={() => onScrollToBottom(true)}
              isDarkTheme={isDarkTheme}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ChatWindow;