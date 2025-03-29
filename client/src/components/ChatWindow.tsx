import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Message, ChatWindowProps as OriginalChatWindowProps } from '../types';
import { FaRedo, FaAngleDown } from 'react-icons/fa';
import { RiAttachment2 } from 'react-icons/ri';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';

// --- Компонент MessageItem (без змін) ---
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
    return (
        <div key={`${selectedChatId}-${msg.id}-${msg.timestamp}`} ref={measureRef} data-index={virtualRow.index} role="listitem" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)`, padding: '2px 10px', boxSizing: 'border-box' }}>
            <div className={`d-flex ${msg.isMine ? 'justify-content-end' : 'justify-content-start'} mb-2`}>
                <div className="message-bubble" style={{ background: msg.isMine ? (isDarkTheme ? '#005C4B' : '#DCF8C6') : (isDarkTheme ? '#3a3a3a' : '#FFFFFF'), color: isDarkTheme ? '#E0E0E0' : '#333', borderRadius: msg.isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px', maxWidth: '75%', padding: '8px 12px', wordBreak: 'break-word', boxShadow: '0 1px 1px rgba(0,0,0,0.05)', minWidth: '50px', position: 'relative' }}>
                    <span style={{ marginRight: msg.text.startsWith('base64:') ? '15px' : '0' }}>{msg.text}</span>
                    {msg.text.startsWith('base64:') && (<FaRedo onClick={(e) => { e.stopPropagation(); onRetryDecryption(msg); }} style={{ fontSize: '0.8rem', color: isDarkTheme ? '#aaa' : '#888', cursor: 'pointer', position: 'absolute', bottom: '8px', right: '12px' }} title="Retry Decryption" aria-label="Retry Decryption" />)}
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

// --- Пропси для ChatWindow ---
interface VirtualChatWindowProps extends OriginalChatWindowProps { }

// --- Основний компонент ChatWindow ---
const ChatWindow: React.FC<VirtualChatWindowProps> = ({ messages, selectedChatId, isDarkTheme, unreadMessagesCount, showScrollDown, onRetryDecryption, onScrollToBottom, chatContainerRef, onSendMessage }) => {
    const [input, setInput] = useState<string>('');
    const inputAreaRef = useRef<HTMLDivElement>(null);
    const [inputAreaHeight, setInputAreaHeight] = useState(49);
    const [forceScrollOnChatChange, setForceScrollOnChatChange] = useState(true);
    const isMountedRef = useRef(false);
    const isNearBottomRef = useRef(true);
    const prevMessagesLengthRef = useRef(messages.length);
    const [isFirstLoad, setIsFirstLoad] = useState(() => {
        return !localStorage.getItem(`chatLoaded-${selectedChatId}`);
    });

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
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    const mainBackground = isDarkTheme ? '#1e2a38' : '#E5DDD5';
    const headerBackground = isDarkTheme ? '#2c3e50' : '#f1f3f5';
    const inputFieldBackground = isDarkTheme ? '#34495e' : '#e9ecef';

    const checkNearBottom = useCallback(() => {
        if (!chatContainerRef?.current) return true;
        const el = chatContainerRef.current;
        if (el.clientHeight === 0) return true;
        const scrollHeight = rowVirtualizer.getTotalSize() + CONTENT_PADDING_START + CONTENT_PADDING_END;
        return scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
    }, [chatContainerRef, rowVirtualizer, CONTENT_PADDING_START, CONTENT_PADDING_END, NEAR_BOTTOM_THRESHOLD]);

    const handleScroll = useCallback(() => {
        isNearBottomRef.current = checkNearBottom();
        if (chatContainerRef?.current) {
            localStorage.setItem(
                `chatScrollPos-${selectedChatId}`,
                chatContainerRef.current.scrollTop.toString()
            );
        }
    }, [checkNearBottom, selectedChatId, chatContainerRef]);

    const handleSend = () => {
        if (input.trim()) {
            onSendMessage(input);
            setInput('');
        }
    };

    // --- Effects ---
    useEffect(() => {
        const currentInputAreaRef = inputAreaRef.current;
        if (currentInputAreaRef) {
            const resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    const newHeight = Math.round(entry.contentRect.height);
                    setInputAreaHeight(prev => newHeight !== prev ? newHeight : prev);
                }
            });
            resizeObserver.observe(currentInputAreaRef);
            setInputAreaHeight(currentInputAreaRef.offsetHeight);
            return () => resizeObserver.disconnect();
        }
    }, []);

    useEffect(() => {
        const element = chatContainerRef?.current;
        if (element) {
            element.addEventListener('scroll', handleScroll, { passive: true });
            isNearBottomRef.current = checkNearBottom();

            if (!isFirstLoad) {
                const savedScrollPos = localStorage.getItem(`chatScrollPos-${selectedChatId}`);
                if (savedScrollPos) {
                    element.scrollTop = parseInt(savedScrollPos, 10);
                } else {
                    rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' });
                }
            }
        }
        return () => element?.removeEventListener('scroll', handleScroll);
    }, [chatContainerRef, handleScroll, selectedChatId, isFirstLoad, messages.length, rowVirtualizer, checkNearBottom]);

    useEffect(() => {
        if (isFirstLoad && chatContainerRef?.current) {
            setTimeout(() => {
                setIsFirstLoad(false);
                localStorage.setItem(`chatLoaded-${selectedChatId}`, 'true');
                const savedScrollPos = localStorage.getItem(`chatScrollPos-${selectedChatId}`);
                if (savedScrollPos && chatContainerRef.current) {
                    chatContainerRef.current.scrollTop = parseInt(savedScrollPos, 10);
                } else {
                    rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' });
                }
            }, 300);
        }
    }, [isFirstLoad, selectedChatId, messages.length, rowVirtualizer, chatContainerRef]);

    useEffect(() => {
        isMountedRef.current = false;
        isNearBottomRef.current = true;
        prevMessagesLengthRef.current = 0;
        setForceScrollOnChatChange(true);
        if (chatContainerRef?.current) {
            chatContainerRef.current.scrollTop = 0;
        }
    }, [selectedChatId, chatContainerRef]);

    useEffect(() => {
        const lastIndex = messages.length - 1;
        if (lastIndex < 0 || !chatContainerRef?.current) return;
        const isInitialMount = !isMountedRef.current;
        const isChatChange = forceScrollOnChatChange;
        const messageAdded = messages.length > prevMessagesLengthRef.current;
        const lastMessageIsMine = messageAdded && messages[lastIndex]?.isMine === true;
        const shouldScrollNow = isInitialMount || isChatChange || lastMessageIsMine || (messageAdded && !lastMessageIsMine && isNearBottomRef.current);
        let scrollTimeoutId: NodeJS.Timeout | undefined;
        if (shouldScrollNow && !isFirstLoad) {
            scrollTimeoutId = setTimeout(() => {
                rowVirtualizer.scrollToIndex(lastIndex, { align: 'end', behavior: 'auto' });
                isNearBottomRef.current = true;
                if (isChatChange) setForceScrollOnChatChange(false);
            }, 50);
        }
        let mountTimeoutId: NodeJS.Timeout | undefined;
        if (!isMountedRef.current) {
            mountTimeoutId = setTimeout(() => { isMountedRef.current = true; }, 100);
        }
        prevMessagesLengthRef.current = messages.length;
        return () => { 
            if (scrollTimeoutId) clearTimeout(scrollTimeoutId); 
            if (mountTimeoutId) clearTimeout(mountTimeoutId); 
        };
    }, [messages, forceScrollOnChatChange, rowVirtualizer, chatContainerRef, selectedChatId, isFirstLoad]);

    // --- Рендеринг ---
    if (!selectedChatId) {
        return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: mainBackground }}>Select a chat</div>;
    }

    const floatingButtonBottom = `${inputAreaHeight + 10}px`;
    const scrollbarThumbColor = isDarkTheme ? 'rgba(90, 90, 90, 0.8)' : 'rgba(180, 180, 180, 0.8)';
    const scrollbarTrackColor = 'transparent';

    return (
        <div style={{ height: '100%', overflow: 'hidden', position: 'relative', background: mainBackground }} id="chat-window-outer">
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

            <style>{`
                #chat-scroll-container { -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; scrollbar-width: thin; scrollbar-color: ${scrollbarThumbColor} ${scrollbarTrackColor}; }
                #chat-scroll-container::-webkit-scrollbar { width: 8px; }
                #chat-scroll-container::-webkit-scrollbar-track { background: ${scrollbarTrackColor}; border-radius: 4px; }
                #chat-scroll-container::-webkit-scrollbar-thumb { background-color: ${scrollbarThumbColor}; border-radius: 4px; border: 2px solid ${scrollbarTrackColor}; background-clip: content-box; }
                #chat-scroll-container::-webkit-scrollbar-thumb:hover { background-color: ${isDarkTheme ? 'rgba(120, 120, 120, 0.9)' : 'rgba(150, 150, 150, 0.9)'}; }
                .message-meta { font-size: 0.7rem; opacity: 0.7; color: ${isDarkTheme ? '#aaa' : '#555'}; text-align: right; margin-top: 4px; padding-left: 10px; white-space: nowrap; float: right; line-height: 1; clear: both; }
                .read-status { margin-left: 4px; display: inline-block; }
                .read-status.read { color: #4FC3F7; }
                .read-status.delivered {}
                .read-status.failed { color: red; }
                .message-input-container {
                    position: fixed; bottom: 0; left: 0; right: 0;
                    background: ${headerBackground};
                    padding: 0;
                    border-top: 1px solid ${isDarkTheme ? '#465E73' : '#e8ecef'};
                    width: 100%; box-sizing: border-box; zIndex: 1000;
                    display: flex; align-items: center;
                    height: 49px;
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
                    outline: none; box-shadow: none;
                }
                .input-field:focus {
                    background: ${inputFieldBackground};
                    outline: none; box-shadow: none;
                }
                .icon-button {
                    border: none; background: transparent;
                    padding: 0;
                    display: flex; align-items: center; justifyContent: center;
                    color: ${isDarkTheme ? '#fff' : '#212529'};
                    cursor: pointer; transition: color 0.2s;
                }
                .icon-button:hover { color: ${isDarkTheme ? '#00C7D4' : '#007bff'}; }
                .send-button {
                    background: linear-gradient(90deg, #00C7D4, #00C79D);
                    border: none; color: #fff;
                    border-radius: 20px;
                    min-width: 60px;
                    height: 38px;
                    display: flex; align-items: center; justifyContent: center;
                    cursor: pointer; transition: background 0.1s ease;
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
                .input-placeholder-dark::placeholder { color: #b0b0b0; }
                .input-placeholder-light::placeholder { color: #6c757d; }
            `}</style>

            <div ref={chatContainerRef} id="chat-scroll-container" role="log" aria-live="polite" style={{ position: 'absolute', top: '3px', left: 0, right: 0, bottom: `${inputAreaHeight + 20}px`, overflowY: 'auto', overflowX: 'hidden', contain: 'layout style size' }}>
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    {virtualItems.map((virtualRow) => {
                        const msg = messages[virtualRow.index];
                        if (!msg) return null;
                        return (<MessageItem key={virtualRow.key} virtualRow={virtualRow} message={msg} isDarkTheme={isDarkTheme} selectedChatId={selectedChatId} onRetryDecryption={onRetryDecryption} measureRef={rowVirtualizer.measureElement} />);
                    })}
                </div>
            </div>

            <div ref={inputAreaRef} className="message-input-container">
                <div className="input-inner-container">
                    <button className="icon-button" onClick={() => console.log('Attach clicked')} title="Attach file">
                        <RiAttachment2 size={24} color={isDarkTheme ? '#fff' : '#212529'} />
                    </button>
                    <input
                        type="text"
                        className={`input-field ${isDarkTheme ? 'text-light input-placeholder-dark' : 'text-dark'}`}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { handleSend(); } }}
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

            {(unreadMessagesCount > 0 || showScrollDown) && (
                <div onClick={() => { rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' }); isNearBottomRef.current = true; onScrollToBottom(true); }} style={{ position: 'fixed', bottom: floatingButtonBottom, right: '20px', width: '40px', height: '40px', borderRadius: '50%', background: isDarkTheme ? 'rgba(60,60,60,0.8)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(3px)', color: isDarkTheme ? '#eee' : '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: unreadMessagesCount > 0 ? '14px' : '0', fontWeight: 'bold', cursor: 'pointer', zIndex: 1001, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)', transition: 'opacity 0.3s ease, transform 0.3s ease, bottom 0.2s ease-out', opacity: (unreadMessagesCount > 0 || showScrollDown) ? 1 : 0, transform: (unreadMessagesCount > 0 || showScrollDown) ? 'scale(1)' : 'scale(0.8)', pointerEvents: (unreadMessagesCount > 0 || showScrollDown) ? 'auto' : 'none', }} title={unreadMessagesCount > 0 ? `${unreadMessagesCount} new...` : "Scroll to bottom"} aria-label={unreadMessagesCount > 0 ? `${unreadMessagesCount} new...` : "Scroll to bottom"}>
                    {unreadMessagesCount > 0 ? unreadMessagesCount : <FaAngleDown style={{ width: '20px', height: '20px' }} aria-hidden="true" />}
                </div>
            )}
        </div>
    );
};

export default ChatWindow;