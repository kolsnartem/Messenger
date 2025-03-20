import React, { useState, useRef, useEffect } from 'react';
import { Message, ChatWindowProps } from '../types';
import { FaRedo, FaAngleDown } from 'react-icons/fa';

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
  const [inputText, setInputText] = useState('');
  const [isFirstLoad, setIsFirstLoad] = useState(() => {
    return !localStorage.getItem(`chatLoaded-${selectedChatId}`);
  });
  const prevMessageCount = useRef(messages.length);

  useEffect(() => {
    if (!chatContainerRef.current) return;

    const savedScrollPos = localStorage.getItem(`chatScrollPos-${selectedChatId}`);

    if (savedScrollPos) {
      chatContainerRef.current.scrollTop = parseInt(savedScrollPos, 10);
    } else {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }

    if (isFirstLoad) {
      setTimeout(() => {
        setIsFirstLoad(false);
        localStorage.setItem(`chatLoaded-${selectedChatId}`, 'true');
      }, 300);
    }
  }, [messages, selectedChatId, isFirstLoad]);

  useEffect(() => {
    if (!chatContainerRef.current) return;

    const handleScroll = () => {
      if (chatContainerRef.current) {
        localStorage.setItem(
          `chatScrollPos-${selectedChatId}`,
          chatContainerRef.current.scrollTop.toString()
        );
      }
    };

    chatContainerRef.current.addEventListener('scroll', handleScroll);
    return () => chatContainerRef.current?.removeEventListener('scroll', handleScroll);
  }, [selectedChatId]);

  const handleSend = () => {
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  if (!selectedChatId) return null;

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isFirstLoad && (
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="spinner-border"
            style={{
              width: '50px',
              height: '50px',
              borderWidth: '5px',
              borderColor: isDarkTheme ? '#00C79D' : '#00C7D4',
              borderRightColor: 'transparent',
            }}
            role="status"
          >
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      )}

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

      {unreadMessagesCount > 0 && (
        <div
          onClick={() => onScrollToBottom(true)}
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
          {unreadMessagesCount}
        </div>
      )}

      {showScrollDown && (
        <div
          onClick={() => onScrollToBottom(true)}
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
      )}
    </div>
  );
};

export default ChatWindow;