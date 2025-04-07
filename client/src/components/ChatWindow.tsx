import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Message, ChatWindowProps as OriginalChatWindowProps } from '../types';
import { FaRedo, FaAngleDown } from 'react-icons/fa';
import { RiAttachment2 } from 'react-icons/ri';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';

interface MessageItemProps {
    virtualRow: VirtualItem;
    message: Message;
    isDarkTheme: boolean;
    selectedChatId: string;
    onRetryDecryption: (message: Message) => void;
    measureRef: (node: Element | null) => void;
}

const MessageItem: React.FC<MessageItemProps> = memo(({ virtualRow, message, isDarkTheme, selectedChatId, onRetryDecryption, measureRef }) => {
    const msg = message;
    const [isProcessed, setIsProcessed] = useState(!msg.text.startsWith('base64:'));

    // Автоматично викликаємо розшифрування при рендері повідомлення
    useEffect(() => {
        if (msg.text.startsWith('base64:') && !isProcessed) {
            onRetryDecryption(msg);
            setIsProcessed(true);
        }
    }, [msg, isProcessed, onRetryDecryption]);

    return (
        <div
            key={`${selectedChatId}-${msg.id}-${msg.timestamp}`}
            ref={measureRef}
            data-index={virtualRow.index}
            role="listitem"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                transition: 'transform 0.1s ease-out', // Плавний перехід
                padding: '2px 10px',
                boxSizing: 'border-box',
            }}
        >
            <div className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2`}>
                <div
                    className="message-bubble"
                    style={{
                        background: msg.isMine ? (isDarkTheme ? '#005C4B' : '#DCF8C6') : (isDarkTheme ? '#3a3a3a' : '#FFFFFF'),
                        color: isDarkTheme ? '#E0E0E0' : '#333',
                        borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        maxWidth: '75%',
                        padding: '8px 12px',
                        wordBreak: 'break-word',
                        boxShadow: '0 1px 1px rgba(0,0,0,0.05)',
                        minWidth: '50px',
                        position: 'relative',
                    }}
                >
                    <span style={{ marginRight: msg.text.startsWith('base64:') ? '15px' : '0' }}>{msg.text}</span>
                    {msg.text.startsWith('base64:') && (
                        <FaRedo
                            onClick={(e) => {
                                e.stopPropagation();
                                onRetryDecryption(msg);
                                setIsProcessed(true);
                            }}
                            style={{
                                fontSize: '0.8rem',
                                color: isDarkTheme ? '#aaa' : '#888',
                                cursor: 'pointer',
                                position: 'absolute',
                                bottom: '8px',
                                right: '12px',
                            }}
                            title="Retry Decryption"
                            aria-label="Retry Decryption"
                        />
                    )}
                    <div className="message-meta">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {msg.isMine && msg.isRead === 1 && <span className="read-status read">✓✓</span>}
                        {msg.isMine && msg.isRead === 0 && <span className="read-status delivered">✓</span>}
                        {msg.isMine && msg.isRead === -1 && <span className="read-status failed">!</span>}
                    </div>
                </div>
            </div>
        </div>
    );
});

interface VirtualChatWindowProps extends OriginalChatWindowProps {}

const ChatWindow: React.FC<VirtualChatWindowProps> = ({
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
    const [input, setInput] = useState<string>('');
    const inputAreaRef = useRef<HTMLDivElement>(null);
    const [inputAreaHeight, setInputAreaHeight] = useState(49);
    const isNearBottomRef = useRef(true);
    const lastVisibleIndexRef = useRef<number | null>(null);
    const highestReadIndexRef = useRef<number>(-1);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [newMessagesCount, setNewMessagesCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    const CONTENT_PADDING_START = 17;
    const CONTENT_PADDING_END = 7;
    const NEAR_BOTTOM_THRESHOLD = 150;
    const estimateSize = useCallback(() => 85, []);

    const rowVirtualizer = useVirtualizer({
        count: messages.length,
        getScrollElement: () => chatContainerRef.current,
        estimateSize: estimateSize,
        overscan: 15,
        paddingStart: CONTENT_PADDING_START,
        paddingEnd: CONTENT_PADDING_END,
        initialOffset: messages.length > 0 ? (messages.length - 1) * estimateSize() : 0, // Початковий офсет
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    const mainBackground = isDarkTheme ? '#101010' : '#FFFFFF';
    const headerBackground = isDarkTheme ? '#101010' : '#FFFFFF';
    const inputFieldBackground = isDarkTheme ? '#1E1E1E' : '#F3F4F6';
    const spinnerColor = isDarkTheme ? '#00C7D4' : '#00C7D4';

    const checkNearBottom = useCallback(() => {
        if (!chatContainerRef?.current) return true;
        const el = chatContainerRef.current;
        if (el.clientHeight === 0) return true;
        const scrollHeight = rowVirtualizer.getTotalSize() + CONTENT_PADDING_START + CONTENT_PADDING_END;
        return scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
    }, [chatContainerRef, rowVirtualizer]);

    const getLastVisibleIndex = useCallback(() => {
        if (!chatContainerRef.current) return null;
        const container = chatContainerRef.current;
        const scrollTop = container.scrollTop;
        const clientHeight = container.clientHeight;

        const virtualItems = rowVirtualizer.getVirtualItems();
        if (!virtualItems.length) return null;

        for (let i = virtualItems.length - 1; i >= 0; i--) {
            const item = virtualItems[i];
            const itemBottom = item.start + item.size;
            if (itemBottom <= scrollTop + clientHeight) {
                return item.index;
            }
        }
        return virtualItems[virtualItems.length - 1].index;
    }, [rowVirtualizer]);

    const updateNewMessagesCount = useCallback(() => {
        if (!chatContainerRef.current) return;
        const lastVisibleIndex = getLastVisibleIndex();
        if (lastVisibleIndex !== null) {
            highestReadIndexRef.current = Math.max(highestReadIndexRef.current, lastVisibleIndex);
            if (lastVisibleIndex < messages.length - 1) {
                const newCount = messages.length - 1 - highestReadIndexRef.current;
                setNewMessagesCount(newCount > 0 ? newCount : 0);
            } else {
                setNewMessagesCount(0);
            }
        }
    }, [messages.length, getLastVisibleIndex]);

    const handleScroll = useCallback(() => {
        if (!chatContainerRef.current) return;
        lastVisibleIndexRef.current = getLastVisibleIndex();
        isNearBottomRef.current = checkNearBottom();
        const isAtBottom = checkNearBottom();
        setShowScrollButton(!isAtBottom);
        updateNewMessagesCount();
    }, [checkNearBottom, getLastVisibleIndex, updateNewMessagesCount]);

    const handleSend = () => {
        if (input.trim()) {
            onSendMessage(input);
            setInput('');
            requestAnimationFrame(() => {
                rowVirtualizer.scrollToIndex(messages.length, { align: 'end', behavior: 'auto' });
            });
            isNearBottomRef.current = true;
            setShowScrollButton(false);
            setNewMessagesCount(0);
            highestReadIndexRef.current = messages.length - 1;
        }
    };

    const saveScrollPosition = useCallback(() => {
        if (selectedChatId && lastVisibleIndexRef.current !== null) {
            localStorage.setItem(`chatScrollIndex-${selectedChatId}`, lastVisibleIndexRef.current.toString());
            localStorage.setItem(`highestReadIndex-${selectedChatId}`, highestReadIndexRef.current.toString());
        }
    }, [selectedChatId]);

    const restoreScrollPosition = useCallback(() => {
        if (!chatContainerRef.current || !selectedChatId) return;

        const savedIndex = localStorage.getItem(`chatScrollIndex-${selectedChatId}`);
        const savedHighestReadIndex = localStorage.getItem(`highestReadIndex-${selectedChatId}`);
        
        if (savedHighestReadIndex) {
            highestReadIndexRef.current = parseInt(savedHighestReadIndex, 10);
        }

        requestAnimationFrame(() => {
            const index = savedIndex ? parseInt(savedIndex, 10) : messages.length - 1;
            rowVirtualizer.scrollToIndex(Math.min(index, messages.length - 1), {
                align: 'end',
                behavior: 'auto',
            });
            isNearBottomRef.current = checkNearBottom();
            updateNewMessagesCount();
        });
    }, [selectedChatId, messages.length, rowVirtualizer, checkNearBottom, updateNewMessagesCount]);

    useEffect(() => {
        const currentInputAreaRef = inputAreaRef.current;
        if (currentInputAreaRef) {
            const resizeObserver = new ResizeObserver((entries) => {
                for (let entry of entries) {
                    const newHeight = Math.round(entry.contentRect.height);
                    setInputAreaHeight((prev) => (newHeight !== prev ? newHeight : prev));
                }
            });
            resizeObserver.observe(currentInputAreaRef);
            setInputAreaHeight(currentInputAreaRef.offsetHeight);
            return () => resizeObserver.disconnect();
        }
    }, []);

    useEffect(() => {
        const element = chatContainerRef.current;
        if (element) {
            element.addEventListener('scroll', handleScroll, { passive: true });
            restoreScrollPosition();
        }
        return () => {
            element?.removeEventListener('scroll', handleScroll);
            saveScrollPosition();
        };
    }, [chatContainerRef, handleScroll, restoreScrollPosition, saveScrollPosition, selectedChatId]);

    useEffect(() => {
        if (messages.length > 0 && isNearBottomRef.current) {
            requestAnimationFrame(() => {
                rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' });
            });
            isNearBottomRef.current = true;
            setShowScrollButton(false);
            highestReadIndexRef.current = messages.length - 1;
            setNewMessagesCount(0);
        } else {
            updateNewMessagesCount();
        }
    }, [messages.length, rowVirtualizer, updateNewMessagesCount]);

    // Автоматично розшифровуємо всі повідомлення з base64 при їх завантаженні
    useEffect(() => {
        const encryptedMessages = messages.filter(msg => msg.text.startsWith('base64:'));
        encryptedMessages.forEach(msg => {
            onRetryDecryption(msg);
        });
    }, [messages, onRetryDecryption, selectedChatId]);

    // Додаємо ефект завантаження
    useEffect(() => {
        setIsLoading(true);
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 300); // Коротка затримка для відображення спінера під час рендерингу
        
        return () => clearTimeout(timer);
    }, [selectedChatId]);

    if (!selectedChatId) {
        return (
            <div
                style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: mainBackground,
                }}
            >
                Select a chat
            </div>
        );
    }

    const floatingButtonBottom = `${inputAreaHeight + 10}px`;
    const scrollbarThumbColor = isDarkTheme ? 'rgba(90, 90, 90, 0.8)' : 'rgba(180, 180, 180, 0.8)';
    const scrollbarTrackColor = 'transparent';

    return (
        <div
            style={{
                height: '100%',
                overflow: 'hidden',
                position: 'relative',
                background: mainBackground,
            }}
            id="chat-window-outer"
        >
            <style>{`
                #chat-scroll-container {
                    -webkit-overflow-scrolling: touch;
                    overscroll-behavior-y: contain;
                    scrollbar-width: thin;
                    scrollbar-color: ${scrollbarThumbColor} ${scrollbarTrackColor};
                }
                #chat-scroll-container::-webkit-scrollbar {
                    width: 8px;
                }
                #chat-scroll-container::-webkit-scrollbar-track {
                    background: ${scrollbarTrackColor};
                    border-radius: 4px;
                }
                #chat-scroll-container::-webkit-scrollbar-thumb {
                    background-color: ${scrollbarThumbColor};
                    border-radius: 4px;
                    border: 2px solid ${scrollbarTrackColor};
                    background-clip: content-box;
                }
                #chat-scroll-container::-webkit-scrollbar-thumb:hover {
                    background-color: ${isDarkTheme ? 'rgba(120, 120, 120, 0.9)' : 'rgba(150, 150, 150, 0.9)'};
                }
                .message-meta {
                    font-size: 0.7rem;
                    opacity: 0.7;
                    color: ${isDarkTheme ? '#aaa' : '#555'};
                    text-align: right;
                    margin-top: 4px;
                    padding-left: 10px;
                    white-space: nowrap;
                    float: right;
                    line-height: 1;
                    clear: both;
                }
                .read-status {
                    margin-left: 4px;
                    display: inline-block;
                }
                .read-status.read {
                    color: #4FC3F7;
                }
                .read-status.delivered {
                }
                .read-status.failed {
                    color: red;
                }
                .message-input-container {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: ${headerBackground};
                    padding: 0;
                    border-top: 1px solid ${isDarkTheme ? '#1E1E1E' : '#F3F4F6'};
                    width: 100%;
                    box-sizing: 'border-box',
                    z-index: 1000,
                    display: 'flex',
                    align-items: 'center',
                    height: 49px,
                }
                .input-inner-container {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    gap: 10px;
                    padding-left: 15px;
                    padding-right: 15px;
                    padding-top: 5px;
                    padding-bottom: calc(5px + env(safe-area-inset-bottom));
                }
                .input-field {
                    flex: 1;
                    background: ${inputFieldBackground};
                    border: none;
                    border-radius: 20px;
                    color: ${isDarkTheme ? '#fff' : '#000'};
                    padding: 0.375rem 15px;
                    line-height: 1.5;
                    outline: none;
                    box-shadow: none;
                }
                .input-field:focus {
                    background: ${inputFieldBackground};
                    outline: none;
                    box-shadow: none;
                }
                .icon-button {
                    border: none;
                    background: transparent;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justifyContent: center;
                    color: ${isDarkTheme ? '#fff' : '#212529'};
                    cursor: pointer;
                    transition: color 0.2s;
                }
                .icon-button:hover {
                    color: ${isDarkTheme ? '#00C7D4' : '#007bff'};
                }
                .send-button {
                    background: linear-gradient(90deg, #00C7D4, #00C79D);
                    border: none;
                    color: #fff;
                    border-radius: 20px;
                    min-width: 60px;
                    height: 38px;
                    display: flex;
                    align-items: center;
                    justifyContent: center;
                    cursor: pointer;
                    transition: background 0.1s ease;
                    padding: 0.375rem 0.75rem;
                    margin: 0;
                    font-size: 1rem;
                    font-weight: 500;
                }
                .send-button:disabled {
                    background: linear-gradient(90deg, #00C7D4, #00C79D);
                    opacity: 0.5;
                    cursor: default;
                }
                .input-placeholder-dark::placeholder {
                    color: #b0b0b0;
                }
                .input-placeholder-light::placeholder {
                    color: #6c757d;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .spinner {
                    display: inline-block;
                    width: 50px;
                    height: 50px;
                    border: 4px solid rgba(0, 0, 0, 0.1);
                    border-radius: 50%;
                    border-top-color: ${spinnerColor};
                    animation: spin 1s ease-in-out infinite;
                }
                .spinner-container {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    background-color: ${mainBackground};
                    z-index: 1010;
                    transition: opacity 0.3s ease-out;
                }
                .messages-container {
                    visibility: hidden;
                    transition: visibility 0s 0.3s;
                }
                .messages-container.visible {
                    visibility: visible;
                    transition: visibility 0s;
                }
            `}</style>

            {/* Контейнер для спінера */}
            <div 
                className="spinner-container" 
                style={{ 
                    opacity: isLoading ? 1 : 0,
                    pointerEvents: isLoading ? 'auto' : 'none',
                }}
            >
                <div className="spinner"></div>
            </div>

            {/* Контейнер для повідомлень */}
            <div
                ref={chatContainerRef}
                id="chat-scroll-container"
                role="log"
                aria-live="polite"
                className={`messages-container ${!isLoading ? 'visible' : ''}`}
                style={{
                    position: 'absolute',
                    top: '3px',
                    left: 0,
                    right: 0,
                    bottom: `${inputAreaHeight + 20}px`,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    contain: 'layout style size',
                    display: 'flex',
                    flexDirection: 'column-reverse',
                }}
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualItems.map((virtualRow) => {
                        const msg = messages[virtualRow.index];
                        if (!msg) return null;
                        return (
                            <MessageItem
                                key={virtualRow.key}
                                virtualRow={virtualRow}
                                message={msg}
                                isDarkTheme={isDarkTheme}
                                selectedChatId={selectedChatId}
                                onRetryDecryption={onRetryDecryption}
                                measureRef={rowVirtualizer.measureElement}
                            />
                        );
                    })}
                </div>
            </div>

            <div ref={inputAreaRef} className="message-input-container">
                <div className="input-inner-container">
                    <button
                        className="icon-button"
                        onClick={() => console.log('Attach clicked')}
                        title="Attach file"
                    >
                        <RiAttachment2 size={24} color={isDarkTheme ? '#fff' : '#212529'} />
                    </button>
                    <input
                        type="text"
                        className={`input-field ${
                            isDarkTheme ? 'text-light input-placeholder-dark' : 'text-dark input-placeholder-light'
                        }`}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Message..."
                        aria-label="Type your message"
                    />
                    <button
                        className="send-button"
                        onClick={handleSend}
                        disabled={!input.trim()}
                        aria-label="Send message"
                    >
                        Send
                    </button>
                </div>
            </div>

            {newMessagesCount > 0 && (
                <div
                    onClick={() => {
                        rowVirtualizer.scrollToIndex(messages.length - 1, {
                            align: 'end',
                            behavior: 'smooth',
                        });
                        isNearBottomRef.current = true;
                        setShowScrollButton(false);
                        setNewMessagesCount(0);
                        highestReadIndexRef.current = messages.length - 1;
                        onScrollToBottom(true);
                    }}
                    style={{
                        position: 'fixed',
                        bottom: floatingButtonBottom,
                        left: '20px',
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: isDarkTheme ? 'rgba(60,60,60,0.8)' : 'rgba(255,255,255,0.9)',
                        backdropFilter: 'blur(3px)',
                        color: isDarkTheme ? '#eee' : '#333',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        zIndex: 1001,
                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                        transition: 'opacity 0.3s ease, transform 0.3s ease, bottom 0.2s ease-out',
                        opacity: newMessagesCount > 0 ? 1 : 0,
                        transform: newMessagesCount > 0 ? 'scale(1)' : 'scale(0.8)',
                        pointerEvents: newMessagesCount > 0 ? 'auto' : 'none',
                    }}
                    title={`${newMessagesCount} new messages`}
                    aria-label={`${newMessagesCount} new messages`}
                >
                    {newMessagesCount}
                </div>
            )}

            {showScrollButton && (
                <div
                    onClick={() => {
                        rowVirtualizer.scrollToIndex(messages.length - 1, {
                            align: 'end',
                            behavior: 'smooth',
                        });
                        isNearBottomRef.current = true;
                        setShowScrollButton(false);
                        setNewMessagesCount(0);
                        highestReadIndexRef.current = messages.length - 1;
                        onScrollToBottom(true);
                    }}
                    style={{
                        position: 'fixed',
                        bottom: floatingButtonBottom,
                        right: '20px',
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: isDarkTheme ? 'rgba(60,60,60,0.8)' : 'rgba(255,255,255,0.9)',
                        backdropFilter: 'blur(3px)',
                        color: isDarkTheme ? '#eee' : '#333',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        zIndex: 1001,
                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                        transition: 'opacity 0.3s ease, transform 0.3s ease, bottom 0.2s ease-out',
                        opacity: showScrollButton ? 1 : 0,
                        transform: showScrollButton ? 'scale(1)' : 'scale(0.8)',
                        pointerEvents: showScrollButton ? 'auto' : 'none',
                    }}
                    title="Scroll to bottom"
                    aria-label="Scroll to bottom"
                >
                    <FaAngleDown style={{ width: '20px', height: '20px' }} aria-hidden="true" />
                </div>
            )}
        </div>
    );
};

export default ChatWindow;