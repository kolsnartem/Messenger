import React, { useRef, useEffect, useMemo } from 'react';
import { Contact, ChatListProps } from '../types';

interface ChatListPropsExtended extends ChatListProps {
  unreadMessages: Map<string, number>;
}

const ChatList: React.FC<ChatListPropsExtended> = ({ contacts, selectedChatId, isDarkTheme, onSelectChat, unreadMessages }) => {
  const chatListRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartTime = useRef<number | null>(null);
  const previousScrollPosition = useRef<number>(0);

  const sortedContacts = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const timeA = a.lastMessage?.timestamp || 0;
      const timeB = b.lastMessage?.timestamp || 0;
      return timeB - timeA;
    });
  }, [contacts]);

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
        background: isDarkTheme ? '#101010' : '#FFFFFF',
      }}
    >
      {sortedContacts.map((contact) => {
        const unreadCount = unreadMessages.get(contact.id) || 0;
        const hasUnread = unreadCount > 0;
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
              background: isSelected ? (isDarkTheme ? '#1E1E1E' : '#f0f0f0') : 'transparent',
              width: '100%',
              userSelect: 'none',
              padding: '12px',
              marginBottom: '8px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'flex-start',
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
              <div 
                style={{ 
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px'
                }}
              >
                <div className={`fw-bold ${hasUnread ? 'unread-text' : ''}`}>
                  {contact.email}
                </div>
                {contact.lastMessage && (
                  <div 
                    className="chat-timestamp" 
                    style={{ 
                      opacity: 0.7,
                      fontSize: '0.8rem',
                      flexShrink: 0,
                      textAlign: 'right'
                    }}
                  >
                    {new Date(contact.lastMessage.timestamp).toLocaleString([], {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                {contact.lastMessage && (
                  <div 
                    className={`${hasUnread ? 'unread-text' : ''}`} 
                    style={{ 
                      fontSize: '0.9rem',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      paddingRight: '10px'
                    }}
                  >
                    {contact.lastMessage.text.length > 30
                      ? `${contact.lastMessage.text.substring(0, 30)}...`
                      : contact.lastMessage.text}
                  </div>
                )}
                {hasUnread && (
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      backgroundColor: '#007bff',
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: '12px',
                      marginLeft: 'auto',
                    }}
                  >
                    {unreadCount}
                  </div>
                )}
              </div>
            </div>
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
          .unread-text {
            font-weight: 600;
          }
        `}
      </style>
    </div>
  );
};

export default ChatList;