import React from 'react';
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
  chatContainerRef: React.RefObject<HTMLDivElement | null>; // Дозволяємо null у типі
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
        backgroundColor: '#ff9966',
        color: '#333',
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
        fontSize: '24px',
        cursor: 'pointer',
        zIndex: 15,
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
      }}
    >
      <FaAngleDown />
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
}) => {
  if (!selectedChatId) return null;

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div
        ref={chatContainerRef}
        className="p-3 scroll-container"
        style={{
          height: 'calc(100% - 60px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flexGrow: 1 }} />
        {messages.map((msg) => (
          <div
            key={`${msg.id}-${msg.timestamp}`}
            className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2 message-enter`}
          >
            <div
              className={`p-2 rounded-3 ${msg.isMine ? 'message-mine' : 'message-theirs'}`}
              style={{
                maxWidth: '75%',
                borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                wordBreak: 'break-word',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span>{msg.text}</span>
                {msg.text.startsWith('base64:') && (
                  <FaRedo
                    className="retry-button"
                    onClick={() => onRetryDecryption(msg)}
                    style={{ fontSize: '0.8rem', color: '#333', cursor: 'pointer', marginLeft: '5px' }}
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
    </div>
  );
};

export default ChatWindow;