import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../types';
import { FaRedo, FaAngleDown } from 'react-icons/fa';

interface ChatWindowProps {
  messages: Message[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  onRetryDecryption: (message: Message) => void;
  onScrollToBottom: (force?: boolean) => void;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onSendMessage: (text: string) => void;
}

const UnreadMessagesIndicator: React.FC<{ unreadCount: number; onClick: () => void }> = ({ unreadCount, onClick }) => {
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

const ScrollDownButton: React.FC<{ onClick: () => void; isDarkTheme: boolean }> = ({ onClick, isDarkTheme }) => {
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
      <FaAngleDown style={{ width: '20px', height: '20px' }} />
    </div>
  );
};

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  selectedChatId,
  isDarkTheme,
  onRetryDecryption,
  onScrollToBottom,
  chatContainerRef,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState('');
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const prevMessageCount = useRef(messages.length);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 10;
      setShowScrollDown(!isAtBottom);
      if (isAtBottom) {
        setUnreadMessagesCount(0);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [chatContainerRef]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 10;
    if (!isAtBottom && messages.length > prevMessageCount.current) {
      setUnreadMessagesCount((prev) => prev + (messages.length - prevMessageCount.current));
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  if (!selectedChatId) return null;

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
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

      {unreadMessagesCount > 0 && <UnreadMessagesIndicator unreadCount={unreadMessagesCount} onClick={() => onScrollToBottom(true)} />}
      {showScrollDown && <ScrollDownButton onClick={() => onScrollToBottom(true)} isDarkTheme={isDarkTheme} />}
    </div>
  );
};

export default ChatWindow;