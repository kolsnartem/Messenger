import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { FaRedo } from 'react-icons/fa';

interface ChatWindowProps {
  messages: Message[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  onRetryDecryption: (message: Message) => void;
  onScrollToBottom: (force?: boolean) => void;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onSendMessage: (text: string) => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  selectedChatId,
  isDarkTheme,
  onRetryDecryption,
  chatContainerRef,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasLoadedBefore, setHasLoadedBefore] = useState<boolean>(false);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (!selectedChatId) return;

    const cachedMessages = localStorage.getItem(`chat_${selectedChatId}`);
    const scrollPosition = localStorage.getItem(`scrollPosition_${selectedChatId}`);

    if (cachedMessages || messages.length > 0) {
      setHasLoadedBefore(true); // Позначаємо, що чат уже завантажувався

      const container = chatContainerRef.current;
      if (container) {
        if (scrollPosition) {
          container.scrollTop = parseFloat(scrollPosition);
        } else if (messages.length > 0) {
          container.scrollTop = container.scrollHeight;
        }
      }
    }

    // Якщо це перше відкриття, показуємо спінер
    if (!hasLoadedBefore) {
      setTimeout(() => {
        setIsLoading(false);
      }, 500);
    } else {
      setIsLoading(false);
    }

    initialLoadRef.current = false;
  }, [selectedChatId, chatContainerRef, messages]);

  if (!selectedChatId) return null;

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Білий фон тільки при першому завантаженні */}
      {isLoading && !hasLoadedBefore && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
          }}
        >
          <div className="spinner"></div>
        </div>
      )}

      {/* CSS для спінера */}
      <style>
        {`
          .spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #ddd;
            border-top: 5px solid #00C79D;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>

      <div
        ref={chatContainerRef}
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '10px',
        }}
      >
        <div style={{ flexGrow: 1 }} />
        {messages.map((msg) => (
          <div key={`${msg.id}-${msg.timestamp}`} className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2`}>
            <div
              className="message-bubble"
              style={{
                maxWidth: '75%',
                padding: '10px',
                borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                wordBreak: 'break-word',
                background: msg.isMine ? '#00C79D' : '#E0E0E0',
                color: msg.isMine ? '#fff' : '#333',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span>{msg.text}</span>
                {msg.text.startsWith('base64:') && (
                  <FaRedo
                    onClick={() => onRetryDecryption(msg)}
                    style={{ fontSize: '0.8rem', color: '#fff', cursor: 'pointer', marginLeft: '5px' }}
                  />
                )}
              </div>
              <div className="text-end mt-1" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
          className="form-control"
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '20px',
            background: isDarkTheme ? '#34495e' : '#e9ecef',
            color: isDarkTheme ? '#fff' : '#333',
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
    </div>
  );
};

export default ChatWindow;