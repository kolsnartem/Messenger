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
    // Початкова висота тепер ближча до фіксованої
    const [inputAreaHeight, setInputAreaHeight] = useState(49);
    const [forceScrollOnChatChange, setForceScrollOnChatChange] = useState(true);
    const isMountedRef = useRef(false);
    const isNearBottomRef = useRef(true);
    const prevMessagesLengthRef = useRef(messages.length);

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
    // Використовуємо ті ж змінні для кольорів, що й в App.tsx
    const headerBackground = isDarkTheme ? '#2c3e50' : '#f1f3f5'; // Використовуємо для панелі
    const inputFieldBackground = isDarkTheme ? '#34495e' : '#e9ecef'; // Називається inputBackground в App.tsx

    const checkNearBottom = useCallback(() => {
        if (!chatContainerRef.current) return true;
        const el = chatContainerRef.current;
        if (el.clientHeight === 0) return true;
        const scrollHeight = rowVirtualizer.getTotalSize() + CONTENT_PADDING_START + CONTENT_PADDING_END;
        return scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
    }, [chatContainerRef, rowVirtualizer, CONTENT_PADDING_START, CONTENT_PADDING_END, NEAR_BOTTOM_THRESHOLD]);

    const handleScroll = useCallback(() => {
        isNearBottomRef.current = checkNearBottom();
    }, [checkNearBottom]);

    const handleSend = () => {
        if (input.trim()) {
             onSendMessage(input);
             setInput('');
        }
    };

    // --- Effects ---
    // Вимірювання висоти може бути менш критичним з фіксованою висотою панелі,
    // але залишимо для точності позиції плаваючих кнопок
    useEffect(() => {
        const currentInputAreaRef = inputAreaRef.current;
        if (currentInputAreaRef) {
            const resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    const newHeight = Math.round(entry.contentRect.height);
                    // Можна встановити фіксовану висоту, якщо вимірювання не потрібне
                    setInputAreaHeight(prev => newHeight !== prev ? newHeight : prev);
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
            isNearBottomRef.current = checkNearBottom();
        }
        return () => element?.removeEventListener('scroll', handleScroll);
    }, [chatContainerRef, handleScroll]);

    useEffect(() => {
        isMountedRef.current = false;
        isNearBottomRef.current = true;
        prevMessagesLengthRef.current = 0;
        setForceScrollOnChatChange(true);
        if (chatContainerRef.current) chatContainerRef.current.scrollTop = 0;
    }, [selectedChatId, chatContainerRef]);

    useEffect(() => {
        const lastIndex = messages.length - 1;
        if (lastIndex < 0 || !chatContainerRef.current) return;
        const isInitialMount = !isMountedRef.current;
        const isChatChange = forceScrollOnChatChange;
        const messageAdded = messages.length > prevMessagesLengthRef.current;
        const lastMessageIsMine = messageAdded && messages[lastIndex]?.isMine === true;
        const shouldScrollNow = isInitialMount || isChatChange || lastMessageIsMine || (messageAdded && !lastMessageIsMine && isNearBottomRef.current);
        let scrollTimeoutId: NodeJS.Timeout | undefined;
        if (shouldScrollNow) {
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
        return () => { clearTimeout(scrollTimeoutId); clearTimeout(mountTimeoutId); };
    }, [messages, forceScrollOnChatChange, rowVirtualizer, chatContainerRef, selectedChatId]);

    // --- Рендеринг ---
    if (!selectedChatId) {
        return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: mainBackground }}>Select a chat</div>;
    }

    const floatingButtonBottom = `${inputAreaHeight + 10}px`;
    const scrollbarThumbColor = isDarkTheme ? 'rgba(90, 90, 90, 0.8)' : 'rgba(180, 180, 180, 0.8)';
    const scrollbarTrackColor = 'transparent';

    return (
        <div style={{ height: '100%', overflow: 'hidden', position: 'relative', background: mainBackground }} id="chat-window-outer">
            <style>{`
                /* Стилі скролбару та повідомлень (без змін) */
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

                /* --- ЗМІНИ СТИЛІВ ПАНЕЛІ ВВОДУ --- */
                .message-input-container {
                    position: fixed; bottom: 0; left: 0; right: 0;
                    background: ${headerBackground}; /* Використовуємо колір з App.tsx */
                    /* Прибираємо padding з контейнера */
                    /* padding: 5px 10px; */
                    padding: 0;
                    border-top: 1px solid ${isDarkTheme ? '#465E73' : '#e8ecef'}; /* Стиль межі з App.tsx */
                    width: 100%; box-sizing: border-box; z-index: 1000;
                    display: flex; align-items: center; /* Залишаємо flex для вирівнювання */
                    height: 49px; /* <<< Фіксована висота як в App.tsx */
                    /* Safe area обробляється внутрішнім div */
                }
                 /* Внутрішній div для відступів і safe area */
                 .input-inner-container {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    gap: 10px; /* Проміжок як в App.tsx */
                    padding-left: 15px; /* px-3 -> padding-left */
                    padding-right: 15px; /* px-3 -> padding-right */
                    padding-top: 5px; /* Додамо невеликі вертикальні відступи всередині */
                    padding-bottom: calc(5px + env(safe-area-inset-bottom));
                 }

                .input-field {
                    flex: 1;
                    background: ${inputFieldBackground}; /* Колір з App.tsx */
                    border: none;
                    border-radius: 20px; /* Як в App.tsx */
                    color: ${isDarkTheme ? '#fff' : '#000'}; /* Виправлено колір */
                    padding: 0.375rem 15px; /* Як в App.tsx (приблизно 6px 15px) */
                    /* Прибираємо фіксовану висоту, визначається паддінгом */
                    /* height: 36px; */
                    line-height: 1.5; /* Стандартний line-height */
                    outline: none; box-shadow: none;
                }
                .input-field:focus {
                     background: ${inputFieldBackground}; /* Залишаємо той же фон при фокусі */
                     outline: none; box-shadow: none;
                 }
                .icon-button { /* Стиль для Attach */
                    border: none; background: transparent;
                    padding: 0; /* Без відступів як в App.tsx */
                    display: flex; align-items: center; justify-content: center;
                    color: ${isDarkTheme ? '#fff' : '#212529'};
                    cursor: pointer; transition: color 0.2s;
                    /* Не робимо кнопку круглою */
                }
                 .icon-button:hover { color: ${isDarkTheme ? '#00C7D4' : '#007bff'}; } /* Ефект при наведенні */

                .send-button {
                    background: linear-gradient(90deg, #00C7D4, #00C79D);
                    border: none; color: #fff;
                    border-radius: 20px; /* Як в App.tsx */
                    min-width: 60px; /* Як в App.tsx */
                    height: 38px; /* Як в App.tsx */
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; transition: background 0.1s ease; /* Як в App.tsx */
                    padding: 0.375rem 0.75rem; /* Як в App.tsx */
                    margin: 0; /* Як в App.tsx */
                    /* Додатково для тексту */
                     font-size: 1rem; /* Або підібрати */
                     font-weight: 500;
                }
                 .send-button:disabled { /* Стиль неактивної кнопки */
                    background: linear-gradient(90deg, #00C7D4, #00C79D);
                    opacity: 0.5; /* Як в App.tsx */
                    cursor: default;
                 }
                 .input-placeholder-dark::placeholder { color: #b0b0b0; } /* Як в App.tsx */
                 .input-placeholder-light::placeholder { color: #6c757d; } /* Приблизний світлий */
                /* --- Кінець ЗМІН СТИЛІВ --- */
            `}
            </style>

            {/* Скрол-контейнер повідомлень */}
            <div ref={chatContainerRef} id="chat-scroll-container" role="log" aria-live="polite" style={{ position: 'absolute', top: '3px', left: 0, right: 0, bottom: `${inputAreaHeight + 20}px`, overflowY: 'auto', overflowX: 'hidden', contain: 'layout style size' }}>
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    {virtualItems.map((virtualRow) => {
                        const msg = messages[virtualRow.index];
                        if (!msg) return null;
                        return (<MessageItem key={virtualRow.key} virtualRow={virtualRow} message={msg} isDarkTheme={isDarkTheme} selectedChatId={selectedChatId} onRetryDecryption={onRetryDecryption} measureRef={rowVirtualizer.measureElement} />);
                    })}
                </div>
            </div>

            {/* Панель вводу */}
            <div ref={inputAreaRef} className="message-input-container">
              {/* <<< Внутрішній контейнер для відступів >>> */}
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
                     {/* <<< Повертаємо текст >>> */}
                     Send
                </button>
               </div>
            </div>

            {/* Кнопка "Scroll Down" / Лічильник непрочитаних (без змін) */}
            {(unreadMessagesCount > 0 || showScrollDown) && (
                <div onClick={() => { rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'smooth' }); isNearBottomRef.current = true; onScrollToBottom(true); }} style={{ position: 'fixed', bottom: floatingButtonBottom, right: '20px', width: '40px', height: '40px', borderRadius: '50%', background: isDarkTheme ? 'rgba(60,60,60,0.8)' : 'rgba(255,255,255,0.9)', backdropFilter: 'blur(3px)', color: isDarkTheme ? '#eee' : '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: unreadMessagesCount > 0 ? '14px' : '0', fontWeight: 'bold', cursor: 'pointer', zIndex: 1001, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)', transition: 'opacity 0.3s ease, transform 0.3s ease, bottom 0.2s ease-out', opacity: (unreadMessagesCount > 0 || showScrollDown) ? 1 : 0, transform: (unreadMessagesCount > 0 || showScrollDown) ? 'scale(1)' : 'scale(0.8)', pointerEvents: (unreadMessagesCount > 0 || showScrollDown) ? 'auto' : 'none', }} title={unreadMessagesCount > 0 ? `${unreadMessagesCount} new...` : "Scroll to bottom"} aria-label={unreadMessagesCount > 0 ? `${unreadMessagesCount} new...` : "Scroll to bottom"}>
                    {unreadMessagesCount > 0 ? unreadMessagesCount : <FaAngleDown style={{ width: '20px', height: '20px' }} aria-hidden="true" />}
                </div>
            )}
        </div>
    );
};

export default ChatWindow;