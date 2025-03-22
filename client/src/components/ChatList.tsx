import React, { useRef, useEffect } from 'react';
import { Contact, ChatListProps } from '../types';

interface ChatListPropsExtended extends ChatListProps {
  unreadMessages: Map<string, number>;
}

const ChatList: React.FC<ChatListPropsExtended> = ({ contacts, selectedChatId, isDarkTheme, onSelectChat, unreadMessages }) => {
  const chatListRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartTime = useRef<number | null>(null);
  const previousScrollPosition = useRef<number>(0);

  useEffect(() => {
    const container = chatListRef.current;
    if (!container) return;

    if (selectedChatId) {
      previousScrollPosition.current = container.scrollTop;
      return;
    }

    const savedPosition = localStorage.getItem('chatListScrollPosition');
    if (!selectedChatId) {
      container.style.scrollBehavior = 'auto';
      
      if (previousScrollPosition.current) {
        container.scrollTop = previousScrollPosition.current;
      } else if (savedPosition) {
        container.scrollTop = parseFloat(savedPosition);
      }
      
      requestAnimationFrame(() => {
        container.style.scrollBehavior = 'smooth';
      });
    }

    const handleScroll = () => {
      if (!selectedChatId) {
        localStorage.setItem('chatListScrollPosition', container.scrollTop.toString());
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [selectedChatId]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current !== null) {
      const deltaY = Math.abs(touchStartY.current - e.touches[0].clientY);
      if (deltaY > 5) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent, contact: Contact) => {
    const container = chatListRef.current;
    if (!container || touchStartY.current === null || touchStartTime.current === null) return;

    const deltaY = Math.abs(touchStartY.current - e.changedTouches[0].clientY);
    const deltaTime = Date.now() - touchStartTime.current;

    if (deltaY < 10 && deltaTime < 300) {
      previousScrollPosition.current = container.scrollTop;
      onSelectChat(contact);
    }

    touchStartY.current = null;
    touchStartTime.current = null;
  };

  return (
    <div
      ref={chatListRef}
      className="scroll-container"
      style={{
        height: '100%',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '10px',
        paddingBottom: '100px',
        msOverflowStyle: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      {contacts.map((contact) => {
        const unreadCount = unreadMessages.get(contact.id) || 0;
        const hasUnread = unreadCount > 0 || (contact.lastMessage?.isRead === 0 && contact.lastMessage?.userId === contact.id);
        const isSelected = selectedChatId === contact.id;

        return (
          <div
            key={contact.id}
            className="chat-item"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={(e) => handleTouchEnd(e, contact)}
            onClick={(e) => {
              if (!('ontouchstart' in window)) {
                const container = chatListRef.current;
                if (container) {
                  previousScrollPosition.current = container.scrollTop;
                }
                onSelectChat(contact);
              }
            }}
            style={{
              background: isSelected ? (isDarkTheme ? '#444' : '#f0f0f0') : 'transparent',
              width: '100%',
              userSelect: 'none',
              padding: '10px',
              marginBottom: '5px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'background 0.2s ease',
            }}
          >
            <div
              className="avatar"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: isDarkTheme ? '#666' : '#ddd',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: '10px',
                flexShrink: 0,
              }}
            >
              {contact.email.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div className={`fw-bold ${hasUnread ? 'unread-text' : ''}`}>
                {contact.email}
              </div>
              {contact.lastMessage && (
                <div className={`${hasUnread ? 'unread-text' : ''}`} style={{ fontSize: '0.9rem' }}>
                  {contact.lastMessage.text.length > 20
                    ? `${contact.lastMessage.text.substring(0, 20)}...`
                    : contact.lastMessage.text}
                  <span className="chat-timestamp" style={{ marginLeft: '10px', opacity: 0.7 }}>
                    {new Date(contact.lastMessage.timestamp).toLocaleString([], {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              )}
            </div>
            {hasUnread && (
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  backgroundColor: '#007bff',
                  borderRadius: '50%',
                  marginLeft: '10px',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '12px',
                }}
              >
                {unreadCount > 0 ? unreadCount : ''}
              </div>
            )}
          </div>
        );
      })}
      <style>
        {`
          .scroll-container::-webkit-scrollbar {
            width: 6px;
          }
          .scroll-container::-webkit-scrollbar-thumb {
            background: ${isDarkTheme ? '#666' : '#ccc'};
            borderRadius: 3px;
          }
          .scroll-container::-webkit-scrollbar-track {
            background: transparent;
          }
        `}
      </style>
    </div>
  );
};

export default ChatList;