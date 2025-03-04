import React, { useRef, useEffect } from 'react';
import { Contact, ChatListProps } from '../types';

const ChatList: React.FC<ChatListProps> = ({ contacts, selectedChatId, isDarkTheme, onSelectChat }) => {
  const chatListRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const lastTouchY = useRef<number | null>(null);
  const velocity = useRef(0);
  const isScrolling = useRef(false);
  const animationFrame = useRef<number | null>(null);
  const scrollPosition = useRef(0);

  useEffect(() => {
    if (chatListRef.current && !selectedChatId) {
      chatListRef.current.scrollTop = scrollPosition.current;
    }
  }, [selectedChatId]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    lastTouchY.current = touchStartY.current;
    velocity.current = 0;
    isScrolling.current = false;
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!chatListRef.current || touchStartY.current === null || lastTouchY.current === null) return;

    const touchCurrentY = e.touches[0].clientY;
    const deltaY = lastTouchY.current - touchCurrentY;
    
    if (Math.abs(deltaY) > 1) {
      isScrolling.current = true;
      e.preventDefault();
      chatListRef.current.scrollTop += deltaY * 1.25;
      velocity.current = deltaY * 1.5;
    }
    
    lastTouchY.current = touchCurrentY;
    scrollPosition.current = chatListRef.current.scrollTop;
  };

  const animateScroll = () => {
    if (!chatListRef.current || Math.abs(velocity.current) < 0.5) return;

    chatListRef.current.scrollTop += velocity.current;
    velocity.current *= 0.97;
    
    const maxScroll = chatListRef.current.scrollHeight - chatListRef.current.clientHeight;
    chatListRef.current.scrollTop = Math.max(0, Math.min(chatListRef.current.scrollTop, maxScroll));
    scrollPosition.current = chatListRef.current.scrollTop;

    animationFrame.current = requestAnimationFrame(animateScroll);
  };

  const handleTouchEnd = (e: React.TouchEvent, contact: Contact) => {
    if (!isScrolling.current) {
      onSelectChat(contact);
    } else if (Math.abs(velocity.current) > 2) {
      animationFrame.current = requestAnimationFrame(animateScroll);
    }
    touchStartY.current = null;
    lastTouchY.current = null;
    isScrolling.current = false;
  };

  if (!contacts.length) {
    return <div>No contacts available</div>;
  }

  return (
    <div 
      ref={chatListRef}
      className="scroll-container"
      style={{ 
        height: '100%',
        overflowY: 'scroll',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        position: 'relative',
        touchAction: 'none',
        paddingBottom: '100px',
      }}
    >
      {contacts.map((contact) => {
        const hasUnread = contact.lastMessage?.isRead === 0 && contact.lastMessage?.userId === contact.id;
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
                onSelectChat(contact);
              }
            }}
            style={{ 
              background: isSelected ? (isDarkTheme ? '#444' : '#f0f0f0') : 'transparent',
              width: '100%',
              userSelect: 'none',
            }}
          >
            <div className="avatar">
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
                  <span className="chat-timestamp" style={{ marginLeft: '10px' }}>
                    {new Date(contact.lastMessage.timestamp).toLocaleString([], { 
                      day: '2-digit', 
                      month: '2-digit', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </span>
                </div>
              )}
            </div>
            {hasUnread && (
              <div
                style={{
                  width: '10px',
                  height: '10px',
                  backgroundColor: '#007bff',
                  borderRadius: '50%',
                  marginLeft: '10px',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ChatList;